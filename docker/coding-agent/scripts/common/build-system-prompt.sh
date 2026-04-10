#!/bin/bash
# Build SYSTEM_PROMPT from agent-job/SYSTEM.md
# Fallback for agent-job containers (interactive/headless use pre-rendered file from EH)
# Only runs when AGENT_JOB_TOKEN is set (agent mode)

if [ -n "$AGENT_JOB_TOKEN" ]; then
    WORKSPACE_DIR=$(pwd)
    SYSTEM_PROMPT=""

    if [ -f "${WORKSPACE_DIR}/agent-job/SYSTEM.md" ]; then
        SYSTEM_PROMPT=$(cat "${WORKSPACE_DIR}/agent-job/SYSTEM.md")
    fi

    # Resolve {{datetime}} template variable
    SYSTEM_PROMPT=$(echo "$SYSTEM_PROMPT" | sed "s/{{datetime}}/$(date -u +"%Y-%m-%dT%H:%M:%SZ")/g")

    export SYSTEM_PROMPT
fi
