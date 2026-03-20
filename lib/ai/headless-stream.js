import { Transform } from 'stream';
import split2 from 'split2';

/**
 * Parse Docker container logs from a headless coding agent container.
 * Supports multiple agent output formats (Claude Code, Pi).
 *
 * Three layers:
 * 1. Docker multiplexed frame decoder (Transform stream)
 * 2. split2 for reliable NDJSON line splitting
 * 3. Agent-specific NDJSON → chat event mapper
 *
 * @param {import('http').IncomingMessage} dockerLogStream - Raw Docker log stream
 * @param {string} [codingAgent='claude-code'] - Which agent format to parse
 * @yields {{ type: string, text?: string, toolCallId?: string, toolName?: string, args?: object, result?: string }}
 */
export async function* parseHeadlessStream(dockerLogStream, codingAgent = 'claude-code') {
  const mapperMap = {
    'claude-code': mapClaudeCodeLine,
    'pi-coding-agent': mapPiLine,
    'gemini-cli': mapGeminiLine,
    'codex-cli': mapCodexLine,
    'opencode': mapOpenCodeLine,
  };
  const mapper = mapperMap[codingAgent] || mapClaudeCodeLine;

  // Layer 1: Docker frame decoder
  const frameDecoder = new Transform({
    transform(chunk, encoding, callback) {
      this._buf = this._buf ? Buffer.concat([this._buf, chunk]) : chunk;
      while (this._buf.length >= 8) {
        const size = this._buf.readUInt32BE(4);
        if (this._buf.length < 8 + size) break;
        if (this._buf[0] === 1) { // stdout only
          this.push(this._buf.slice(8, 8 + size));
        }
        this._buf = this._buf.slice(8 + size);
      }
      callback();
    }
  });

  // Layer 2: split2 for reliable line splitting
  const lines = dockerLogStream.pipe(frameDecoder).pipe(split2());

  // Layer 3: map each complete line to chat events
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const event of mapLine(trimmed, mapper)) {
      yield event;
    }
  }
}

/**
 * Check if a mapped event has empty essential fields (wrong field names, broken extraction).
 */
function isEmptyEvent(e) {
  if (e.type === 'text' && !e.text) return true;
  if (e.type === 'tool-call' && !e.toolName) return true;
  if (e.type === 'tool-result' && !e.toolCallId) return true;
  return false;
}

/**
 * Map a single NDJSON line to chat events.
 * @param {string} line - Raw NDJSON line
 * @param {Function} [mapper=mapClaudeCodeLine] - Agent-specific mapper
 * @returns {Array<object>} Zero or more chat events
 */
export function mapLine(line, mapper = mapClaudeCodeLine) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    console.warn('[headless-stream] JSON parse failed, length:', line.length, 'preview:', line.slice(0, 120));
    // Non-JSON lines (NO_CHANGES, PUSH_SUCCESS, AGENT_FAILED, etc.)
    return [{ type: 'text', text: `\n${line}\n` }];
  }

  const events = mapper(parsed);
  // If mapper explicitly skipped this event, suppress it (not unknown)
  if (events.some(e => e.type === 'skip')) {
    return [];
  }
  // If mapper returned nothing, or every event has empty essential fields, emit as unknown
  if (events.length === 0 || events.every(isEmptyEvent)) {
    return [{ type: 'unknown', raw: parsed }];
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Code: --output-format stream-json
// Types: assistant, user, result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Claude Code stream-json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapClaudeCodeLine(parsed) {
  const events = [];
  const { type, subtype, message, result, tool_use_result } = parsed;

  // System events — all handled by the container, skip silently
  if (type === 'system') {
    return [{ type: 'skip' }];
  }

  // Rate limit events — skip if allowed, surface as text if blocked
  if (type === 'rate_limit_event') {
    if (parsed.rate_limit_info?.status === 'allowed') {
      return [{ type: 'skip' }];
    }
    return [{ type: 'text', text: `Rate limited (${parsed.rate_limit_info?.rateLimitType}) — resets at ${new Date((parsed.rate_limit_info?.resetsAt || 0) * 1000).toLocaleString()}` }];
  }

  if (type === 'assistant' && message?.content) {
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        events.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        events.push({
          type: 'tool-call',
          toolCallId: block.id,
          toolName: block.name,
          args: block.input,
        });
      }
      // thinking blocks — skip silently
    }
    // If assistant message had only thinking blocks (no text or tool_use), skip
    if (events.length === 0) return [{ type: 'skip' }];
  } else if (type === 'user' && message?.content) {
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        const resultText = tool_use_result?.stdout ?? (
          typeof block.content === 'string' ? block.content :
          Array.isArray(block.content) ? block.content.map(b => b.text || '').join('') :
          JSON.stringify(block.content)
        );
        events.push({
          type: 'tool-result',
          toolCallId: block.tool_use_id,
          result: resultText,
        });
      }
    }
    // User messages without tool_result (e.g. subagent prompts) — skip
    if (events.length === 0) return [{ type: 'skip' }];
  } else if (type === 'result' && result) {
    events.push({ type: 'text', text: result, _resultSummary: result });
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pi Coding Agent: --mode json
//
// Event types:
//   session, agent_start, agent_end
//   turn_start, turn_end
//   message_start, message_update, message_end
//   tool_execution_start, tool_execution_update, tool_execution_end
//
// message_update.assistantMessageEvent subtypes:
//   text_start, text_delta, text_end
//   toolcall_start, toolcall_delta, toolcall_end
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Pi --mode json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapPiLine(parsed) {
  const events = [];
  const { type } = parsed;

  if (type === 'message_update' && parsed.assistantMessageEvent) {
    const evt = parsed.assistantMessageEvent;

    // Text streaming
    if (evt.type === 'text_delta' && evt.delta) {
      events.push({ type: 'text', text: evt.delta });
    }

    // Tool call — emit on toolcall_end when we have complete args
    if (evt.type === 'toolcall_end' && evt.toolCall) {
      events.push({
        type: 'tool-call',
        toolCallId: evt.toolCall.id,
        toolName: evt.toolCall.name,
        args: evt.toolCall.arguments || {},
      });
    }
  }

  // Tool execution result
  else if (type === 'tool_execution_end') {
    const resultText = parsed.result?.content
      ?.map(b => b.text || '')
      .join('') || '';
    events.push({
      type: 'tool-result',
      toolCallId: parsed.toolCallId || '',
      result: resultText,
    });
  }

  // Final summary
  else if (type === 'agent_end' && parsed.messages) {
    const lastAssistant = [...parsed.messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) {
      const text = (lastAssistant.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      if (text) {
        events.push({ type: 'text', text, _resultSummary: text });
      }
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini CLI: --output-format stream-json
//
// Event types (from real output):
//   init           — session start (session_id, model). Skip.
//   message        — role: "user" (prompt echo, skip) or "assistant" (text output).
//                    Assistant messages have content (string) and delta: true for streaming.
//   tool_use       — tool_name, tool_id, parameters
//   tool_result    — tool_id, status, output
//   result         — status, stats (token counts, duration). Final event.
//   error          — error message
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Gemini CLI stream-json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapGeminiLine(parsed) {
  const events = [];
  const { type } = parsed;

  if (type === 'message') {
    // Skip user prompt echo
    if (parsed.role === 'user') return [{ type: 'skip' }];
    // Assistant text (streamed as delta chunks)
    const content = typeof parsed.content === 'string' ? parsed.content : parsed.content?.text;
    if (content) events.push({ type: 'text', text: content });
  } else if (type === 'tool_use') {
    events.push({
      type: 'tool-call',
      toolCallId: parsed.tool_id || parsed.id || '',
      toolName: parsed.tool_name || parsed.name || '',
      args: parsed.parameters || parsed.input || {},
    });
  } else if (type === 'tool_result') {
    const output = parsed.output !== undefined
      ? (typeof parsed.output === 'string' ? parsed.output : JSON.stringify(parsed.output))
      : '';
    events.push({
      type: 'tool-result',
      toolCallId: parsed.tool_id || parsed.id || '',
      result: output,
    });
  } else if (type === 'result') {
    // Final stats event — emit token summary as result
    const stats = parsed.stats;
    if (stats) {
      const summary = `Completed (${stats.total_tokens || 0} tokens, ${stats.tool_calls || 0} tool calls, ${((stats.duration_ms || 0) / 1000).toFixed(1)}s)`;
      events.push({ type: 'text', text: summary, _resultSummary: summary });
    }
    return events.length ? events : [{ type: 'skip' }];
  } else if (type === 'error') {
    events.push({ type: 'text', text: `Error: ${parsed.message || parsed.error || JSON.stringify(parsed)}` });
  } else if (type === 'init') {
    return [{ type: 'skip' }];
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Codex CLI: --json
//
// Event types (from real output):
//   thread.started    — session start (thread_id). Skip.
//   turn.started      — turn begins. Skip.
//   item.started      — tool call in progress (command_execution, mcp_tool_call). Skip.
//   item.completed    — completed item (agent_message, command_execution, mcp_tool_call, file_change)
//   turn.completed    — turn ends with usage stats
//   turn.failed       — turn failed with error
//   error             — error message
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Codex CLI --json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapCodexLine(parsed) {
  const events = [];
  const { type, item } = parsed;

  if (type === 'item.completed' && item) {
    if (item.type === 'agent_message' && item.text) {
      events.push({ type: 'text', text: item.text });
    } else if (item.type === 'command_execution') {
      events.push({
        type: 'tool-call',
        toolCallId: item.id || '',
        toolName: 'command',
        args: { command: item.command || item.input || '' },
      });
      if (item.aggregated_output !== undefined) {
        events.push({
          type: 'tool-result',
          toolCallId: item.id || '',
          result: typeof item.aggregated_output === 'string' ? item.aggregated_output : JSON.stringify(item.aggregated_output),
        });
      }
    } else if (item.type === 'mcp_tool_call') {
      events.push({
        type: 'tool-call',
        toolCallId: item.id || '',
        toolName: `${item.server || 'mcp'}:${item.tool || 'unknown'}`,
        args: item.arguments || {},
      });
      if (item.result) {
        const resultText = item.result.content
          ?.map(b => b.text || '').join('') || JSON.stringify(item.result);
        events.push({
          type: 'tool-result',
          toolCallId: item.id || '',
          result: resultText,
        });
      }
    } else if (item.type === 'file_change') {
      events.push({
        type: 'tool-call',
        toolCallId: item.id || '',
        toolName: 'file_change',
        args: { file: item.file || item.path || '', action: item.action || 'edit' },
      });
    }
  } else if (type === 'turn.completed') {
    const usage = parsed.usage;
    if (usage) {
      const summary = `Completed (${usage.input_tokens || 0} input, ${usage.output_tokens || 0} output tokens)`;
      events.push({ type: 'text', text: summary, _resultSummary: summary });
    }
    return events.length ? events : [{ type: 'skip' }];
  } else if (type === 'turn.failed') {
    const msg = parsed.error?.message || JSON.stringify(parsed.error || parsed);
    events.push({ type: 'text', text: `Error: ${msg}` });
  } else if (type === 'error') {
    events.push({ type: 'text', text: `Error: ${parsed.message || parsed.error || JSON.stringify(parsed)}` });
  } else if (type === 'thread.started' || type === 'turn.started' || type === 'item.started') {
    return [{ type: 'skip' }];
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode: --format json
//
// Event types (from real output):
//   step_start  — new step begins (has part.snapshot)
//   step_finish — step ends (has part.cost, part.tokens, part.reason)
//   text        — assistant text output (part.text)
//   tool_use    — tool call with completed state (part.tool, part.callID,
//                 part.state.input, part.state.output)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map an OpenCode --format json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapOpenCodeLine(parsed) {
  const events = [];
  const { type, part } = parsed;

  // Text output — part.text contains the assistant's response
  if (type === 'text' && part?.text) {
    events.push({ type: 'text', text: part.text });
    // If step_finish follows with reason "stop", this is the final answer
    // We mark it as result summary so it gets captured in LangGraph memory
    if (part.text.length > 50) {
      events[events.length - 1]._resultSummary = part.text;
    }
  }

  // Tool use — OpenCode emits a single event with completed state (input + output)
  else if (type === 'tool_use' && part) {
    const callId = part.callID || part.id || '';
    const toolName = part.tool || '';
    const state = part.state || {};

    events.push({
      type: 'tool-call',
      toolCallId: callId,
      toolName,
      args: state.input || {},
    });

    if (state.status === 'completed' && state.output !== undefined) {
      events.push({
        type: 'tool-result',
        toolCallId: callId,
        result: typeof state.output === 'string' ? state.output : JSON.stringify(state.output),
      });
    }
  }

  // Known noise — skip silently (don't trigger unknown fallback)
  else if (type === 'step_start' || type === 'step_finish') {
    return [{ type: 'skip' }];
  }

  // Error
  else if (type === 'error') {
    events.push({ type: 'text', text: `Error: ${parsed.message || parsed.error || JSON.stringify(parsed)}` });
  }

  return events;
}
