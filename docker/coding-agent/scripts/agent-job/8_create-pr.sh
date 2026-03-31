#!/bin/bash
# Create PR with log permalink, then exit with agent's exit code

cd /home/coding-agent/workspace

set +e

REPO_SLUG=$(gh repo view --json nameWithOwner -q .nameWithOwner)
LOG_URL="https://github.com/${REPO_SLUG}/tree/${LOG_SHA}/logs/${AGENT_JOB_ID}"

gh pr create \
    --title "🤖 Agent Job: ${AGENT_JOB_TITLE}" \
    --body "📋 [View Job Logs](${LOG_URL})"$'\n\n---\n\n'"${AGENT_JOB_DESCRIPTION}" \
    --base main || true

set -e

# Re-raise failure so the container reports it
if [ "${AGENT_EXIT:-0}" -ne 0 ]; then
    echo "Agent exited with code ${AGENT_EXIT}"
    exit $AGENT_EXIT
fi

echo "Done. Agent Job ID: ${AGENT_JOB_ID}"
