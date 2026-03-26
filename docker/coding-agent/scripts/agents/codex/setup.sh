#!/bin/bash
# Codex CLI setup — config, system prompt, Playwright MCP

WORKSPACE_DIR=$(pwd)

# Write system prompt to AGENTS.md (Codex reads this automatically)
if [ -n "$SYSTEM_PROMPT" ]; then
    echo "$SYSTEM_PROMPT" > "${WORKSPACE_DIR}/AGENTS.md"
else
    rm -f "${WORKSPACE_DIR}/AGENTS.md"
fi

# Pre-configure trust, model, and MCP to skip interactive prompts
mkdir -p ~/.codex

cat > ~/.codex/config.toml << EOF
$([ -n "$LLM_MODEL" ] && echo "model = \"${LLM_MODEL}\"")

[projects."${WORKSPACE_DIR}"]
trust_level = "trusted"

[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--headless", "--browser", "chromium"]
EOF
