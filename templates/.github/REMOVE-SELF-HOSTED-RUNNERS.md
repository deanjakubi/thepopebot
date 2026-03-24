# Remove Self-Hosted GitHub Runners — Research & Plan

## Goal

Eliminate the self-hosted GitHub Actions runner from the event handler machine. Cloud runners (ubuntu-latest) stay for lightweight workflow tasks. The self-hosted runner is currently required by two workflows: `rebuild-event-handler.yml` and `upgrade-event-handler.yml`.

## Current State: 4 Workflows

### 1. auto-merge.yml — KEEP AS-IS
- **Trigger:** `pull_request` opened on main
- **Runner:** cloud (`ubuntu-latest`)
- **What it does:** Waits for merge check, validates AUTO_MERGE setting and ALLOWED_PATHS, then `gh pr merge --squash` for `agent-job/*` PRs
- **No changes needed** — pure GitHub operation, no host access required

### 2. notify-pr-complete.yml — KEEP AS-IS
- **Trigger:** `workflow_run` completed after auto-merge
- **Runner:** cloud (`ubuntu-latest`)
- **What it does:** Gathers job results (description, changed files, commit message, merge status, commit SHA), POSTs JSON to `/api/github/webhook`. Event handler then runs `summarizeAgentJob()` and saves a notification.
- **No changes needed** — just an HTTP POST from cloud runner to event handler

### 3. rebuild-event-handler.yml — NEEDS MIGRATION
- **Trigger:** `push` to main
- **Runner:** `self-hosted` (docker exec into event handler)
- **What it does:**
  1. `git fetch origin main` + `git reset --hard origin/main` inside event handler container (at `/project`)
  2. Skip if only `logs/` files changed
  3. Detect thepopebot npm version change in package-lock.json
  4. If version changed: `npx thepopebot init --no-install`, commit template changes, push
  5. If version changed: `docker compose pull event-handler`, stop/remove/recreate container
  6. If no version change: `npx pm2 reload all`

### 4. upgrade-event-handler.yml — NEEDS MIGRATION
- **Trigger:** `workflow_dispatch` (manual, with optional `target_version` input)
- **Runner:** `self-hosted` (docker exec into event handler)
- **What it does:**
  1. Clone repo to temp dir
  2. `npm install --omit=dev` then `npm update thepopebot` (or `npm install thepopebot@{version}` for beta)
  3. If version changed: create branch, commit, push, create PR, auto-merge
  4. Merged PR then triggers rebuild workflow

## Proposed Changes

### Upgrade → Ephemeral Docker Container
Replace the workflow dispatch with an ephemeral Docker container launched by the event handler (same pattern as agent jobs). The container:
1. Clones the repo
2. Runs `npm update thepopebot`
3. Creates a PR if version changed
4. Exits

The merged PR triggers rebuild via push to main. No host access needed — this is just "create a PR with updated deps."

`triggerUpgrade()` in `lib/chat/actions.js` would launch a container instead of calling `triggerWorkflowDispatch()`.

### Rebuild → Rewrite as Cloud Runner + Webhook
Rewrite the workflow to run on `ubuntu-latest` and POST to the event handler (same pattern as notify-pr-complete), instead of `docker exec` via self-hosted runner.

**The hard problem:** Step 5 above — the event handler needs to restart its own Docker container when the npm package version changes. The current self-hosted runner handles this from the outside. Options:

**Option A: Sidecar container**
A small dedicated container on the host with docker.sock access that receives a "rebuild" webhook. Replaces the self-hosted runner with a minimal sidecar in docker-compose.yml. Pros: clean separation, can restart the event handler from outside. Cons: another container to maintain.

**Option B: Event handler self-restart**
The event handler receives the webhook and does what it can: git pull, init, pm2 reload for non-version-change pushes. For version changes, it pulls the new image and orchestrates its own container replacement via Docker API (it already has docker.sock access). Pros: no extra container. Cons: restarting yourself is fragile.

**Option C: Keep rebuild as self-hosted (just migrate upgrade)**
The rebuild workflow genuinely needs host access for container restart. Could be the one workflow that keeps self-hosted. Only upgrade moves to a container. Pros: minimal change, proven pattern. Cons: still need the self-hosted runner.

## What Gets Removed After Migration

- `RUNS_ON` GitHub variable (no longer needed — cloud workflows use ubuntu-latest, self-hosted goes away)
- `runners-page.jsx` — standalone runners status page (only shows GitHub Actions workflow runs)
- GitHub Runners section in `containers-page.jsx`
- `getWorkflowRuns()`, `getWorkflowRunJobs()`, `getRunnersStatus()`, `triggerWorkflowDispatch()` from `lib/tools/github.js`
- `getRunnersStatus()` server action from `lib/chat/actions.js`
- Runners-related imports in UI components

## What Stays

- `auto-merge.yml` and `notify-pr-complete.yml` (cloud runners)
- GitHub secrets/variables management (still needed for cloud workflows — `GH_WEBHOOK_SECRET`, `AUTO_MERGE`, `ALLOWED_PATHS`, `APP_URL`, agent secrets)
- `/api/github/webhook` endpoint (extended to handle rebuild webhook)
- `settings-github-page.jsx` — tokens, secrets, variables UI
- `lib/github-api.js` — secrets/variables CRUD
- `fetchAgentJobLog()` — still used by notify webhook handler

## Key Files

| File | Role |
|------|------|
| `templates/.github/workflows/rebuild-event-handler.yml` | Rewrite or delete |
| `templates/.github/workflows/upgrade-event-handler.yml` | Delete |
| `lib/tools/github.js` | Remove workflow/runner API calls, keep PR/repo/log functions |
| `lib/chat/actions.js` | Rewrite `triggerUpgrade()`, remove `getRunnersStatus()` |
| `lib/chat/components/runners-page.jsx` | Delete |
| `lib/chat/components/containers-page.jsx` | Remove GitHub Runners section |
| `lib/chat/components/upgrade-dialog.jsx` | Update to use new upgrade mechanism |
| `api/index.js` | Extend webhook handler for rebuild events |
| `setup/lib/targets.mjs` | Remove `RUNS_ON` variable |
| `bin/managed-paths.js` | No change (still manages `.github/workflows/`) |
| `docker/claude-code-job/entrypoint.sh` | No change |
| `docker/pi-coding-agent-job/entrypoint.sh` | No change |

## Open Decision

How to handle rebuild's container restart problem (Options A/B/C above). This is the core blocker for fully eliminating the self-hosted runner.
