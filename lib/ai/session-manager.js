import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * Read the Claude Code session ID from the workspace volume.
 * Returns null if no session file exists.
 *
 * @param {string} workspaceBaseDir - The workspace base dir (parent of workspace/)
 * @param {number} [port=7681] - ttyd port (7681 = primary tab)
 * @returns {string|null} Session ID or null
 */
export function readSessionId(workspaceBaseDir, port = 7681) {
  try {
    const filePath = path.join(workspaceBaseDir, '.claude-ttyd-sessions', String(port));
    return readFileSync(filePath, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Write a session ID to the workspace volume so the interactive
 * container can resume it.
 *
 * @param {string} workspaceBaseDir - The workspace base dir (parent of workspace/)
 * @param {string} sessionId - Claude Code session ID
 * @param {number} [port=7681] - ttyd port (7681 = primary tab)
 */
export function writeSessionId(workspaceBaseDir, sessionId, port = 7681) {
  const dir = path.join(workspaceBaseDir, '.claude-ttyd-sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, String(port)), sessionId + '\n');
}
