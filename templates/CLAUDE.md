# Templates Directory — Scaffolding Only

This directory contains files that get copied into user projects when they run `npx thepopebot init`. It is **not** where event handler logic, API routes, or core features live.

## Rules

- **NEVER** add event handler code, API route handlers, or core logic here. All of that belongs in the NPM package (`api/`, `lib/`, `config/`, `bin/`).
- Templates exist solely to scaffold a new user's project folder with configuration and infrastructure files.
- Files here may be modified to fix wiring, update configuration defaults, or adjust scaffolding — but never to implement features.
- **Next.js app source** (`app/`, `next.config.mjs`, `server.js`, etc.) lives in `web/` at the package root and is baked into the Docker image. It does NOT belong in templates.

## What belongs here

- **Agent job config**: `agent-job/SYSTEM.md`, `agent-job/CRONS.json`, etc.
- **Event handler config**: `event-handler/agent-chat/SYSTEM.md`, `event-handler/TRIGGERS.json`, etc.
- **GitHub Actions workflows**: `.github/workflows/`
- **Docker compose**: `docker-compose.yml`

## What does NOT belong here

- Next.js app files (pages, layouts, routes) — these live in `web/`
- Route handlers with business logic
- Library code (`lib/`)
- Database operations
- LLM/AI integrations
- Tool implementations
- Anything that should be shared across all users via `npm update thepopebot`
- UI components — all components live in the package (`lib/auth/components/`, `lib/chat/components/`)

If you're adding a feature to the event handler, put it in the package. Templates just wire into it.

## Managed vs. User-Owned

Files inside managed paths (`.github/workflows/`, etc.) are auto-synced by `init` — stale files are deleted, changed files are overwritten. Never add user-editable content to managed paths. User customization goes in `agent-job/` and `event-handler/`.
