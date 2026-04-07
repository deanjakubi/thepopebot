import { claudeCodeStream } from './claude-code.js';

/**
 * Returns the SDK stream adapter for the given coding agent type,
 * or null if no SDK adapter exists (fall back to legacy LangGraph/Docker path).
 *
 * @param {string} agentType - e.g. 'claude-code', 'pi-coding-agent', etc.
 * @returns {Function|null} Async generator function or null
 */
export function getSdkAdapter(agentType) {
  if (agentType === 'claude-code') return claudeCodeStream;
  return null;
}
