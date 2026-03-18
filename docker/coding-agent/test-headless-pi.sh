#!/bin/bash
set -e

# ── Load env vars from my-popebot ──
ENV_FILE="/Users/stephengpope/my-popebot/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE not found"
    exit 1
fi

source "$ENV_FILE"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Build base image (skip if already cached) ──
echo "Building base image..."
docker build --platform linux/amd64 -t coding-agent-base "$SCRIPT_DIR"

# ── Build pi image ──
echo ""
echo "Building pi image..."
docker build --platform linux/amd64 -t coding-agent-pi -f "$SCRIPT_DIR/Dockerfile.pi-coding-agent" "$SCRIPT_DIR"

# ── Run headless test (plan mode equivalent — no feature branch = read-only) ──
echo ""
echo "Running: RUNTIME=headless | AGENT=pi | provider=anthropic"
echo ""

docker run --rm --platform linux/amd64 \
    -e RUNTIME=headless \
    -e REPO="${GH_OWNER}/${GH_REPO}" \
    -e BRANCH=main \
    -e PROMPT="List the top-level files and describe this project in 2 sentences." \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
    -e GH_TOKEN="${GH_TOKEN}" \
    coding-agent-pi
