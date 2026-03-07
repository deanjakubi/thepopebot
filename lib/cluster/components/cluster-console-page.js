"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef, useCallback } from "react";
import { AppSidebar } from "../../chat/components/app-sidebar.js";
import { SidebarProvider, SidebarInset } from "../../chat/components/ui/sidebar.js";
import { ChatNavProvider } from "../../chat/components/chat-nav-context.js";
import { PencilIcon, ClusterIcon } from "../../chat/components/icons.js";
import { triggerWorkerManually, stopWorker, getCluster } from "../actions.js";
const MAX_LOG_ENTRIES = 500;
function autoColumns(count) {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}
function shortId(worker) {
  return worker.id.replace(/-/g, "").slice(0, 8);
}
function ClusterConsolePage({ session, clusterId }) {
  const [cluster, setCluster] = useState(null);
  const [workerStats, setWorkerStats] = useState({});
  const [colSetting, setColSetting] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("cluster-console-cols") || "auto";
    }
    return "auto";
  });
  const logBuffers = useRef(/* @__PURE__ */ new Map());
  const [logVersion, setLogVersion] = useState(0);
  const reconnectRef = useRef(null);
  const esRef = useRef(null);
  useEffect(() => {
    getCluster(clusterId).then(setCluster).catch(console.error);
  }, [clusterId]);
  useEffect(() => {
    let cancelled = false;
    let backoff = 1e3;
    function connect() {
      if (cancelled) return;
      const es = new EventSource(`/stream/cluster/${clusterId}/logs`);
      esRef.current = es;
      es.addEventListener("log", (e) => {
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
        } catch {
        }
      });
      es.addEventListener("status", (e) => {
        try {
          const data = JSON.parse(e.data);
          setWorkerStats(data.workers || {});
        } catch {
        }
      });
      es.addEventListener("ping", () => {
      });
      es.onopen = () => {
        backoff = 1e3;
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!cancelled) {
          reconnectRef.current = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 3e4);
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
  const handleColChange = (val) => {
    setColSetting(val);
    if (typeof window !== "undefined") {
      localStorage.setItem("cluster-console-cols", val);
    }
  };
  const workers = cluster?.workers || [];
  const runningCount = Object.values(workerStats).filter((s) => s.running).length;
  const cols = colSetting === "auto" ? autoColumns(workers.length) : parseInt(colSetting, 10);
  if (!cluster) {
    return /* @__PURE__ */ jsx(ChatNavProvider, { value: { activeChatId: null, navigateToChat: (id) => {
      window.location.href = id ? `/chat/${id}` : "/";
    } }, children: /* @__PURE__ */ jsxs(SidebarProvider, { children: [
      /* @__PURE__ */ jsx(AppSidebar, { user: session?.user }),
      /* @__PURE__ */ jsx(SidebarInset, { children: /* @__PURE__ */ jsx("div", { className: "flex h-svh items-center justify-center", children: /* @__PURE__ */ jsx("div", { className: "h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" }) }) })
    ] }) });
  }
  return /* @__PURE__ */ jsx(ChatNavProvider, { value: { activeChatId: null, navigateToChat: (id) => {
    window.location.href = id ? `/chat/${id}` : "/";
  } }, children: /* @__PURE__ */ jsxs(SidebarProvider, { children: [
    /* @__PURE__ */ jsx(AppSidebar, { user: session?.user }),
    /* @__PURE__ */ jsx(SidebarInset, { children: /* @__PURE__ */ jsxs("div", { className: "flex h-svh flex-col overflow-hidden", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3 px-4 py-3 border-b border-border shrink-0", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-sm text-muted-foreground", children: [
          /* @__PURE__ */ jsx("a", { href: "/clusters/list", className: "hover:text-foreground transition-colors", children: "Clusters" }),
          /* @__PURE__ */ jsx("span", { children: "/" }),
          /* @__PURE__ */ jsx("span", { className: "text-foreground font-medium", children: cluster.name || "Untitled" })
        ] }),
        /* @__PURE__ */ jsx(
          "a",
          {
            href: `/cluster/${clusterId}`,
            className: "p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
            title: "Edit cluster",
            children: /* @__PURE__ */ jsx(PencilIcon, { size: 14 })
          }
        ),
        /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400", children: [
          runningCount,
          "/",
          workers.length,
          " running"
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "ml-auto flex items-center gap-1.5", children: [
          /* @__PURE__ */ jsx("span", { className: "text-xs text-muted-foreground", children: "Columns:" }),
          ["auto", "1", "2", "3", "4"].map((val) => /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => handleColChange(val),
              className: `px-2 py-1 text-xs rounded-md transition-colors ${colSetting === val ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`,
              children: val === "auto" ? "Auto" : val
            },
            val
          ))
        ] })
      ] }),
      /* @__PURE__ */ jsx(
        "div",
        {
          className: "flex-1 overflow-auto p-4",
          style: { minHeight: 0 },
          children: workers.length === 0 ? /* @__PURE__ */ jsx("div", { className: "flex items-center justify-center h-full", children: /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
            /* @__PURE__ */ jsx(ClusterIcon, { size: 32 }),
            /* @__PURE__ */ jsx("p", { className: "text-sm text-muted-foreground mt-2", children: "No workers configured." }),
            /* @__PURE__ */ jsx("a", { href: `/cluster/${clusterId}`, className: "text-sm text-primary underline mt-1 block", children: "Add workers" })
          ] }) }) : /* @__PURE__ */ jsx(
            "div",
            {
              className: "grid gap-4 h-full",
              style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` },
              children: workers.map((worker) => /* @__PURE__ */ jsx(
                WorkerTile,
                {
                  worker,
                  stats: workerStats[worker.id],
                  logs: logBuffers.current.get(worker.id) || [],
                  logVersion,
                  roles: cluster.roles
                },
                worker.id
              ))
            }
          )
        }
      ),
      workers.length > 0 && /* @__PURE__ */ jsx(StatsPanel, { workers, stats: workerStats, roles: cluster.roles })
    ] }) })
  ] }) });
}
function WorkerTile({ worker, stats, logs, logVersion, roles }) {
  const [mode, setMode] = useState("code");
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [expandedTools, setExpandedTools] = useState(/* @__PURE__ */ new Set());
  const logEndRef = useRef(null);
  const isRunning = stats?.running === true;
  const wShortId = shortId(worker);
  const roleName = roles?.find((r) => r.id === worker.clusterRoleId)?.roleName;
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logVersion, mode]);
  const handleRun = async () => {
    setRunning(true);
    try {
      await triggerWorkerManually(worker.id);
    } catch {
    }
    setRunning(false);
  };
  const handleStop = async () => {
    setStopping(true);
    try {
      await stopWorker(worker.id);
    } catch {
    }
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
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col rounded-lg border border-border bg-card overflow-hidden min-h-0", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 px-3 py-2 border-b border-border shrink-0", children: [
      /* @__PURE__ */ jsx("span", { className: "px-1.5 py-0.5 rounded bg-muted text-xs font-mono font-medium", children: wShortId }),
      /* @__PURE__ */ jsx("span", { className: "text-sm font-medium truncate", children: worker.name || "Worker" }),
      roleName && /* @__PURE__ */ jsxs("span", { className: "text-xs text-muted-foreground truncate", children: [
        "(",
        roleName,
        ")"
      ] }),
      /* @__PURE__ */ jsx("span", { className: `ml-auto w-2 h-2 rounded-full shrink-0 ${isRunning ? "bg-green-500" : "bg-muted-foreground/30"}` })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          onClick: handleRun,
          disabled: running || isRunning,
          className: "rounded px-2 py-1 text-xs font-medium border border-input hover:bg-muted disabled:opacity-40",
          children: running ? "Starting..." : "Run"
        }
      ),
      isRunning && /* @__PURE__ */ jsx(
        "button",
        {
          onClick: handleStop,
          disabled: stopping,
          className: "rounded px-2 py-1 text-xs font-medium border border-input hover:bg-muted disabled:opacity-40",
          children: stopping ? "Stopping..." : "Stop"
        }
      ),
      /* @__PURE__ */ jsxs("div", { className: "ml-auto flex items-center rounded-md border border-input overflow-hidden", children: [
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => setMode("console"),
            className: `px-2 py-1 text-xs transition-colors ${mode === "console" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`,
            children: "Console"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => setMode("code"),
            className: `px-2 py-1 text-xs transition-colors ${mode === "code" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`,
            children: "Code"
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex-1 overflow-y-auto p-2 font-mono text-xs min-h-0 bg-background/50", children: [
      (() => {
        const filtered = mode === "console" ? logs.filter((e) => e.stream === "stderr") : logs.filter((e) => e.stream === "stdout");
        if (filtered.length === 0) {
          return /* @__PURE__ */ jsx("div", { className: "flex items-center justify-center h-full text-muted-foreground text-xs", children: isRunning ? "Waiting for output..." : "No active session" });
        }
        if (mode === "console") {
          return /* @__PURE__ */ jsx("div", { className: "space-y-0", children: filtered.map((entry, i) => /* @__PURE__ */ jsx("div", { className: "text-muted-foreground whitespace-pre-wrap break-all leading-relaxed", children: entry.raw }, i)) });
        }
        return /* @__PURE__ */ jsx(CodeLogView, { logs: filtered, expandedTools, toggleTool });
      })(),
      /* @__PURE__ */ jsx("div", { ref: logEndRef })
    ] })
  ] });
}
function CodeLogView({ logs, expandedTools, toggleTool }) {
  const toolResults = /* @__PURE__ */ new Map();
  for (const entry of logs) {
    if (!entry.parsed) continue;
    for (const ev of entry.parsed) {
      if (ev.type === "tool-result" && ev.toolCallId) {
        toolResults.set(ev.toolCallId, ev);
      }
    }
  }
  const elements = [];
  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i];
    if (!entry.parsed) continue;
    for (const ev of entry.parsed) {
      if (ev.type === "text" && ev.text) {
        elements.push(
          /* @__PURE__ */ jsx("div", { className: "text-foreground whitespace-pre-wrap mb-1 leading-relaxed", children: ev.text }, `${i}-text`)
        );
      } else if (ev.type === "tool-call") {
        const expanded = expandedTools.has(ev.toolCallId);
        const result = toolResults.get(ev.toolCallId);
        const keyArg = ev.args ? Object.values(ev.args)[0] : "";
        const keyArgStr = typeof keyArg === "string" ? keyArg : "";
        const shortArg = keyArgStr.length > 60 ? keyArgStr.slice(0, 57) + "..." : keyArgStr;
        elements.push(
          /* @__PURE__ */ jsxs("div", { className: "my-1", children: [
            /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: () => toggleTool(ev.toolCallId),
                className: "flex items-center gap-1.5 w-full text-left px-2 py-1 rounded bg-muted/60 hover:bg-muted transition-colors",
                children: [
                  /* @__PURE__ */ jsx("span", { className: "text-muted-foreground text-xs", children: expanded ? "\u25BC" : "\u25B6" }),
                  /* @__PURE__ */ jsx("span", { className: "font-medium text-xs text-primary", children: ev.toolName }),
                  shortArg && /* @__PURE__ */ jsxs("span", { className: "text-muted-foreground text-xs truncate", children: [
                    "(",
                    shortArg,
                    ")"
                  ] })
                ]
              }
            ),
            expanded && /* @__PURE__ */ jsxs("div", { className: "ml-4 mt-1 space-y-1", children: [
              /* @__PURE__ */ jsx("pre", { className: "text-xs text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 rounded p-1.5 max-h-48 overflow-y-auto", children: JSON.stringify(ev.args, null, 2) }),
              result && /* @__PURE__ */ jsxs("div", { className: "text-xs text-muted-foreground", children: [
                /* @__PURE__ */ jsx("span", { className: "font-medium", children: "Result:" }),
                /* @__PURE__ */ jsx("pre", { className: "whitespace-pre-wrap break-all bg-muted/30 rounded p-1.5 mt-0.5 max-h-48 overflow-y-auto", children: typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2) })
              ] })
            ] })
          ] }, `${i}-tool-${ev.toolCallId}`)
        );
      }
    }
  }
  return /* @__PURE__ */ jsx("div", { children: elements });
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
  return /* @__PURE__ */ jsx("div", { className: "shrink-0 border-t border-border bg-muted font-mono text-xs overflow-x-auto", children: /* @__PURE__ */ jsxs("table", { className: "w-full", children: [
    /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { className: "border-b border-border text-muted-foreground", children: [
      /* @__PURE__ */ jsx("th", { className: "text-left px-3 py-1.5 font-medium", children: "WORKER" }),
      /* @__PURE__ */ jsx("th", { className: "text-right px-3 py-1.5 font-medium w-20", children: "CPU %" }),
      /* @__PURE__ */ jsx("th", { className: "text-right px-3 py-1.5 font-medium w-32", children: "MEM" }),
      /* @__PURE__ */ jsx("th", { className: "text-right px-3 py-1.5 font-medium w-32", children: "NET I/O" }),
      /* @__PURE__ */ jsx("th", { className: "text-right px-3 py-1.5 font-medium w-20", children: "STATUS" })
    ] }) }),
    /* @__PURE__ */ jsxs("tbody", { children: [
      workers.map((w) => {
        const s = stats[w.id];
        const isRunning = s?.running;
        const roleName = roles?.find((r) => r.id === w.clusterRoleId)?.roleName;
        return /* @__PURE__ */ jsxs("tr", { className: "border-b border-border last:border-0", children: [
          /* @__PURE__ */ jsxs("td", { className: "px-3 py-1", children: [
            /* @__PURE__ */ jsx("span", { className: "text-muted-foreground", children: shortId(w) }),
            " ",
            /* @__PURE__ */ jsx("span", { className: "text-foreground", children: w.name || "Worker" }),
            roleName && /* @__PURE__ */ jsxs("span", { className: "text-muted-foreground/60 ml-1", children: [
              "(",
              roleName,
              ")"
            ] })
          ] }),
          /* @__PURE__ */ jsx("td", { className: "text-right px-3 py-1", children: isRunning ? `${(s.cpu || 0).toFixed(1)}%` : "\u2014" }),
          /* @__PURE__ */ jsx("td", { className: "text-right px-3 py-1", children: isRunning ? `${formatBytes(s.memUsage || 0)} / ${formatBytes(s.memLimit || 0)}` : "\u2014" }),
          /* @__PURE__ */ jsx("td", { className: "text-right px-3 py-1", children: isRunning ? `${formatBytes(s.netRx || 0)} / ${formatBytes(s.netTx || 0)}` : "\u2014" }),
          /* @__PURE__ */ jsx("td", { className: "text-right px-3 py-1", children: isRunning ? /* @__PURE__ */ jsx("span", { className: "text-green-600 dark:text-green-400", children: "RUN" }) : /* @__PURE__ */ jsx("span", { className: "text-muted-foreground/60", children: "STOP" }) })
        ] }, w.id);
      }),
      /* @__PURE__ */ jsxs("tr", { className: "border-t border-border text-muted-foreground font-medium", children: [
        /* @__PURE__ */ jsxs("td", { className: "px-3 py-1.5", children: [
          "TOTAL (",
          totalRunning,
          "/",
          workers.length,
          ")"
        ] }),
        /* @__PURE__ */ jsxs("td", { className: "text-right px-3 py-1.5", children: [
          totalCpu.toFixed(1),
          "%"
        ] }),
        /* @__PURE__ */ jsx("td", { className: "text-right px-3 py-1.5", children: formatBytes(totalMem) }),
        /* @__PURE__ */ jsx("td", { className: "text-right px-3 py-1.5" }),
        /* @__PURE__ */ jsx("td", { className: "text-right px-3 py-1.5" })
      ] })
    ] })
  ] }) });
}
export {
  ClusterConsolePage
};
