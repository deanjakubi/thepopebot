#!/bin/bash
# Commit changes, rebase onto base branch, and push.
# Skipped if no FEATURE_BRANCH (nothing to push to) or plan mode.
# On rebase conflict, falls back to agent-specific merge resolution.

if [ "${AGENT_EXIT:-0}" -ne 0 ]; then
    echo "AGENT_FAILED"
    echo "Task failed. You can switch to interactive mode to investigate."
    exit $AGENT_EXIT
fi

if [ -z "$FEATURE_BRANCH" ] || [ "$PERMISSION" = "plan" ]; then
    echo "No changes to commit."
    exit 0
fi

git add -A
git diff --cached --quiet && { echo "No changes to commit."; exit 0; }
git commit -m "feat: headless task" || true

git fetch origin
git rebase "origin/$BRANCH" || {
    git rebase --abort
    source /scripts/agents/${AGENT}/merge-back.sh
}

git push --force-with-lease origin HEAD
echo "PUSH_SUCCESS"
