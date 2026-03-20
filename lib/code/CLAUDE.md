# lib/code/ — Code Workspaces

## Data Flow

Chat agent's `start_coding` tool → `runInteractiveContainer()` in `lib/tools/docker.js` → Docker container runs `claude-code-workspace` image with ttyd on port 7681 → browser navigates to `/code/{id}` → `TerminalView` (xterm.js) opens WebSocket → `ws-proxy.js` authenticates and proxies to container.

## WebSocket Auth

Middleware can't intercept WebSocket upgrades. `ws-proxy.js` authenticates directly:

1. Reads `authjs.session-token` cookie from the HTTP upgrade request headers
2. Decodes JWT using `next-auth/jwt` `decode()` with `AUTH_SECRET`
3. Rejects with 401 if no valid token, 403 if workspace not found
4. Proxies WebSocket bidirectionally to `ws://{containerName}:7681/ws`

## Container Recovery

`ensureCodeWorkspaceContainer(id)` in `actions.js` — inspects container state via Docker Engine API (Unix socket), restarts recoverable containers (stopped/exited/paused), recreates dead/missing ones. Returns `{ status: 'running' | 'started' | 'created' | 'no_container' | 'error' }`.

## Server Actions

All actions use `requireAuth()` with ownership checks: `getCodeWorkspaces()`, `createCodeWorkspace()`, `renameCodeWorkspace()`, `starCodeWorkspace()`, `deleteCodeWorkspace()`, `ensureCodeWorkspaceContainer()`.
