'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppSidebar } from '../../chat/components/app-sidebar.js';
import { SidebarProvider, SidebarInset } from '../../chat/components/ui/sidebar.js';
import { ChatNavProvider } from '../../chat/components/chat-nav-context.js';
import { PencilIcon, ClusterIcon } from '../../chat/components/icons.js';
import { triggerWorkerManually, stopWorker, getCluster } from '../actions.js';

const MAX_LOG_ENTRIES = 500;

function autoColumns(count) {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

function shortId(worker) {
  return worker.id.replace(/-/g, '').slice(0, 8);
}

export function ClusterConsolePage({ session, clusterId }) {
  const [cluster, setCluster] = useState(null);
  const [workerStats, setWorkerStats] = useState({});
  const [colSetting, setColSetting] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cluster-console-cols') || 'auto';
    }
    return 'auto';
  });
  const logBuffers = useRef(new Map());
  const [logVersion, setLogVersion] = useState(0);
  const reconnectRef = useRef(null);
  const esRef = useRef(null);

  // Load cluster data
  useEffect(() => {
    getCluster(clusterId).then(setCluster).catch(console.error);
  }, [clusterId]);

  // SSE connection
  useEffect(() => {
    let cancelled = false;
    let backoff = 1000;

    function connect() {
      if (cancelled) return;
      const es = new EventSource(`/stream/cluster/${clusterId}/logs`);
      esRef.current = es;

      es.addEventListener('log', (e) => {
        try {
          const data = JSON.parse(e.data);
          const { workerId, stream, raw, parsed } = data;
          if (!logBuffers.current.has(workerId)) {
            logBuffers.current.set(workerId, []);
          }
          const buf = logBuffers.current.get(workerId);
          buf.push({ stream, raw, parsed });
          if (buf.length > MAX_LOG_ENTRIES) {
            buf.splice(0, buf.length - MAX_LOG_ENTRIES);
          }
          setLogVersion((v) => v + 1);
        } catch {}
      });

      es.addEventListener('status', (e) => {
        try {
          const data = JSON.parse(e.data);
          setWorkerStats(data.workers || {});
        } catch {}
      });

      es.addEventListener('ping', () => {});

      es.onopen = () => { backoff = 1000; };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!cancelled) {
          reconnectRef.current = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 30000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (esRef.current) esRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [clusterId]);

  // Persist column setting
  const handleColChange = (val) => {
    setColSetting(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('cluster-console-cols', val);
    }
  };

  const workers = cluster?.workers || [];
  const runningCount = Object.values(workerStats).filter((s) => s.running).length;
  const cols = colSetting === 'auto' ? autoColumns(workers.length) : parseInt(colSetting, 10);

  if (!cluster) {
    return (
      <ChatNavProvider value={{ activeChatId: null, navigateToChat: (id) => { window.location.href = id ? `/chat/${id}` : '/'; } }}>
        <SidebarProvider>
          <AppSidebar user={session?.user} />
          <SidebarInset>
            <div className="flex h-svh items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </ChatNavProvider>
    );
  }

  return (
    <ChatNavProvider value={{ activeChatId: null, navigateToChat: (id) => { window.location.href = id ? `/chat/${id}` : '/'; } }}>
      <SidebarProvider>
        <AppSidebar user={session?.user} />
        <SidebarInset>
          <div className="flex h-svh flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <a href="/clusters/list" className="hover:text-foreground transition-colors">Clusters</a>
                <span>/</span>
                <span className="text-foreground font-medium">{cluster.name || 'Untitled'}</span>
              </div>
              <a
                href={`/cluster/${clusterId}`}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Edit cluster"
              >
                <PencilIcon size={14} />
              </a>
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400">
                {runningCount}/{workers.length} running
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Columns:</span>
                {['auto', '1', '2', '3', '4'].map((val) => (
                  <button
                    key={val}
                    onClick={() => handleColChange(val)}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      colSetting === val
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    {val === 'auto' ? 'Auto' : val}
                  </button>
                ))}
              </div>
            </div>

            {/* Worker grid */}
            <div
              className="flex-1 overflow-auto p-4"
              style={{ minHeight: 0 }}
            >
              {workers.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <ClusterIcon size={32} />
                    <p className="text-sm text-muted-foreground mt-2">No workers configured.</p>
                    <a href={`/cluster/${clusterId}`} className="text-sm text-primary underline mt-1 block">
                      Add workers
                    </a>
                  </div>
                </div>
              ) : (
                <div
                  className="grid gap-4 h-full"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {workers.map((worker) => (
                    <WorkerTile
                      key={worker.id}
                      worker={worker}
                      stats={workerStats[worker.id]}
                      logs={logBuffers.current.get(worker.id) || []}
                      logVersion={logVersion}
                      roles={cluster.roles}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Bottom stats panel */}
            {workers.length > 0 && (
              <StatsPanel workers={workers} stats={workerStats} roles={cluster.roles} />
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ChatNavProvider>
  );
}

function WorkerTile({ worker, stats, logs, logVersion, roles }) {
  const [mode, setMode] = useState('code'); // 'console' | 'code'
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [expandedTools, setExpandedTools] = useState(new Set());
  const logEndRef = useRef(null);
  const isRunning = stats?.running === true;
  const wShortId = shortId(worker);
  const roleName = roles?.find((r) => r.id === worker.clusterRoleId)?.roleName;

  // Auto-scroll
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logVersion, mode]);

  const handleRun = async () => {
    setRunning(true);
    try { await triggerWorkerManually(worker.id); } catch {}
    setRunning(false);
  };

  const handleStop = async () => {
    setStopping(true);
    try { await stopWorker(worker.id); } catch {}
    setStopping(false);
  };

  const toggleTool = (id) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card overflow-hidden min-h-0">
      {/* Tile header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono font-medium">{wShortId}</span>
        <span className="text-sm font-medium truncate">{worker.name || 'Worker'}</span>
        {roleName && <span className="text-xs text-muted-foreground truncate">({roleName})</span>}
        <span className={`ml-auto w-2 h-2 rounded-full shrink-0 ${isRunning ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <button
          onClick={handleRun}
          disabled={running || isRunning}
          className="rounded px-2 py-1 text-xs font-medium border border-input hover:bg-muted disabled:opacity-40"
        >
          {running ? 'Starting...' : 'Run'}
        </button>
        {isRunning && (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="rounded px-2 py-1 text-xs font-medium border border-input hover:bg-muted disabled:opacity-40"
          >
            {stopping ? 'Stopping...' : 'Stop'}
          </button>
        )}
        <div className="ml-auto flex items-center rounded-md border border-input overflow-hidden">
          <button
            onClick={() => setMode('console')}
            className={`px-2 py-1 text-xs transition-colors ${mode === 'console' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Console
          </button>
          <button
            onClick={() => setMode('code')}
            className={`px-2 py-1 text-xs transition-colors ${mode === 'code' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Code
          </button>
        </div>
      </div>

      {/* Log area */}
      <div className="flex-1 overflow-y-auto p-2 font-mono text-xs min-h-0 bg-background/50">
        {(() => {
          const filtered = mode === 'console'
            ? logs.filter((e) => e.stream === 'stderr')
            : logs.filter((e) => e.stream === 'stdout');
          if (filtered.length === 0) {
            return (
              <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                {isRunning ? 'Waiting for output...' : 'No active session'}
              </div>
            );
          }
          if (mode === 'console') {
            return (
              <div className="space-y-0">
                {filtered.map((entry, i) => (
                  <div key={i} className="text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                    {entry.raw}
                  </div>
                ))}
              </div>
            );
          }
          return <CodeLogView logs={filtered} expandedTools={expandedTools} toggleTool={toggleTool} />;
        })()}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

function CodeLogView({ logs, expandedTools, toggleTool }) {
  // Build a map of tool results by toolCallId for nesting
  const toolResults = new Map();
  for (const entry of logs) {
    if (!entry.parsed) continue;
    for (const ev of entry.parsed) {
      if (ev.type === 'tool-result' && ev.toolCallId) {
        toolResults.set(ev.toolCallId, ev);
      }
    }
  }

  const elements = [];
  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i];
    if (!entry.parsed) continue;
    for (const ev of entry.parsed) {
      if (ev.type === 'text' && ev.text) {
        elements.push(
          <div key={`${i}-text`} className="text-foreground whitespace-pre-wrap mb-1 leading-relaxed">
            {ev.text}
          </div>
        );
      } else if (ev.type === 'tool-call') {
        const expanded = expandedTools.has(ev.toolCallId);
        const result = toolResults.get(ev.toolCallId);
        const keyArg = ev.args ? Object.values(ev.args)[0] : '';
        const keyArgStr = typeof keyArg === 'string' ? keyArg : '';
        const shortArg = keyArgStr.length > 60 ? keyArgStr.slice(0, 57) + '...' : keyArgStr;

        elements.push(
          <div key={`${i}-tool-${ev.toolCallId}`} className="my-1">
            <button
              onClick={() => toggleTool(ev.toolCallId)}
              className="flex items-center gap-1.5 w-full text-left px-2 py-1 rounded bg-muted/60 hover:bg-muted transition-colors"
            >
              <span className="text-muted-foreground text-xs">{expanded ? '▼' : '▶'}</span>
              <span className="font-medium text-xs text-primary">{ev.toolName}</span>
              {shortArg && <span className="text-muted-foreground text-xs truncate">({shortArg})</span>}
            </button>
            {expanded && (
              <div className="ml-4 mt-1 space-y-1">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 rounded p-1.5 max-h-48 overflow-y-auto">
                  {JSON.stringify(ev.args, null, 2)}
                </pre>
                {result && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Result:</span>
                    <pre className="whitespace-pre-wrap break-all bg-muted/30 rounded p-1.5 mt-0.5 max-h-48 overflow-y-auto">
                      {typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }
      // tool-result events are nested under their tool-call, skip standalone rendering
    }
  }

  return <div>{elements}</div>;
}

function StatsPanel({ workers, stats, roles }) {
  let totalCpu = 0;
  let totalMem = 0;
  let totalRunning = 0;

  for (const w of workers) {
    const s = stats[w.id];
    if (s?.running) {
      totalRunning++;
      totalCpu += s.cpu || 0;
      totalMem += s.memUsage || 0;
    }
  }

  return (
    <div className="shrink-0 border-t border-border bg-muted font-mono text-xs overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left px-3 py-1.5 font-medium">WORKER</th>
            <th className="text-right px-3 py-1.5 font-medium w-20">CPU %</th>
            <th className="text-right px-3 py-1.5 font-medium w-32">MEM</th>
            <th className="text-right px-3 py-1.5 font-medium w-32">NET I/O</th>
            <th className="text-right px-3 py-1.5 font-medium w-20">STATUS</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((w) => {
            const s = stats[w.id];
            const isRunning = s?.running;
            const roleName = roles?.find((r) => r.id === w.clusterRoleId)?.roleName;
            return (
              <tr key={w.id} className="border-b border-border last:border-0">
                <td className="px-3 py-1">
                  <span className="text-muted-foreground">{shortId(w)}</span>{' '}
                  <span className="text-foreground">{w.name || 'Worker'}</span>
                  {roleName && <span className="text-muted-foreground/60 ml-1">({roleName})</span>}
                </td>
                <td className="text-right px-3 py-1">{isRunning ? `${(s.cpu || 0).toFixed(1)}%` : '—'}</td>
                <td className="text-right px-3 py-1">
                  {isRunning ? `${formatBytes(s.memUsage || 0)} / ${formatBytes(s.memLimit || 0)}` : '—'}
                </td>
                <td className="text-right px-3 py-1">
                  {isRunning ? `${formatBytes(s.netRx || 0)} / ${formatBytes(s.netTx || 0)}` : '—'}
                </td>
                <td className="text-right px-3 py-1">
                  {isRunning
                    ? <span className="text-green-600 dark:text-green-400">RUN</span>
                    : <span className="text-muted-foreground/60">STOP</span>}
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-border text-muted-foreground font-medium">
            <td className="px-3 py-1.5">TOTAL ({totalRunning}/{workers.length})</td>
            <td className="text-right px-3 py-1.5">{totalCpu.toFixed(1)}%</td>
            <td className="text-right px-3 py-1.5">{formatBytes(totalMem)}</td>
            <td className="text-right px-3 py-1.5"></td>
            <td className="text-right px-3 py-1.5"></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
