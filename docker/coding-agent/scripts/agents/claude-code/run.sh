#!/bin/bash
# Run Claude Code headlessly with the given PROMPT
# Sets AGENT_EXIT for downstream scripts (commit, push, etc.)
# PERMISSION: plan = restricted mode, code or empty = full access
# CONTINUE_SESSION: 1 = resume session for this port if session file exists

CLAUDE_ARGS=(-p "$PROMPT" --verbose --output-format stream-json)

if [ -n "$LLM_MODEL" ]; then
    CLAUDE_ARGS+=(--model "$LLM_MODEL")
fi

if [ -f /home/coding-agent/SYSTEM.md ]; then
    CLAUDE_ARGS+=(--append-system-prompt-file /home/coding-agent/SYSTEM.md)
elif [ -n "$SYSTEM_PROMPT" ]; then
    CLAUDE_ARGS+=(--append-system-prompt "$SYSTEM_PROMPT")
fi

if [ "$PERMISSION" = "plan" ]; then
    CLAUDE_ARGS+=(--permission-mode plan)
else
    CLAUDE_ARGS+=(--dangerously-skip-permissions)
fi

SESSION_FILE="/home/coding-agent/.claude-ttyd-sessions/7681"
if [ "$CONTINUE_SESSION" = "1" ] && [ -f "$SESSION_FILE" ]; then
    CLAUDE_ARGS+=(--resume "$(cat $SESSION_FILE)")
fi

set +e
claude "${CLAUDE_ARGS[@]}"
AGENT_EXIT=$?
set -e
