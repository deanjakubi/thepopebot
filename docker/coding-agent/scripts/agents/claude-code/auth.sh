#!/bin/bash
# If OAuth token is provided, use it (unset API key so Claude Code picks OAuth)
if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    unset ANTHROPIC_API_KEY
fi
# Otherwise ANTHROPIC_API_KEY stays in env and Claude Code uses it directly
