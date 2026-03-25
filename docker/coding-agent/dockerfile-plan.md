# Unified Coding Agent Docker Image — Status

## Complete

| Component | Status |
|-----------|--------|
| **Base Dockerfile** | Done — Ubuntu 24.04, Node.js 22, GitHub CLI, ttyd, tmux, Playwright |
| **Dockerfile.claude-code** | Done |
| **Dockerfile.pi-coding-agent** | Done |
| **Dockerfile.gemini-cli** | Done |
| **Dockerfile.codex** | Done |
| **Dockerfile.opencode** | Done |
| **entrypoint.sh** | Done — validates RUNTIME + AGENT, sources numbered scripts, pretty-prints stages |
| **common/** scripts | Done — setup-git, clone, feature-branch, rebase-push |
| **agents/claude-code/** | Done — auth, setup, run, merge-back, interactive |
| **agents/pi/** | Done — auth, setup, run, merge-back, interactive |
| **agents/gemini/** | Done — auth, setup, run, merge-back, interactive |
| **agents/codex/** | Done — auth, setup, run, merge-back, interactive |
| **agents/opencode/** | Done — auth, setup, run, merge-back, interactive |
| **headless/** runtime | Done — 7 numbered scripts |
| **agent-job/** runtime | Done — 9 numbered scripts (setup-git, clone, auth, setup, install-skills, build-prompt, agent-run, commit-and-push, create-pr) |
| **interactive/** runtime | Done — 7 numbered scripts (setup-git, clone, feature-branch, auth, setup, chat-context, start-interactive) |
| **cluster-worker/** runtime | Done — 6 numbered scripts (setup-git, auth, setup, setup-logging, agent-run, finalize-logging) |
| **command/commit-branch/** | Done — 5 scripts (setup-git, auth, setup, git-add, agent-run) |
| **command/push-branch/** | Done — 6 scripts (setup-git, auth, setup, git-add, agent-run, push) |
| **command/create-pr/** | Done — 5 scripts (setup-git, auth, setup, push, agent-run). DRAFT=1 for draft PR. |
| **command/rebase-branch/** | Done — 2 scripts (setup-git, rebase) |
| **command/resolve-conflicts/** | Done — 4 scripts (setup-git, auth, setup, agent-run) |
| **Settings UI** | Done — all 5 agents, enable/disable, auth mode, provider, model, credential status |
| **Server actions** | Done — getCodingAgentSettings, updateCodingAgentConfig, setCodingAgentDefault, runWorkspaceCommand |
| **Docker functions** | Done — runCommandContainer, workspaceDirExists in lib/tools/docker.js |
| **Image references** | Done — unified image tags + RUNTIME env var in lib/tools/docker.js |
| **publish-npm.yml** | Done — two-phase build (base image → per-agent images), new matrix entries |
| **Env var rename** | Done — OPENAI_BASE_URL → CUSTOM_OPENAI_BASE_URL with DB migration |
| **Old images removed** | Done — deleted 5 legacy docker directories |
| **Stale docs cleaned** | Done — removed run-job.yml, build-image.yml, notify-job-failed.yml references |
| **test-headless.sh** | Tested — headless + claude-code + plan mode |
| **test-headless-pi.sh** | Tested — headless + pi + anthropic auto-detect |

---

## Remaining: Testing

| Runtime | claude-code | pi | gemini | codex | opencode |
|---------|:-----------:|:--:|:------:|:-----:|:--------:|
| **headless** | ✅ tested | ✅ tested | untested | untested | untested |
| **agent-job** | untested | untested | — | — | — |
| **interactive** | untested | untested | — | — | — |
| **cluster-worker** | untested | — | — | — | — |
| **command/*** | untested | untested | — | — | — |

Priority: agent-job + interactive for claude-code and pi, then headless for gemini/codex/opencode.

---

## Notes

- **PERMISSION** — Claude Code: plan/code. Gemini CLI: plan/yolo. Codex CLI: always full-auto. Pi/OpenCode: no permission system.
- **SYSTEM_PROMPT** — Claude Code: `--append-system-prompt`. Pi: `.pi/SYSTEM.md`. Gemini: `~/.gemini/SYSTEM.md`. Codex/OpenCode: AGENTS.md file.
- **CONTINUE_SESSION=1** — adds `-c` to agent CLI. Requires volume at `/home/coding-agent`.
- **CUSTOM_OPENAI_BASE_URL** — triggers `models.json` generation for Pi custom providers. Only time `--provider custom` is passed to Pi.
