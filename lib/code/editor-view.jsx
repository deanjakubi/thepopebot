'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { listDirectory, readFile, writeFile, createFile, createDirectory, deleteFile, renameFile } from './actions.js';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME_KEY = 'terminal-theme'; // share with terminal-view

function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}

function resolveMonacoTheme(mode) {
  if (mode === 'light') return 'light';
  if (mode === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  }
  return 'vs-dark';
}

// ---------------------------------------------------------------------------
// Language detection from file extension
// ---------------------------------------------------------------------------

const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', jsonc: 'json',
  md: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html',
  xml: 'xml', svg: 'xml',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  yml: 'yaml', yaml: 'yaml',
  toml: 'ini',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

function detectLanguage(filename) {
  if (!filename) return 'plaintext';
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile';
  const ext = lower.split('.').pop();
  return EXT_LANG[ext] || 'plaintext';
}

// ---------------------------------------------------------------------------
// File icons (simple SVG inline)
// ---------------------------------------------------------------------------

function FolderIcon({ open, size = 14 }) {
  return open ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function FileIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded-md border border-border bg-background shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-border" />
        ) : (
          <button
            key={i}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-50"
            onClick={() => { item.action(); onClose(); }}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileTreeNode (recursive)
// ---------------------------------------------------------------------------

function FileTreeNode({ entry, depth, workspaceId, parentPath, onOpenFile, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const isDir = entry.type === 'directory';

  const loadChildren = useCallback(async () => {
    setLoading(true);
    const result = await listDirectory(workspaceId, fullPath);
    if (result?.success) {
      setChildren(result.entries);
    }
    setLoading(false);
  }, [workspaceId, fullPath]);

  const handleClick = useCallback(() => {
    if (isDir) {
      const willExpand = !expanded;
      setExpanded(willExpand);
      if (willExpand && children === null) {
        loadChildren();
      }
    } else {
      onOpenFile(fullPath, entry.name);
    }
  }, [isDir, expanded, children, loadChildren, onOpenFile, fullPath, entry.name]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== entry.name) {
      const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
      await renameFile(workspaceId, fullPath, newPath);
      onRefresh();
    }
    setRenaming(false);
  }, [renameValue, entry.name, parentPath, workspaceId, fullPath, onRefresh]);

  const contextItems = [
    ...(isDir ? [
      { label: 'New File...', action: async () => {
        const name = prompt('File name:');
        if (name) {
          await createFile(workspaceId, `${fullPath}/${name}`);
          if (expanded) loadChildren(); else { setExpanded(true); loadChildren(); }
        }
      }},
      { label: 'New Folder...', action: async () => {
        const name = prompt('Folder name:');
        if (name) {
          await createDirectory(workspaceId, `${fullPath}/${name}`);
          if (expanded) loadChildren(); else { setExpanded(true); loadChildren(); }
        }
      }},
      { separator: true },
    ] : []),
    { label: 'Rename...', action: () => { setRenameValue(entry.name); setRenaming(true); }},
    { label: 'Delete', action: async () => {
      if (confirm(`Delete "${entry.name}"?`)) {
        await deleteFile(workspaceId, fullPath);
        onRefresh();
      }
    }},
  ];

  return (
    <div>
      <div
        className="flex items-center gap-1 px-1 py-0.5 text-xs cursor-pointer hover:bg-accent rounded-sm transition-colors group"
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="w-3 shrink-0 text-muted-foreground">
          {isDir ? (
            <svg width={10} height={10} viewBox="0 0 16 16" fill="currentColor" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>
              <path d="M6 4l4 4-4 4z" />
            </svg>
          ) : null}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {isDir ? <FolderIcon open={expanded} size={14} /> : <FileIcon size={14} />}
        </span>
        {renaming ? (
          <input
            className="flex-1 bg-input border border-border rounded px-1 py-0 text-xs outline-none focus:ring-1 focus:ring-primary"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(false); }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{entry.name}</span>
        )}
        {loading && (
          <svg className="animate-spin h-3 w-3 text-muted-foreground ml-auto" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {isDir && expanded && children && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.name}
              entry={child}
              depth={depth + 1}
              workspaceId={workspaceId}
              parentPath={fullPath}
              onOpenFile={onOpenFile}
              onRefresh={() => loadChildren()}
            />
          ))}
          {children.length === 0 && (
            <div className="text-xs text-muted-foreground italic" style={{ paddingLeft: (depth + 1) * 16 + 20 }}>
              Empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditorView main component
// ---------------------------------------------------------------------------

export default function EditorView({ codeWorkspaceId }) {
  const [theme, setTheme] = useState('dark');
  const [rootEntries, setRootEntries] = useState(null);
  const [openFiles, setOpenFiles] = useState([]); // [{path, name, content, originalContent, language}]
  const [activeFilePath, setActiveFilePath] = useState(null);
  const [saving, setSaving] = useState(false);
  const [treeWidth, setTreeWidth] = useState(240);
  const [rootContextMenu, setRootContextMenu] = useState(null);
  const resizing = useRef(false);

  // Load theme from shared localStorage
  useEffect(() => {
    setTheme(getStoredTheme());
    function onStorage(e) {
      if (e.key === THEME_KEY) setTheme(e.newValue || 'dark');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Load root directory
  const loadRoot = useCallback(async () => {
    const result = await listDirectory(codeWorkspaceId, '');
    if (result?.success) {
      setRootEntries(result.entries);
    }
  }, [codeWorkspaceId]);

  useEffect(() => { loadRoot(); }, [loadRoot]);

  // Open a file
  const handleOpenFile = useCallback(async (path, name) => {
    // If already open, just switch to it
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      setActiveFilePath(path);
      return;
    }

    const result = await readFile(codeWorkspaceId, path);
    if (!result?.success) {
      alert(result?.message || 'Failed to read file');
      return;
    }

    const language = detectLanguage(name);
    setOpenFiles((prev) => [...prev, { path, name, content: result.content, originalContent: result.content, language }]);
    setActiveFilePath(path);
  }, [codeWorkspaceId, openFiles]);

  // Close a file tab
  const handleCloseFile = useCallback((path) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path));
    setActiveFilePath((prev) => {
      if (prev !== path) return prev;
      const remaining = openFiles.filter((f) => f.path !== path);
      return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
    });
  }, [openFiles]);

  // Update file content (from editor onChange)
  const handleContentChange = useCallback((path, newContent) => {
    setOpenFiles((prev) => prev.map((f) => f.path === path ? { ...f, content: newContent } : f));
  }, []);

  // Save file
  const handleSave = useCallback(async () => {
    const file = openFiles.find((f) => f.path === activeFilePath);
    if (!file) return;

    setSaving(true);
    const result = await writeFile(codeWorkspaceId, file.path, file.content);
    if (result?.success) {
      setOpenFiles((prev) => prev.map((f) => f.path === file.path ? { ...f, originalContent: f.content } : f));
    } else {
      alert(result?.message || 'Failed to save');
    }
    setSaving(false);
  }, [codeWorkspaceId, activeFilePath, openFiles]);

  // Ctrl+S / Cmd+S handler
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  // Resizable divider
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = treeWidth;

    function onMouseMove(e) {
      if (!resizing.current) return;
      const newWidth = Math.max(140, Math.min(500, startWidth + (e.clientX - startX)));
      setTreeWidth(newWidth);
    }

    function onMouseUp() {
      resizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [treeWidth]);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const monacoTheme = resolveMonacoTheme(theme);

  const handleRootContextMenu = useCallback((e) => {
    e.preventDefault();
    setRootContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-background">
      {/* File tree panel */}
      <div
        className="flex flex-col border-r border-border overflow-hidden shrink-0"
        style={{ width: treeWidth }}
      >
        <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border bg-muted/30">
          <span className="uppercase tracking-wider">Explorer</span>
          <button
            className="p-0.5 rounded hover:bg-accent transition-colors"
            onClick={loadRoot}
            title="Refresh"
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden py-1"
          onContextMenu={handleRootContextMenu}
        >
          {rootEntries === null ? (
            <div className="px-3 py-2">
              <div className="h-4 bg-border/50 rounded-md animate-pulse mb-2" />
              <div className="h-4 bg-border/50 rounded-md animate-pulse mb-2" />
              <div className="h-4 bg-border/50 rounded-md animate-pulse" />
            </div>
          ) : rootEntries.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground italic text-center">No files</div>
          ) : (
            rootEntries.map((entry) => (
              <FileTreeNode
                key={entry.name}
                entry={entry}
                depth={0}
                workspaceId={codeWorkspaceId}
                parentPath=""
                onOpenFile={handleOpenFile}
                onRefresh={loadRoot}
              />
            ))
          )}
        </div>

        {rootContextMenu && (
          <ContextMenu
            x={rootContextMenu.x}
            y={rootContextMenu.y}
            items={[
              { label: 'New File...', action: async () => {
                const name = prompt('File name:');
                if (name) { await createFile(codeWorkspaceId, name); loadRoot(); }
              }},
              { label: 'New Folder...', action: async () => {
                const name = prompt('Folder name:');
                if (name) { await createDirectory(codeWorkspaceId, name); loadRoot(); }
              }},
            ]}
            onClose={() => setRootContextMenu(null)}
          />
        )}
      </div>

      {/* Resize handle */}
      <div
        className="w-1 cursor-col-resize hover:bg-primary/20 transition-colors shrink-0"
        onMouseDown={handleMouseDown}
      />

      {/* Editor panel */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Open file tabs */}
        {openFiles.length > 0 && (
          <div className="flex items-center gap-0 bg-muted/30 border-b border-border overflow-x-auto shrink-0">
            {openFiles.map((file) => {
              const isActive = file.path === activeFilePath;
              const isModified = file.content !== file.originalContent;
              return (
                <div
                  key={file.path}
                  className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono cursor-pointer border-r border-border transition-colors ${
                    isActive
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                  onClick={() => setActiveFilePath(file.path)}
                >
                  {isModified && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                  <span className="truncate max-w-[150px]">{file.name}</span>
                  <button
                    className="ml-1 rounded-sm p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all"
                    onClick={(e) => { e.stopPropagation(); handleCloseFile(file.path); }}
                    title="Close"
                  >
                    <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="4" y1="4" x2="12" y2="12" />
                      <line x1="12" y1="4" x2="4" y2="12" />
                    </svg>
                  </button>
                </div>
              );
            })}
            {saving && (
              <span className="px-2 text-xs text-muted-foreground">Saving...</span>
            )}
          </div>
        )}

        {/* Editor or empty state */}
        {activeFile ? (
          <Editor
            theme={monacoTheme}
            language={activeFile.language}
            value={activeFile.content}
            onChange={(value) => handleContentChange(activeFile.path, value || '')}
            options={{
              fontSize: 14,
              fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", Menlo, monospace',
              minimap: { enabled: true },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              padding: { top: 8 },
              renderLineHighlight: 'all',
              bracketPairColorization: { enabled: true },
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center">
              <svg className="mx-auto mb-3 text-muted-foreground/50" width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              </svg>
              <p>Select a file to edit</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                <kbd className="px-1.5 py-0.5 rounded border border-border text-[10px]">Ctrl+S</kbd> to save
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
