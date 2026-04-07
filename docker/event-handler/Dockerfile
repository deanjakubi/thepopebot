# ── Stage 1: builder ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
# Rename package to avoid npm treating "thepopebot" as a self-install
RUN TPB_VERSION=$(node -p "require('./package.json').version") && \
    echo "{\"private\":true}" > package.json && \
    npm install --no-save "thepopebot@${TPB_VERSION}" tailwindcss @tailwindcss/postcss

# ── Stage 2: Next.js build ───────────────────────────────────────
FROM node:22-bookworm-slim AS nextjs
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
# Use a minimal package.json to avoid self-referencing exports
# (the repo package.json has name "thepopebot", which makes Node resolve
# imports like 'thepopebot/config' to ./config/ instead of node_modules)
RUN echo '{"private":true}' > package.json
COPY web/ ./
RUN ./node_modules/.bin/next build

# ── Stage 3: runtime ─────────────────────────────────────────────
FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl git ca-certificates && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g pm2

# Run as coding-agent (UID 1001) so files created by in-process SDK
# are natively owned by the same user as interactive coding agent containers.
# Docker socket access via the docker group.
RUN useradd -m -s /bin/bash -u 1001 coding-agent && \
    groupadd -g 999 docker && \
    usermod -aG docker coding-agent

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
RUN echo '{"private":true}' > package.json
COPY --from=nextjs /app/.next ./.next
COPY web/server.js web/next.config.mjs web/instrumentation.js web/middleware.js web/postcss.config.mjs ./
RUN chown -R coding-agent:coding-agent /app

USER coding-agent

EXPOSE 80
CMD ["pm2-runtime", "--kill-timeout", "120000", "server.js"]
