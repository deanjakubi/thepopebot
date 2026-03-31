#!/bin/bash
# Run the agent — capture exit code, log output to LOG_DIR

cd /home/coding-agent/workspace

# Override SYSTEM_PROMPT with the built file content for agents that use inline prompt
if [ -f "$SYSTEM_PROMPT_FILE" ]; then
    export SYSTEM_PROMPT=$(cat "$SYSTEM_PROMPT_FILE")
fi

# Force full permissions for job runtime
export PERMISSION=code

set +e
source /scripts/agents/${AGENT}/run.sh > "${LOG_DIR}/claude-session.jsonl" 2>"${LOG_DIR}/claude-stderr.log"
# AGENT_EXIT is set by the agent's run.sh
set -e
