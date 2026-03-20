#!/bin/bash
set -e

# ══════════════════════════════════════════════════════════════════════
# Unified Coding Agent Entrypoint
# ══════════════════════════════════════════════════════════════════════
#
# Two env vars select what runs:
#   RUNTIME  — the workflow (what steps to execute)
#   AGENT    — the coding agent (what tool does the work)
#
# ── REQUIRED ─────────────────────────────────────────────────────────
#
#   RUNTIME             job | headless | interactive | cluster-worker | command/*
#                       Selects the script folder: /scripts/${RUNTIME}/
#
#   AGENT               claude-code | pi | gemini | codex | opencode
#                       Selects the agent folder: /scripts/agents/${AGENT}/
#
# ── GIT / REPO ───────────────────────────────────────────────────────
#
#   GH_TOKEN            GitHub personal access token (used by all runtimes)
#   REPO                GitHub owner/repo slug (headless, interactive)
#   REPO_URL            Full git clone URL (job — includes token in URL)
#   BRANCH              Base branch to clone/checkout (default: main)
#   FEATURE_BRANCH      Feature branch to create or checkout (headless, interactive)
#
# ── AGENT ────────────────────────────────────────────────────────────
#
#   PROMPT              Task prompt passed to the agent via -p flag
#                       (headless, cluster-worker; job builds its own from config)
#   SYSTEM_PROMPT       Optional. Inline system prompt text. Nullable.
#                       Claude Code: --append-system-prompt
#                       Pi: written to .pi/SYSTEM.md (auto-loaded)
#   PERMISSION          plan | code (default: code)
#                       Controls agent permission mode (Claude Code only;
#                       Pi has no built-in permission system — TODO: address later)
#   CONTINUE_SESSION    1 = continue most recent session in the workspace
#                       Adds -c flag to agent CLI. Requires persistent volume.
#                       Saves ~40% tokens on multi-step workflows.
#   LLM_MODEL           Model override — passed to agent CLI via -m flag
#
# ── AUTH ─────────────────────────────────────────────────────────────
#   Pass whichever key(s) your agent/provider needs:
#
#   CLAUDE_CODE_OAUTH_TOKEN   OAuth token (Claude Code agent only)
#   ANTHROPIC_API_KEY         Anthropic API key
#   OPENAI_API_KEY            OpenAI API key
#   GOOGLE_API_KEY            Google API key
#   CUSTOM_API_KEY            Custom provider API key (if endpoint needs auth)
#   CUSTOM_OPENAI_BASE_URL           Custom OpenAI-compatible endpoint URL
#
# ── JOB RUNTIME ──────────────────────────────────────────────────────
#
#   JOB_TITLE           PR title and commit message
#   JOB_DESCRIPTION     PR body and prompt content
#   JOB_ID              Log directory name (fallback: extracted from branch)
#   SECRETS             JSON blob of AGENT_* secrets (from GitHub Actions)
#   LLM_SECRETS         JSON blob of AGENT_LLM_* secrets (from GitHub Actions)
#
# ── INTERACTIVE RUNTIME ──────────────────────────────────────────────
#
#   CHAT_CONTEXT        JSON planning conversation for SessionStart hook
#   PORT                ttyd port (default: 7681)
#
# ── CLUSTER-WORKER RUNTIME ───────────────────────────────────────────
#
#   LOG_DIR             Directory for session logs (stdout/stderr + meta.json)
#
# ══════════════════════════════════════════════════════════════════════

if [ -z "$RUNTIME" ]; then
    echo "ERROR: RUNTIME env var is required (job, headless, interactive, cluster-worker, command/*)"
    exit 1
fi

if [ ! -d "/scripts/${RUNTIME}" ]; then
    echo "ERROR: Unknown runtime '${RUNTIME}' — no scripts found at /scripts/${RUNTIME}/"
    exit 1
fi

if [ -z "$AGENT" ]; then
    echo "ERROR: AGENT env var is required (claude-code, pi, gemini, codex, opencode)"
    exit 1
fi

if [ ! -d "/scripts/agents/${AGENT}" ]; then
    echo "ERROR: Unknown agent '${AGENT}' — no scripts found at /scripts/agents/${AGENT}/"
    exit 1
fi

for script in /scripts/${RUNTIME}/*.sh; do
    # Transform "1_setup-git.sh" → "Setup Git"
    pretty=$(basename "$script" .sh | sed 's/^[0-9]*_//' | sed 's/[-_]/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1')
    echo "→ ${pretty}"
    source "$script"
done
