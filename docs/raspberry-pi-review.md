# Raspberry Pi Deployment Review

Analysis of what it would take to run thepopebot on a Raspberry Pi — both as a UI-only host (runners stay on GitHub) and as a full self-hosted stack (UI + runners on Pi).

---

## Current Architecture Recap

```
User's repo (GitHub)
  │
  ├─ Event Handler (Next.js) ── runs in Docker on a server
  │    ├─ Web UI / Chat
  │    ├─ Telegram bot
  │    ├─ Cron scheduler
  │    ├─ Webhook triggers
  │    └─ Job dispatch (creates job/* branches)
  │
  ├─ GitHub Actions Runner ── executes run-job.yml
  │    └─ docker run --rm <agent-image>
  │         ├─ Pi coding agent  (default)
  │         └─ Claude Code agent (optional)
  │
  └─ docker-compose.yml
       ├─ traefik        (reverse proxy / TLS)
       ├─ event-handler  (Next.js app)
       └─ runner          (self-hosted GitHub Actions runner)
```

---

## Scenario 1: Pi Runs the UI, Runners Stay on GitHub

**Pi handles**: Event Handler (Next.js + SQLite + crons + Telegram)
**GitHub handles**: Agent jobs via `ubuntu-latest` runners

This is the simpler path. The Pi just needs to run a Node.js/Next.js server.

### What Works Today (No Changes)

| Component | Status | Notes |
|-----------|--------|-------|
| Next.js 15 | Works | No architecture-specific code |
| SQLite (better-sqlite3) | Works | Compiles on ARM with build tools already in Dockerfile |
| Drizzle ORM | Works | Pure JavaScript |
| bcrypt-ts | Works | Pure JS (WASM), not native `bcrypt` |
| LangChain / LangGraph | Works | Pure JS, all LLM calls are remote API calls |
| node-cron | Works | Pure JS scheduler |
| grammY (Telegram) | Works | Pure JS |
| PM2 | Works | Official ARM support |
| GitHub CLI | Works | Official ARM64 `.deb` packages, already handled in Dockerfile via `dpkg --print-architecture` |

### What Needs Attention

#### 1. Docker base image — already ARM-compatible

`node:22-bookworm-slim` is a multi-arch manifest. Docker on a Pi 4/5 (arm64) or Pi 3 (armv7) will automatically pull the correct variant. No Dockerfile changes needed for the event handler.

#### 2. Pre-built event handler image may be x86-only

The published Docker Hub image `stephengpope/thepopebot:event-handler-<version>` is likely built on x86 CI. On a Pi, `docker compose up` would fail to pull it.

**Fix options:**
- Build locally on the Pi: `docker compose build event-handler` (slow first time, ~10-15 min on Pi 4 for native module compilation)
- Publish multi-arch images from CI using `docker buildx build --platform linux/arm64,linux/amd64`
- Use `EVENT_HANDLER_IMAGE_URL` override in `.env` to point at a custom GHCR image built for ARM

#### 3. Memory budget

The event handler (Next.js + LangGraph singleton + SQLite + crons) sits around **300-500 MB** at runtime.

| Pi Model | RAM | Verdict |
|----------|-----|---------|
| Pi 5 (4/8 GB) | Comfortable | Plenty of headroom |
| Pi 4 (4 GB) | Fine | ~3 GB free for OS + other services |
| Pi 4 (2 GB) | Tight | Works but no room for extras |
| Pi 3 (1 GB) | Not recommended | OOM risk under load |
| Pi Zero 2 W | Not recommended | 512 MB, ARM64 but too constrained |
| Pi Zero (v1) | Incompatible | ARMv6, Node 18+ unavailable |

**Recommendation:** Add `max_memory_restart` to PM2 config for safety:

```js
// ecosystem.config.cjs
{
  name: 'next',
  script: 'node_modules/.bin/next',
  args: 'start -p 80',
  kill_timeout: 120000,
  max_memory_restart: '512M',  // Pi safety net
}
```

#### 4. SD card wear from SQLite WAL

SQLite WAL mode writes frequently to `.sqlite-wal` and `.sqlite-shm`. On an SD card this causes wear over time.

**Recommendations:**
- Mount `data/` on a USB SSD (even a cheap one lasts years)
- Or set `DATABASE_PATH=/tmp/thepopebot.sqlite` for ephemeral setups (data lost on reboot)
- The `NEXT_BUILD_DIR` env var (already supported in `config/index.js:15`) can redirect build artifacts off the SD card too

#### 5. Next.js build step is slow on Pi

`npm run build` (Next.js compilation) takes ~2-5 minutes on Pi 4, longer on Pi 3. This matters for:
- Initial setup
- `rebuild-event-handler.yml` workflow (already runs on `self-hosted`)

Not a blocker, just slower. The existing `NEXT_BUILD_DIR=.next-new` swap pattern in `rebuild-event-handler.yml` handles this well — the app stays up during the build.

#### 6. Traefik reverse proxy — works on ARM

`traefik:v3` publishes multi-arch images including `linux/arm64` and `linux/arm/v7`. No changes needed.

### Changes Required for Scenario 1

**None mandatory.** The current codebase works on Pi for the event handler as long as:
1. You build the event handler image locally (or publish multi-arch images)
2. You set `RUNS_ON` to its default (`ubuntu-latest`) so jobs run on GitHub, not on the Pi
3. Pi 4 with 4+ GB RAM

**Nice-to-haves:**
- Publish multi-arch event handler images from CI
- Add `max_memory_restart` to PM2 config
- Document SSD recommendation for `data/` directory

---

## Scenario 2: Pi Also Runs the Runners

**Pi handles**: Everything — event handler + self-hosted GitHub Actions runner + Docker agent containers

This is where things get more interesting.

### The Runner Image Problem

The current `docker-compose.yml` uses `myoung34/github-runner:latest` for the self-hosted runner.

```yaml
runner:
  image: myoung34/github-runner:latest  # <-- x86-only by default
  deploy:
    replicas: ${RUNNER_REPLICAS:-2}
```

**Problem:** `myoung34/github-runner:latest` is an x86-64 image. On an ARM Pi, `docker pull` will fail.

**Fix:** The `myoung34/github-runner` image actually supports multi-arch tags:
- `myoung34/github-runner:latest` — x86 only
- `myoung34/github-runner:ubuntu-jammy` — multi-arch (includes arm64)

Or use the official GitHub runner:
- `ghcr.io/actions/runner:latest` — multi-arch

**Proposed change** to `docker-compose.yml`:
```yaml
runner:
  image: ${RUNNER_IMAGE:-myoung34/github-runner:ubuntu-jammy}
```

This lets users override while defaulting to a multi-arch tag.

### Agent Job Images Must Be ARM

When `run-job.yml` fires, it does `docker run <image>`. The agent images (`stephengpope/thepopebot:job-<version>` and `job-claude-code-<version>`) are pulled from Docker Hub.

If these are built x86-only, they won't run on the Pi runner.

**Fix options:**

1. **Publish multi-arch agent images** — Update CI to build with `--platform linux/arm64,linux/amd64`. This is the cleanest path.

2. **Build locally via `build-image.yml`** — This workflow already exists and builds from `docker/job-pi-coding-agent/`. On a self-hosted Pi runner, it would build natively for ARM. But it only triggers when `JOB_IMAGE_URL` is set to a `ghcr.io/` path.

3. **Pre-build on the Pi itself** — `docker build` the agent image once on the Pi, tag it locally, and set `JOB_IMAGE_URL` to the local tag. The `run-job.yml` already supports custom image URLs.

**Recommended approach:** Option 2. Users set `JOB_IMAGE_URL=ghcr.io/<owner>/<repo>/job:latest` as a GitHub variable, and `build-image.yml` handles the rest. The only needed change is adding an explicit `platforms` flag:

```yaml
# build-image.yml
- name: Build and push
  uses: docker/build-push-action@v6
  with:
    context: ./docker/job-pi-coding-agent
    push: true
    tags: ${{ vars.JOB_IMAGE_URL }}:latest
    platforms: linux/arm64  # <-- add this for Pi
```

Or better, detect the runner's architecture dynamically.

### Agent Dependencies on ARM

Inside the agent container, two global npm packages get installed:

| Package | Dockerfile | ARM Status |
|---------|-----------|------------|
| `@mariozechner/pi-coding-agent` | `job-pi-coding-agent/Dockerfile` | Pure JS + native deps compiled in container. Should work. |
| `@anthropic-ai/claude-code` | `job-claude-code/Dockerfile` | Unclear — may bundle platform-specific binaries. Needs testing. |

Both Dockerfiles install Chrome/Chromium system libraries for the browser-tools skill. On ARM64:
- Chromium is available via `apt install chromium` on Debian Bookworm ARM64
- But Puppeteer downloads its own Chromium binary, and **Puppeteer's bundled Chromium may not have ARM builds** for all versions

**Fix for Puppeteer/Chrome on ARM:**
```dockerfile
# In Dockerfile, after npm install
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN apt-get update && apt-get install -y chromium
ENV CHROME_BIN=/usr/bin/chromium
```

The entrypoint already searches for Chrome dynamically:
```bash
CHROME_BIN=$(find /root/.cache/puppeteer -name "chrome" -type f 2>/dev/null | head -1)
```

This would need to also check `/usr/bin/chromium` as a fallback.

### Memory Under Full Load

Running everything on the Pi means concurrent containers:

| Process | Memory | Duration |
|---------|--------|----------|
| Event Handler (always on) | ~400 MB | Permanent |
| Traefik (always on) | ~30 MB | Permanent |
| Runner 1 (always on) | ~100 MB | Permanent |
| Runner 2 (always on) | ~100 MB | Permanent |
| Agent container (per job) | ~500-800 MB | Minutes to hours |
| Chromium (if browser skill) | ~200-400 MB | During browser tasks |

**Total baseline:** ~630 MB (no jobs running)
**Peak with 1 agent job:** ~1.3-1.8 GB
**Peak with agent + browser:** ~1.5-2.2 GB

| Pi Model | Verdict for Full Stack |
|----------|----------------------|
| Pi 5 (8 GB) | Good — can run 2 concurrent jobs |
| Pi 5 (4 GB) | OK — 1 job at a time comfortably |
| Pi 4 (4 GB) | Tight — 1 job, no browser skill |
| Pi 4 (2 GB) | Not viable for runner + agent |

**Recommendation:** Set `RUNNER_REPLICAS=1` on Pi to avoid running two agents concurrently.

### CPU Considerations

Pi 5 has a quad-core Cortex-A76 @ 2.4 GHz — meaningfully faster than Pi 4's Cortex-A72 @ 1.8 GHz.

Agent jobs are mostly I/O bound (waiting for LLM API responses, git operations). The CPU-intensive parts are:
- `npm install` inside the agent container (compiling native modules for skills)
- Next.js builds (if the agent modifies the project)
- Chromium rendering (if browser skill is active)

Pi 5 handles all of these adequately. Pi 4 works but noticeably slower for npm installs.

### Network: GitHub Actions Webhooks Must Reach the Pi

If running self-hosted runners, the Pi needs:
- Outbound HTTPS to `github.com` and `api.github.com` (runner polls for jobs)
- Outbound HTTPS to LLM APIs (Anthropic, OpenAI, etc.)
- Inbound HTTP/HTTPS for the event handler (Telegram webhooks, browser access)

The runner uses a **polling model** (not inbound webhooks), so no special firewall/port-forwarding needed for the runner itself. Only the event handler needs to be reachable from the internet (already handled by Traefik + your DNS/port-forward setup).

---

## Summary of Needed Changes

### For Scenario 1 (UI only, runners on GitHub)

No code changes required. Documentation only:
- Document Pi hardware recommendations (Pi 4+ with 4 GB)
- Document SSD recommendation for `data/` directory
- Consider publishing multi-arch event handler images

### For Scenario 2 (Full stack on Pi)

| Change | File(s) | Effort |
|--------|---------|--------|
| Make runner image configurable + default to multi-arch tag | `templates/docker-compose.yml` | Small — one line |
| Add `platforms` flag to build-image workflow (or make it dynamic) | `templates/.github/workflows/build-image.yml` | Small |
| Publish multi-arch agent images from CI | CI pipeline (not in this repo) | Medium |
| Handle Puppeteer/Chrome on ARM in agent Dockerfiles | `templates/docker/job-*/Dockerfile` | Small-medium |
| Update entrypoint to find system Chromium as fallback | `templates/docker/job-*/entrypoint.sh` | Small |
| Add `max_memory_restart` to PM2 config | `templates/docker/event-handler/ecosystem.config.cjs` | Trivial |
| Default `RUNNER_REPLICAS=1` when on ARM or add docs | `templates/docker-compose.yml` or docs | Trivial |

### What Doesn't Need to Change

- `api/`, `lib/`, `config/`, `bin/` — all pure JavaScript, no architecture-specific code
- `package.json` dependencies — only `better-sqlite3` is native, and it compiles cleanly on ARM with the build tools already in the Dockerfile
- SQLite / Drizzle — works on ARM, WAL mode is fine
- LangChain / LangGraph — cloud API calls, no local inference
- Cron scheduler, Telegram bot, auth — all platform-agnostic
- GitHub CLI — already uses `dpkg --print-architecture` for correct ARM package

### Bottom Line

**The codebase is architecturally ready for Raspberry Pi.** There are no x86 assumptions in the application code. The work is entirely in the Docker/infrastructure layer:

1. **UI-only on Pi** — works today with a local image build. Zero code changes.
2. **Full stack on Pi** — needs ~5 small changes to Docker and workflow files, focused on multi-arch image support and the runner image selection. Pi 5 with 4+ GB is the sweet spot.
