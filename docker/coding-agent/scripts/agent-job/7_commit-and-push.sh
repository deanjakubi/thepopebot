#!/bin/bash
# Commit based on agent outcome, then push

cd /home/coding-agent/workspace

set +e

if [ "${AGENT_EXIT:-0}" -ne 0 ]; then
    # Agent failed — only commit session logs, not partial code changes
    git reset || true
    git add -f "${LOG_DIR}" 2>/dev/null || true
    git commit -m "🤖 Agent Job: ${AGENT_JOB_TITLE} (failed)" || true
else
    # Agent succeeded — commit everything
    git add -A
    git add -f "${LOG_DIR}" 2>/dev/null || true
    git commit -m "🤖 Agent Job: ${AGENT_JOB_TITLE}" || true
fi

git push origin || true

# Capture log commit SHA, then remove logs so they don't merge into main
export LOG_SHA=$(git rev-parse HEAD)
git rm -rf "${LOG_DIR}" 2>/dev/null || true
git commit -m "done." || true
git push origin || true

set -e
