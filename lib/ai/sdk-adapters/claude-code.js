import { query } from '@anthropic-ai/claude-agent-sdk';
import { getConfig } from '../../config.js';
import { buildAgentAuthEnv } from '../../tools/docker.js';

/**
 * Claude Agent SDK adapter. Wraps the SDK's query() and yields
 * the unified chunk format consumed by chatStream/api.js.
 *
 * @param {object} opts
 * @param {string} opts.prompt - User message
 * @param {string} opts.workspaceDir - Absolute path to workspace (git repo root)
 * @param {string} [opts.systemPrompt] - System prompt (agent mode only)
 * @param {string} [opts.sessionId] - Session ID to resume
 * @param {string} [opts.permissionMode] - 'plan' or 'code'
 * @param {Array} [opts.attachments] - Image attachments
 * @yields {{ type: 'text'|'tool-call'|'tool-result'|'meta'|'result'|'unknown', ... }}
 */
export async function* claudeCodeStream({ prompt, workspaceDir, systemPrompt, sessionId, permissionMode }) {
  // Resolve auth from settings DB and set env vars for the SDK
  const savedEnv = {};
  try {
    const { env: authEnvPairs } = buildAgentAuthEnv('claude-code');
    for (const pair of authEnvPairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx);
        const val = pair.slice(eqIdx + 1);
        savedEnv[key] = process.env[key];
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.error('[claude-code-sdk] Failed to resolve auth:', err.message);
    // Fall through — env may already have the right vars (e.g. CLAUDE_CODE_OAUTH_TOKEN)
  }

  const options = {
    cwd: workspaceDir,
    includePartialMessages: true,
  };

  // Permission mode → allowed tools
  if (permissionMode === 'code') {
    options.permissionMode = 'bypassPermissions';
  }

  if (sessionId) options.resume = sessionId;
  if (systemPrompt) {
    options.systemPrompt = { type: 'preset', preset: 'claude_code', append: systemPrompt };
  }

  // Track tool call state for mapping stream events
  const activeToolCalls = new Map(); // index → { id, name, argsJson }

  try {
    for await (const message of query({ prompt, options })) {
      // ── system messages ──
      if (message.type === 'system') {
        if (message.subtype === 'init') {
          yield { type: 'meta', sessionId: message.session_id };
        }
        continue;
      }

      // ── rate limit events ──
      if (message.type === 'rate_limit_event') continue;

      // ── streaming events ──
      if (message.type === 'stream_event') {
        const event = message.event;

        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            activeToolCalls.set(event.index, { id: block.id, name: block.name, argsJson: '' });
            yield { type: 'tool-call', toolCallId: block.id, toolName: block.name, args: {} };
          }
          // Skip 'thinking', 'text' start (deltas handle text)
          continue;
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const tc = activeToolCalls.get(event.index);
            if (tc) tc.argsJson += event.delta.partial_json;
          }
          continue;
        }

        if (event.type === 'content_block_stop') {
          const tc = activeToolCalls.get(event.index);
          if (tc && tc.argsJson) {
            try {
              const args = JSON.parse(tc.argsJson);
              yield { type: 'tool-call', toolCallId: tc.id, toolName: tc.name, args };
            } catch {}
          }
          activeToolCalls.delete(event.index);
          continue;
        }

        // message_start, message_delta, message_stop — skip
        continue;
      }

      // ── user messages (tool results) ──
      if (message.type === 'user') {
        const blocks = message.message?.content || [];
        for (const block of blocks) {
          if (block.type === 'tool_result') {
            const content = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n')
                : JSON.stringify(block.content);
            yield { type: 'tool-result', toolCallId: block.tool_use_id, result: content };
          }
        }
        continue;
      }

      // ── assistant messages — redundant with streaming, skip ──
      if (message.type === 'assistant') continue;

      // ── result ──
      if (message.type === 'result') {
        console.log(`[claude-code-sdk] ${message.subtype} cost=$${message.total_cost_usd?.toFixed(4)} duration=${message.duration_ms}ms`);
        yield {
          type: 'result',
          text: message.result || '',
          cost: message.total_cost_usd,
          duration: message.duration_ms,
          subtype: message.subtype,
        };
        continue;
      }

      // ── unknown ──
      yield { type: 'unknown', raw: message };
    }
  } finally {
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
}
