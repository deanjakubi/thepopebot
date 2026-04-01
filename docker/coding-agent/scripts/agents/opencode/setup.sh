#!/bin/bash
# OpenCode setup — session tracking plugin, system prompt, Playwright MCP

WORKSPACE_DIR=$(pwd)

# Write system prompt to AGENTS.md (OpenCode reads this automatically)
if [ -n "$SYSTEM_PROMPT" ]; then
    echo "$SYSTEM_PROMPT" > "${WORKSPACE_DIR}/AGENTS.md"
else
    rm -f "${WORKSPACE_DIR}/AGENTS.md"
fi

# Create session tracker plugin
mkdir -p "${WORKSPACE_DIR}/.opencode/plugins"

cat > "${WORKSPACE_DIR}/.opencode/plugins/package.json" << 'EOF'
{
  "name": "opencode-session-tracker",
  "version": "1.0.0",
  "type": "module",
  "main": "session-tracker.mjs",
  "oc-plugin": ["server"]
}
EOF

cat > "${WORKSPACE_DIR}/.opencode/plugins/session-tracker.mjs" << 'PLUGIN'
export const SessionTracker = async ({ $ }) => {
  const fs = await import("fs");
  const path = await import("path");
  const dir = "/home/coding-agent/.opencode-ttyd-sessions";
  const port = process.env.PORT || "7681";
  const file = path.join(dir, port);
  let captured = false;

  return {
    event: async ({ event }) => {
      if (captured) return;
      const sessionID = event?.properties?.sessionID;
      if (!sessionID) return;
      captured = true;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, sessionID);
    }
  }
}
PLUGIN

# OpenCode config: register plugin
cat > "${WORKSPACE_DIR}/.opencode/opencode.jsonc" << 'EOF'
{
  "plugin": ["./plugins"]
}
EOF

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

# Activate agent-job-secrets skill when token is available (agent chat mode only)
if [ -n "$AGENT_JOB_TOKEN" ]; then
  ln -sf ../agent-job-secrets skills/active/agent-job-secrets 2>/dev/null || true
fi
