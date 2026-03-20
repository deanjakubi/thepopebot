# Unified Coding Agent Docker Image — Remaining Work

## What's Done

Everything in the **agents** and **headless runtime** layers is complete:

| Component | Status |
|-----------|--------|
| **Base Dockerfile** | Done — Ubuntu 24.04, Node.js 22, GitHub CLI, ttyd, tmux, Playwright |
| **Dockerfile.claude-code** | Done |
| **Dockerfile.pi** | Done |
| **Dockerfile.gemini-cli** | Done |
| **Dockerfile.codex-cli** | Done |
| **Dockerfile.opencode** | Done |
| **entrypoint.sh** | Done — validates RUNTIME + AGENT, sources numbered scripts, pretty-prints stages |
| **common/** scripts | Done — setup-git, clone-or-reset, feature-branch, rebase-push |
| **agents/claude-code/** | Done — auth, setup, run, merge-back, interactive |
| **agents/pi/** | Done — auth, setup, run, merge-back, interactive |
| **agents/gemini/** | Done — auth, setup, run, merge-back, interactive |
| **agents/codex/** | Done — auth, setup, run, merge-back, interactive |
| **agents/opencode/** | Done — auth, setup, run, merge-back, interactive |
| **headless/ runtime** | Done — 7 numbered scripts |
| **CLAUDE.md** | Done |
| **Settings UI** | Done — all 5 agents, enable/disable, auth mode, provider, model, credential status |
| **Server actions** | Done — getCodingAgentSettings, updateCodingAgentConfig, setCodingAgentDefault |
| **test-headless.sh** | Tested — headless + claude-code + plan mode |
| **test-headless-pi.sh** | Tested — headless + pi + anthropic auto-detect |

---

## Done: Command Runtimes

| Component | Status |
|-----------|--------|
| **command/commit-to-main/** | Done — 6 scripts (setup-git, auth, setup, git-add, agent-run, push) |
| **command/create-pr/** | Done — 5 scripts (setup-git, auth, setup, push, agent-run). DRAFT=1 for draft PR. |
| **command/rebase/** | Done — 4 scripts (setup-git, auth, setup, rebase with agent conflict resolution) |
| **Server action** | Done — `runWorkspaceCommand()` in `lib/code/actions.js` |
| **Docker function** | Done — `runCommandContainer()` + `workspaceDirExists()` in `lib/tools/docker.js` |
| **UI** | Done — Split button in chat branch bar (`code-mode-toggle.jsx`) |

---

## Remaining: Runtime Scripts

### job/

Port the existing `claude-code-job` + `pi-coding-agent-job` entrypoints into the unified format.

- [ ] `job/1_unpack-secrets.sh` — SECRETS/LLM_SECRETS JSON → env vars
- [ ] `job/2_setup-git.sh` — source common/setup-git.sh
- [ ] `job/3_clone.sh` — git clone --single-branch --depth 1
- [ ] `job/4_agent-auth.sh` — source agents/${AGENT}/auth.sh
- [ ] `job/5_agent-setup.sh` — source agents/${AGENT}/setup.sh
- [ ] `job/6_install-skills.sh` — npm install in skills/active/*/
- [ ] `job/7_build-prompt.sh` — concat SOUL.md + JOB_AGENT.md, resolve {{datetime}}
- [ ] `job/8_agent-run.sh` — source agents/${AGENT}/run.sh
- [ ] `job/9_commit-and-pr.sh` — commit, push, remove logs, gh pr create
- [ ] Test: job + claude-code
- [ ] Test: job + pi

### interactive/

- [x] `interactive/1_setup-git.sh` — source common/setup-git.sh
- [x] `interactive/2_clone-or-reset.sh` — source common/clone-or-reset.sh
- [x] `interactive/3_feature-branch.sh` — source common/feature-branch.sh
- [x] `interactive/4_agent-auth.sh` — source agents/${AGENT}/auth.sh
- [x] `interactive/5_agent-setup.sh` — source agents/${AGENT}/setup.sh
- [x] `interactive/6_chat-context.sh` — write CHAT_CONTEXT to .claude/chat-context.txt + SessionStart hook
- [x] `interactive/7_start-interactive.sh` — source agents/${AGENT}/interactive.sh
- [ ] Test: interactive + claude-code
- [ ] Test: interactive + pi

### cluster-worker/

- [ ] `cluster-worker/1_setup-git.sh` — source common/setup-git.sh (conditional — skips if no GH_TOKEN)
- [ ] `cluster-worker/2_agent-auth.sh` — source agents/${AGENT}/auth.sh
- [ ] `cluster-worker/3_agent-setup.sh` — source agents/${AGENT}/setup.sh
- [ ] `cluster-worker/4_setup-logging.sh` — mkdir LOG_DIR, prep meta.json
- [ ] `cluster-worker/5_agent-run.sh` — source agents/${AGENT}/run.sh (with tee to log files)
- [ ] `cluster-worker/6_finalize-logging.sh` — write endedAt to meta.json
- [ ] Test: cluster-worker + claude-code

---

## Remaining: Caller Updates

These happen in the npm package after runtime scripts are built and tested.

- [ ] **Volume mount scope** — change from `/home/coding-agent/workspace` to `/home/coding-agent` in `lib/tools/docker.js` so agent sessions persist for CONTINUE_SESSION
- [ ] **Image references** — update callers to use unified image tags + pass RUNTIME env var:
  - `lib/tools/docker.js` — runInteractiveContainer(), runHeadlessContainer(), runClusterWorkerContainer()
  - `lib/cluster/execute.js` — runClusterRole()
  - `lib/code/actions.js` — startInteractiveMode(), ensureCodeWorkspaceContainer()
- [ ] **run-job.yml workflow** — update to use unified image + RUNTIME=job + AGENT from AGENT_BACKEND
- [ ] **AGENT_BACKEND mapping** — map existing GitHub variable values to AGENT env var
- [ ] **Env var rename** — OPENAI_BASE_URL → CUSTOM_OPENAI_BASE_URL in callers + docs + setup wizard
- [ ] **Remove old images** — delete docker/claude-code-job/, docker/claude-code-headless/, docker/claude-code-workspace/, docker/claude-code-cluster-worker/, docker/pi-coding-agent-job/

---

## Remaining: Testing Matrix

Not all runtime × agent combinations need testing, but the key ones do:

| Runtime | claude-code | pi | gemini | codex | opencode |
|---------|:-----------:|:--:|:------:|:-----:|:--------:|
| **headless** | ✅ tested | ✅ tested | untested | untested | untested |
| **job** | not built | not built | — | — | — |
| **interactive** | built | built | — | — | — |
| **cluster-worker** | not built | not built | — | — | — |

Priority testing: headless for gemini/codex/opencode, then job + interactive + cluster-worker for claude-code and pi.

---

## Notes

- **PERMISSION** — Claude Code: plan/code. Gemini CLI: plan/yolo. Codex CLI: always full-auto. Pi/OpenCode: no permission system.
- **SYSTEM_PROMPT** — Claude Code: `--append-system-prompt`. Pi: `.pi/SYSTEM.md`. Gemini: `~/.gemini/SYSTEM.md`. Codex/OpenCode: AGENTS.md file.
- **CONTINUE_SESSION=1** — adds `-c` to agent CLI. Requires volume at `/home/coding-agent`.
- **CUSTOM_OPENAI_BASE_URL** — triggers `models.json` generation for Pi custom providers. Only time `--provider custom` is passed to Pi.
