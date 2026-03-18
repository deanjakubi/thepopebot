/**
 * In-memory port forward registry.
 * Maps workspaceId → Map<port, { containerName, detectedAt }>
 *
 * Uses globalThis to ensure a single shared instance across Next.js
 * server action bundles and the ws-proxy module.
 */

const GLOBAL_KEY = '__portForwards';
if (!globalThis[GLOBAL_KEY]) {
  globalThis[GLOBAL_KEY] = new Map();
}
const forwards = globalThis[GLOBAL_KEY];

export function addForward(workspaceId, port, data) {
  if (!forwards.has(workspaceId)) {
    forwards.set(workspaceId, new Map());
  }
  forwards.get(workspaceId).set(port, data);
}

export function removeForward(workspaceId, port) {
  const ws = forwards.get(workspaceId);
  if (ws) {
    ws.delete(port);
    if (ws.size === 0) forwards.delete(workspaceId);
  }
}

export function getForwards(workspaceId) {
  return forwards.get(workspaceId) || new Map();
}

export function clearWorkspaceForwards(workspaceId) {
  forwards.delete(workspaceId);
}
