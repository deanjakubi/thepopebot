'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppSidebar } from '../chat/components/app-sidebar.js';
import { SidebarProvider, SidebarInset } from '../chat/components/ui/sidebar.js';
import { ChatNavProvider } from '../chat/components/chat-nav-context.js';
import { ChatHeader } from '../chat/components/chat-header.js';
import { ConfirmDialog } from '../chat/components/ui/confirm-dialog.js';
import { CodeIcon, TerminalIcon, EditorIcon, SpinnerIcon } from '../chat/components/icons.js';
import { cn } from '../chat/utils.js';
import {
  ensureCodeWorkspaceContainer,
  closeInteractiveMode,
  createTerminalSession,
  closeTerminalSession,
  listTerminalSessions,
  forwardPort,
  listPortForwards,
  stopPortForward,
} from './actions.js';

const TerminalView = dynamic(() => import('./terminal-view.js'), { ssr: false });
const EditorView = dynamic(() => import('./editor-view.js'), { ssr: false });
const DiffViewer = dynamic(() => import('../chat/components/diff-viewer.js').then(m => ({ default: m.DiffViewer })), { ssr: false });

function getStorageKey(id) {
  return `code-tab-order-${id}`;
}

function saveTabOrder(id, tabs) {
  try {
    const ids = tabs.filter((t) => t.id !== PRIMARY_TAB_ID).map((t) => t.id);
    if (ids.length > 0) {
      localStorage.setItem(getStorageKey(id), JSON.stringify(ids));
    } else {
      localStorage.removeItem(getStorageKey(id));
    }
    // Persist editor tabs separately (they have no container process to scan)
    const editorTabs = tabs.filter((t) => t.type === 'editor').map((t) => ({ id: t.id, label: t.label }));
    if (editorTabs.length > 0) {
      localStorage.setItem(`code-editor-tabs-${id}`, JSON.stringify(editorTabs));
    } else {
      localStorage.removeItem(`code-editor-tabs-${id}`);
    }
  } catch {}
}

function loadEditorTabs(id) {
  try {
    const raw = localStorage.getItem(`code-editor-tabs-${id}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadTabOrder(id) {
  try {
    const raw = localStorage.getItem(getStorageKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function reorderByStored(tabs, storedOrder) {
  if (!storedOrder || storedOrder.length === 0) return tabs;
  const primary = tabs[0]; // claude-code always first
  const dynamic = tabs.slice(1);
  const orderMap = new Map(storedOrder.map((id, i) => [id, i]));
  dynamic.sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
    const bi = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
    return ai - bi;
  });
  return [primary, ...dynamic];
}

const PRIMARY_TAB_ID = 'code-primary';

export default function CodePage({ session, codeWorkspaceId }) {
  const [dialogState, setDialogState] = useState('closed'); // 'closed' | 'confirm' | 'error'
  const [closing, setClosing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [tabs, setTabs] = useState([
    { id: PRIMARY_TAB_ID, label: 'Code', type: 'code', primary: true },
  ]);
  const [activeTabId, setActiveTabId] = useState(PRIMARY_TAB_ID);
  const [creatingShell, setCreatingShell] = useState(false);
  const [creatingCode, setCreatingCode] = useState(false);
  const [creatingEditor, setCreatingEditor] = useState(false);
  const [closingTabId, setClosingTabId] = useState(null);
  const [diffStats, setDiffStats] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [portForwards, setPortForwards] = useState([]);
  const [portInput, setPortInput] = useState('');
  const [showPortInput, setShowPortInput] = useState(false);
  const portInputRef = useRef(null);

  const fetchDiffStats = useCallback(async () => {
    try {
      const r = await fetch(`/code/workspace-diff/${codeWorkspaceId}`);
      const data = await r.json();
      if (data.success) { setDiffStats(data); return data; }
    } catch {}
    return null;
  }, [codeWorkspaceId]);

  // Polling: fetch on mount + every 30s
  useEffect(() => {
    fetchDiffStats();
    const interval = setInterval(fetchDiffStats, 30000);
    return () => clearInterval(interval);
  }, [fetchDiffStats]);

  // Debounce on terminal output: ANY tab's output resets the same timer
  const debounceRef = useRef(null);
  const handleTerminalOutput = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchDiffStats, 4000);
  }, [fetchDiffStats]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Restore existing sessions on mount
  useEffect(() => {
    listTerminalSessions(codeWorkspaceId).then((result) => {
      const terminalTabs = result?.success && result.sessions?.length > 0
        ? result.sessions.map((s) => ({ id: s.id, label: s.label, type: s.type || 'shell' }))
        : [];
      const editorTabs = loadEditorTabs(codeWorkspaceId).map((t) => ({ id: t.id, label: t.label, type: 'editor' }));
      if (terminalTabs.length > 0 || editorTabs.length > 0) {
        const restored = [
          { id: PRIMARY_TAB_ID, label: 'Code', type: 'code', primary: true },
          ...terminalTabs,
          ...editorTabs,
        ];
        const storedOrder = loadTabOrder(codeWorkspaceId);
        setTabs(reorderByStored(restored, storedOrder));
      }
    });
  }, [codeWorkspaceId]);

  // Persist tab order when tabs change
  useEffect(() => {
    if (tabs.length > 1) {
      saveTabOrder(codeWorkspaceId, tabs);
    }
  }, [tabs, codeWorkspaceId]);

  // Load port forwards on mount
  useEffect(() => {
    listPortForwards(codeWorkspaceId).then((r) => {
      if (r?.success) setPortForwards(r.ports || []);
    });
  }, [codeWorkspaceId]);

  const handleForwardPort = useCallback(async () => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1 || port > 65535) return;
    setShowPortInput(false);
    setPortInput('');
    // Skip if already forwarded
    if (portForwards.some((p) => p.port === port)) {
      const existing = portForwards.find((p) => p.port === port);
      if (existing?.url) window.open(existing.url, '_blank');
      return;
    }
    const result = await forwardPort(codeWorkspaceId, port);
    if (result?.success) {
      setPortForwards((prev) => [...prev, { port, url: result.url, createdAt: Date.now() }]);
      window.open(result.url, '_blank');
    }
  }, [codeWorkspaceId, portInput]);

  const handleStopPort = useCallback(async (port) => {
    await stopPortForward(codeWorkspaceId, port);
    setPortForwards((prev) => prev.filter((p) => p.port !== port));
  }, [codeWorkspaceId]);

  const handleNewCode = useCallback(async () => {
    setCreatingCode(true);
    try {
      const result = await createTerminalSession(codeWorkspaceId, 'code');
      if (result?.success) {
        const newTab = { id: result.sessionId, label: result.label, type: 'code' };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(result.sessionId);
      }
    } catch (err) {
      console.error('[CodePage] Failed to create code tab:', err);
    } finally {
      setCreatingCode(false);
    }
  }, [codeWorkspaceId]);

  const handleNewShell = useCallback(async () => {
    setCreatingShell(true);
    try {
      const result = await createTerminalSession(codeWorkspaceId, 'shell');
      if (result?.success) {
        const newTab = { id: result.sessionId, label: result.label, type: 'shell' };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(result.sessionId);
      }
    } catch (err) {
      console.error('[CodePage] Failed to create shell:', err);
    } finally {
      setCreatingShell(false);
    }
  }, [codeWorkspaceId]);

  const handleNewEditor = useCallback(() => {
    setCreatingEditor(true);
    // Editor tabs are purely client-side — no container process needed
    const sessionId = `editor-${Date.now().toString(36)}`;
    // Count existing editor tabs for labeling
    const editorCount = tabs.filter((t) => t.type === 'editor').length;
    const label = `Editor ${editorCount + 1}`;
    const newTab = { id: sessionId, label, type: 'editor' };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(sessionId);
    setCreatingEditor(false);
  }, [tabs]);

  const handleCloseTab = useCallback(async (tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.type !== 'editor') {
      try {
        await closeTerminalSession(codeWorkspaceId, tabId);
      } catch {
        // Best effort
      }
    }
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveTabId((prev) => (prev === tabId ? PRIMARY_TAB_ID : prev));
  }, [codeWorkspaceId, tabs]);

  const handleOpenCloseDialog = useCallback(() => {
    setDialogState('confirm');
    setErrorMessage('');
  }, []);

  const handleConfirmClose = useCallback(async () => {
    setClosing(true);
    setErrorMessage('');
    try {
      const result = await closeInteractiveMode(codeWorkspaceId);
      if (result?.success) {
        window.location.href = result.chatId ? `/chat/${result.chatId}` : '/';
      } else {
        const msg = result?.message || 'Failed to close session';
        console.error('[CodePage] closeInteractiveMode failed:', msg);
        setErrorMessage(msg);
        setDialogState('error');
        setClosing(false);
      }
    } catch (err) {
      console.error('[CodePage] closeInteractiveMode error:', err);
      setErrorMessage(err.message || 'An unexpected error occurred');
      setDialogState('error');
      setClosing(false);
    }
  }, [codeWorkspaceId]);

  const handleCancel = useCallback(() => {
    setDialogState('closed');
  }, []);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTabs((prev) => {
      const dynamicTabs = prev.slice(1);
      const oldIndex = dynamicTabs.findIndex((t) => t.id === active.id);
      const newIndex = dynamicTabs.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const reordered = arrayMove(dynamicTabs, oldIndex, newIndex);
      return [prev[0], ...reordered];
    });
  }, []);

  const isOpen = dialogState !== 'closed';

  // Look up closing tab type for the confirm dialog description
  const closingTab = closingTabId ? tabs.find((t) => t.id === closingTabId) : null;
  const closingTabDescription = closingTab?.type === 'editor'
    ? 'This will close the editor tab. Unsaved changes will be lost.'
    : closingTab?.type === 'code'
    ? 'This will end the code session.'
    : 'This will end the shell session.';

  const dynamicTabIds = tabs.slice(1).map((t) => t.id);

  return (
    <ChatNavProvider value={{ activeChatId: null, navigateToChat: (id) => { window.location.href = id ? `/chat/${id}` : '/'; } }}>
      <SidebarProvider>
        <AppSidebar user={session.user} />
        <SidebarInset>
          <div className="flex h-svh flex-col overflow-hidden">
            <ChatHeader workspaceId={codeWorkspaceId} />

            {/* Tab bar */}
            <div className="flex items-end gap-0 px-4 bg-muted/30 border-b border-border shrink-0 overflow-hidden">
              {/* Primary Code tab — pinned, not draggable */}
              <PinnedTab
                tab={tabs[0]}
                isActive={activeTabId === PRIMARY_TAB_ID}
                onClick={() => setActiveTabId(PRIMARY_TAB_ID)}
                onClose={() => handleOpenCloseDialog()}
                closeTitle="Close session"
              />

              {/* Dynamic tabs — draggable */}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={dynamicTabIds} strategy={horizontalListSortingStrategy}>
                  {tabs.slice(1).map((tab) => (
                    <SortableTab
                      key={tab.id}
                      tab={tab}
                      isActive={activeTabId === tab.id}
                      onClick={() => setActiveTabId(tab.id)}
                      onClose={() => setClosingTabId(tab.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              {/* Loading placeholder tabs */}
              {creatingCode && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-mono text-muted-foreground">
                  <SpinnerIcon size={12} />
                  <span>Code...</span>
                </div>
              )}
              {creatingShell && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-mono text-muted-foreground">
                  <SpinnerIcon size={12} />
                  <span>Shell...</span>
                </div>
              )}
              {creatingEditor && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-mono text-muted-foreground">
                  <SpinnerIcon size={12} />
                  <span>Editor...</span>
                </div>
              )}

              {/* Divider between real tabs and + buttons */}
              <div className="self-stretch my-1.5 mx-4 w-px bg-border" />

              {/* + buttons */}
              <button
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium font-mono text-muted-foreground hover:text-foreground rounded-t-md border-t border-x border-dashed border-t-muted-foreground/30 border-x-muted-foreground/20 hover:border-t-muted-foreground/50 hover:border-x-muted-foreground/40 transition-all disabled:opacity-50 disabled:cursor-default"
                onClick={handleNewCode}
                disabled={creatingCode}
                title="New code tab"
              >
                + Code
              </button>
              <button
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium font-mono text-muted-foreground hover:text-foreground rounded-t-md border-t border-x border-dashed border-t-muted-foreground/30 border-x-muted-foreground/20 hover:border-t-muted-foreground/50 hover:border-x-muted-foreground/40 transition-all disabled:opacity-50 disabled:cursor-default"
                onClick={handleNewShell}
                disabled={creatingShell}
                title="New shell terminal"
              >
                + Shell
              </button>
              <button
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium font-mono text-muted-foreground hover:text-foreground rounded-t-md border-t border-x border-dashed border-t-muted-foreground/30 border-x-muted-foreground/20 hover:border-t-muted-foreground/50 hover:border-x-muted-foreground/40 transition-all disabled:opacity-50 disabled:cursor-default"
                onClick={handleNewEditor}
                disabled={creatingEditor}
                title="New file editor"
              >
                + Editor
              </button>

              <button
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium font-mono text-muted-foreground hover:text-foreground rounded-t-md border-t border-x border-dashed border-t-muted-foreground/30 border-x-muted-foreground/20 hover:border-t-muted-foreground/50 hover:border-x-muted-foreground/40 transition-all"
                onClick={() => { setShowPortInput(true); setPortInput(''); }}
                title="Forward a port"
              >
                + Port
              </button>

              {/* Active port forwards */}
              {portForwards.length > 0 && (
                <div className="flex items-center gap-1 ml-auto">
                  {portForwards.map((pf) => (
                    <div
                      key={pf.port}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-mono text-muted-foreground rounded-t-md border border-b-0 border-emerald-500/30 bg-emerald-500/5"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>:{pf.port}</span>
                      <button
                        className="hover:text-emerald-400 transition-colors"
                        onClick={() => window.open(pf.url, '_blank')}
                        title={`Open ${pf.url}`}
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M7 3H3v10h10V9" />
                          <path d="M10 2h4v4" />
                          <path d="M14 2L7 9" />
                        </svg>
                      </button>
                      <button
                        className="hover:text-destructive transition-colors"
                        onClick={() => handleStopPort(pf.port)}
                        title="Stop forwarding"
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="4" y1="4" x2="12" y2="12" />
                          <line x1="12" y1="4" x2="4" y2="12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tab content panels — all mounted, hidden via display */}
            <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {showDiff && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column' }}>
                  <DiffViewer workspaceId={codeWorkspaceId} diffStats={diffStats} onClose={() => setShowDiff(false)} />
                </div>
              )}
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  style={{
                    display: activeTabId === tab.id ? 'flex' : 'none',
                    flex: 1,
                    flexDirection: 'column',
                    minHeight: 0,
                  }}
                >
                  {tab.type === 'editor' ? (
                    <EditorView codeWorkspaceId={codeWorkspaceId} tabId={tab.id} isActive={activeTabId === tab.id} />
                  ) : (
                    <TerminalView
                      codeWorkspaceId={codeWorkspaceId}
                      wsPath={tab.primary
                        ? `/code/${codeWorkspaceId}/ws`
                        : `/code/${codeWorkspaceId}/term/${tab.id}/ws`}
                      isActive={activeTabId === tab.id}
                      showToolbar={true}
                      ensureContainer={tab.primary ? ensureCodeWorkspaceContainer : undefined}
                      onCloseSession={tab.primary ? handleOpenCloseDialog : () => setClosingTabId(tab.id)}
                      closeLabel={tab.primary ? 'Close Session' : 'Close Tab'}
                      diffStats={diffStats}
                      onDiffStatsRefresh={fetchDiffStats}
                      onShowDiff={() => setShowDiff(true)}
                      onTerminalOutput={handleTerminalOutput}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          {dialogState === 'confirm' && (
            <ConfirmDialog
              open
              title="Close this session?"
              description="The container will be removed. Your workspace volume is preserved."
              confirmLabel={closing ? 'Closing...' : 'Close Session'}
              variant="default"
              onConfirm={handleConfirmClose}
              onCancel={handleCancel}
            />
          )}
          {dialogState === 'error' && (
            <ConfirmDialog
              open
              title="Failed to close session"
              description={errorMessage}
              confirmLabel="Retry"
              variant="destructive"
              onConfirm={handleConfirmClose}
              onCancel={handleCancel}
            />
          )}
          {closingTabId && (
            <ConfirmDialog
              open
              title="Close terminal?"
              description={closingTabDescription}
              confirmLabel="Close"
              variant="default"
              onConfirm={() => {
                handleCloseTab(closingTabId);
                setClosingTabId(null);
              }}
              onCancel={() => setClosingTabId(null)}
            />
          )}
          {showPortInput && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="fixed inset-0 bg-black/50" onClick={() => setShowPortInput(false)} />
              <div className="relative z-50 w-full max-w-xs rounded-lg border border-border bg-background p-6 shadow-lg">
                <h3 className="text-sm font-medium mb-1">Forward Port</h3>
                <p className="text-xs text-muted-foreground mb-4">Enter the port number your dev server is running on.</p>
                <input
                  ref={portInputRef}
                  type="number"
                  min="1"
                  max="65535"
                  placeholder="3000"
                  value={portInput}
                  onChange={(e) => setPortInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleForwardPort();
                    if (e.key === 'Escape') setShowPortInput(false);
                  }}
                  className="w-full px-3 py-2 text-sm font-mono bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-foreground mb-4"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
                    onClick={() => setShowPortInput(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
                    onClick={handleForwardPort}
                  >
                    Forward
                  </button>
                </div>
              </div>
            </div>
          )}
        </SidebarInset>
      </SidebarProvider>
    </ChatNavProvider>
  );
}

function PinnedTab({ tab, isActive, onClick, onClose, closeTitle }) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-mono rounded-t-md border border-b-0 transition-colors cursor-pointer',
        isActive
          ? 'bg-background text-foreground border-border -mb-px'
          : 'bg-muted/40 text-muted-foreground border-border/50 hover:text-foreground hover:bg-muted/70'
      )}
      onClick={onClick}
    >
      {tab.type === 'editor' ? <EditorIcon size={12} /> : tab.type === 'code' ? <CodeIcon size={12} /> : <TerminalIcon size={12} />}
      <span>{tab.label}</span>
      <button
        className="ml-1 rounded-sm p-0.5 hover:bg-destructive/20 hover:text-destructive transition-all"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title={closeTitle || 'Close'}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
    </div>
  );
}

function SortableTab({ tab, isActive, onClick, onClose }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-mono rounded-t-md border border-b-0 transition-colors cursor-grab active:cursor-grabbing',
        isActive
          ? 'bg-background text-foreground border-border -mb-px'
          : 'bg-muted/40 text-muted-foreground border-border/50 hover:text-foreground hover:bg-muted/70'
      )}
      onClick={onClick}
    >
      {tab.type === 'editor' ? <EditorIcon size={12} /> : tab.type === 'code' ? <CodeIcon size={12} /> : <TerminalIcon size={12} />}
      <span>{tab.label}</span>
      <button
        className="ml-1 rounded-sm p-0.5 hover:bg-destructive/20 hover:text-destructive transition-all"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title={tab.type === 'editor' ? 'Close editor' : tab.type === 'code' ? 'Close code tab' : 'Close shell'}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
    </div>
  );
}
