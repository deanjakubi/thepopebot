/**
 * Port scanner for code workspace containers.
 * Polls `ss -tlnp` inside containers to detect listening ports in a
 * configurable range, then writes Traefik dynamic config for routing.
 *
 * Lifecycle is tied to WebSocket connections in ws-proxy.js:
 *   - First WS connection for a workspace → start scanning
 *   - Last WS connection closes → stop scanning + clean up routes
 */

import fs from 'fs';
import path from 'path';
import { addForward, removeForward, getForwards, clearWorkspaceForwards } from './port-forwards.js';

const SCAN_INTERVAL_MS = 2000;
const PORT_RANGE_START = 3000;
const PORT_RANGE_END = 3010;

// Reference-counted scanners: workspaceId → { interval, containerName, refCount }
const SCANNER_KEY = '__portScanners';
if (!globalThis[SCANNER_KEY]) {
  globalThis[SCANNER_KEY] = new Map();
}
const scanners = globalThis[SCANNER_KEY];

/**
 * Parse `ss -tlnp` output and return listening ports in the target range.
 * @param {string} output - Raw ss output
 * @returns {Set<number>}
 */
function parseListeningPorts(output) {
  const ports = new Set();
  if (!output) return ports;

  for (const line of output.split('\n')) {
    // Match lines like: LISTEN  0  511  *:3000  *:*  users:(("node",pid=1234))
    // or:               LISTEN  0  511  0.0.0.0:3000  0.0.0.0:*
    // or:               LISTEN  0  511  [::]:3000     [::]:*
    const match = line.match(/:(\d+)\s/);
    if (!match) continue;

    const port = parseInt(match[1], 10);
    if (port >= PORT_RANGE_START && port <= PORT_RANGE_END) {
      ports.add(port);
    }
  }

  return ports;
}

/**
 * Write Traefik dynamic config JSON for all active port forwards.
 * Traefik's file provider watches this file and hot-reloads.
 */
function writeTraefikConfig() {
  const configDir = process.env.TRAEFIK_CONFIG_DIR;
  if (!configDir) return;

  const hostname = process.env.APP_HOSTNAME;
  if (!hostname) return;

  const configPath = path.join(configDir, 'port-forwards.json');

  const routers = {};
  const services = {};

  // Collect all forwards across all workspaces
  const allForwards = globalThis['__portForwards'];
  if (allForwards) {
    for (const [workspaceId, portMap] of allForwards) {
      for (const [port, data] of portMap) {
        const key = `workspace-${workspaceId}-${port}`;

        // Validate hostname pattern — only allow subdomains, never the bare hostname
        const subdomain = `${workspaceId}-${port}.${hostname}`;

        routers[key] = {
          rule: `Host(\`${subdomain}\`)`,
          entryPoints: ['websecure'],
          tls: {},
          service: key,
        };

        services[key] = {
          loadBalancer: {
            servers: [{ url: `http://${data.containerName}:${port}` }],
          },
        };
      }
    }
  }

  const config = { http: { routers, services } };

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('[port-scanner] Failed to write Traefik config:', err.message);
  }
}

/**
 * Remove all Traefik routes (writes empty config).
 */
function clearTraefikConfig() {
  writeTraefikConfig();
}

/**
 * Run one scan cycle for a workspace container.
 * @param {string} workspaceId
 * @param {string} containerName
 */
async function scan(workspaceId, containerName) {
  try {
    const { execInContainer } = await import('../tools/docker.js');
    const output = await execInContainer(containerName, 'ss -tlnp 2>/dev/null || true');
    const currentPorts = parseListeningPorts(output);
    const knownForwards = getForwards(workspaceId);

    let changed = false;

    // Detect new ports
    for (const port of currentPorts) {
      if (!knownForwards.has(port)) {
        addForward(workspaceId, port, {
          containerName,
          detectedAt: Date.now(),
        });
        console.log(`[port-scanner] Detected port ${port} on ${containerName}`);
        changed = true;
      }
    }

    // Detect removed ports
    for (const [port] of knownForwards) {
      if (!currentPorts.has(port)) {
        removeForward(workspaceId, port);
        console.log(`[port-scanner] Port ${port} closed on ${containerName}`);
        changed = true;
      }
    }

    if (changed) {
      writeTraefikConfig();
    }
  } catch (err) {
    console.error(`[port-scanner] Scan failed for ${containerName}:`, err.message);
  }
}

/**
 * Start scanning a workspace container for open ports.
 * Reference-counted — multiple WebSocket connections share one scanner.
 * @param {string} workspaceId
 * @param {string} containerName
 */
export function startScanning(workspaceId, containerName) {
  const existing = scanners.get(workspaceId);
  if (existing) {
    existing.refCount++;
    return;
  }

  // Run an initial scan immediately
  scan(workspaceId, containerName);

  const interval = setInterval(() => {
    scan(workspaceId, containerName);
  }, SCAN_INTERVAL_MS);

  scanners.set(workspaceId, { interval, containerName, refCount: 1 });
  console.log(`[port-scanner] Started scanning ${containerName} for workspace ${workspaceId}`);
}

/**
 * Stop scanning a workspace container.
 * Decrements reference count — only stops when all connections are closed.
 * @param {string} workspaceId
 * @param {boolean} [force=false] - Force stop regardless of ref count
 */
export { writeTraefikConfig };

export function stopScanning(workspaceId, force = false) {
  const scanner = scanners.get(workspaceId);
  if (!scanner) return;

  if (!force) {
    scanner.refCount--;
    if (scanner.refCount > 0) return;
  }

  clearInterval(scanner.interval);
  scanners.delete(workspaceId);

  // Clean up forwarded ports and Traefik config
  clearWorkspaceForwards(workspaceId);
  writeTraefikConfig();

  console.log(`[port-scanner] Stopped scanning workspace ${workspaceId}`);
}
