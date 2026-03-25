#!/bin/bash
# OpenCode setup — write system prompt + Playwright MCP

WORKSPACE_DIR=$(pwd)

# Write system prompt to AGENTS.md (OpenCode reads this automatically)
if [ -n "$SYSTEM_PROMPT" ]; then
    echo "$SYSTEM_PROMPT" > "${WORKSPACE_DIR}/AGENTS.md"
else
    rm -f "${WORKSPACE_DIR}/AGENTS.md"
fi

# Register Playwright MCP server for browser automation
cat > "${WORKSPACE_DIR}/.opencode.json" << 'EOF'
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--headless", "--browser", "chromium"],
      "env": []
    }
  }
}
EOF
