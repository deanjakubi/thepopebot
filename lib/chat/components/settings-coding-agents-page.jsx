'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckIcon } from './icons.js';
import {
  getCodingAgentSettings,
  updateCodingAgentConfig,
  setCodingAgentDefault,
} from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Coding Agents settings page
// ─────────────────────────────────────────────────────────────────────────────

export function CodingAgentsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSettings = async () => {
    try {
      const result = await getCodingAgentSettings();
      setSettings(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  if (settings?.error) {
    return <p className="text-sm text-destructive">{settings.error}</p>;
  }

  return (
    <div className="space-y-6">
      <DefaultAgentSection settings={settings} onReload={loadSettings} />
      <AgentCards settings={settings} onReload={loadSettings} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Agent section
// ─────────────────────────────────────────────────────────────────────────────

function DefaultAgentSection({ settings, onReload }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Build list of agents that are enabled AND have valid credentials
  const available = [];
  if (settings.claudeCode?.enabled && isClaudeCodeReady(settings)) {
    available.push({ value: 'claude-code', label: 'Claude Code' });
  }
  if (settings.pi?.enabled && isPiReady(settings)) {
    available.push({ value: 'pi-coding-agent', label: 'Pi Coding Agent' });
  }

  const handleChange = async (e) => {
    setSaving(true);
    const result = await setCodingAgentDefault(e.target.value);
    setSaving(false);
    if (result?.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onReload();
    }
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Default Coding Agent</h2>
        <p className="text-sm text-muted-foreground">Select which coding agent runs headless tasks and code workspaces.</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium shrink-0">Agent</label>
          <div className="flex items-center gap-3">
            {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
            {saved && <span className="text-xs text-green-500 inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span>}
            <select
              value={settings.defaultAgent || 'claude-code'}
              onChange={handleChange}
              className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            >
              {available.length > 0 ? (
                available.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))
              ) : (
                <option value="" disabled>No agents ready</option>
              )}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Cards
// ─────────────────────────────────────────────────────────────────────────────

function AgentCards({ settings, onReload }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Agents</h2>
        <p className="text-sm text-muted-foreground">Enable and configure individual coding agents.</p>
      </div>
      <div className="space-y-4">
        <ClaudeCodeCard settings={settings} onReload={onReload} />
        <PiCard settings={settings} onReload={onReload} />
        <OpenCodeCard />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Code card
// ─────────────────────────────────────────────────────────────────────────────

function ClaudeCodeCard({ settings, onReload }) {
  const config = settings.claudeCode;
  const ready = isClaudeCodeReady(settings);

  // Anthropic models available for coding agents
  const anthropicModels = getAgentModels(settings, 'anthropic');

  const handleToggle = async () => {
    await updateCodingAgentConfig('claude-code', { enabled: !config.enabled });
    await onReload();
  };

  const handleAuthChange = async (auth) => {
    await updateCodingAgentConfig('claude-code', { auth });
    await onReload();
  };

  const handleModelChange = async (e) => {
    await updateCodingAgentConfig('claude-code', { model: e.target.value });
    await onReload();
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Claude Code</span>
          <StatusDot ready={ready} />
        </div>
        <ToggleSwitch checked={config.enabled} onChange={handleToggle} />
      </div>
      <p className="text-xs text-muted-foreground mb-3">Anthropic's official coding agent. Supports plan and code permission modes.</p>

      {config.enabled && (
        <div className="border-t border-border pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Auth Mode</label>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => handleAuthChange('oauth')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  config.auth === 'oauth'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                OAuth Token
              </button>
              <button
                onClick={() => handleAuthChange('api-key')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  config.auth === 'api-key'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                API Key
              </button>
            </div>
          </div>

          {config.auth === 'oauth' ? (
            <CredentialHint
              ready={config.oauthTokenCount > 0}
              readyText={`${config.oauthTokenCount} OAuth token${config.oauthTokenCount !== 1 ? 's' : ''} configured`}
              missingText="Add an OAuth token on the LLMs page under Anthropic → OAuth Tokens"
            />
          ) : (
            <CredentialHint
              ready={config.anthropicKeySet}
              readyText="Anthropic API Key is set"
              missingText="Set your Anthropic API Key on the LLMs page"
            />
          )}

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Model</label>
              <select
                value={config.model || ''}
                onChange={handleModelChange}
                className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              >
                <option value="">Default</option>
                {anthropicModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pi Coding Agent card
// ─────────────────────────────────────────────────────────────────────────────

function PiCard({ settings, onReload }) {
  const config = settings.pi;
  const [customModel, setCustomModel] = useState(config.model || '');

  const handleToggle = async () => {
    await updateCodingAgentConfig('pi-coding-agent', { enabled: !config.enabled });
    await onReload();
  };

  const handleProviderChange = async (e) => {
    // Reset model when provider changes
    await updateCodingAgentConfig('pi-coding-agent', { provider: e.target.value, model: '' });
    setCustomModel('');
    await onReload();
  };

  const handleModelChange = async (e) => {
    await updateCodingAgentConfig('pi-coding-agent', { model: e.target.value });
    await onReload();
  };

  const handleCustomModelSave = useCallback(async () => {
    await updateCodingAgentConfig('pi-coding-agent', { model: customModel });
    await onReload();
  }, [customModel, onReload]);

  // Build available providers list (builtin with keys set + custom providers)
  const availableProviders = [];
  if (settings?.builtinProviders && settings?.credentialStatuses) {
    const statusMap = new Map(settings.credentialStatuses.map((s) => [s.key, s.isSet]));
    for (const [slug, prov] of Object.entries(settings.builtinProviders)) {
      const hasKey = prov.credentials.some((c) => statusMap.get(c.key));
      if (hasKey) {
        availableProviders.push({ slug, name: prov.name });
      }
    }
  }
  if (settings?.customProviders) {
    for (const cp of settings.customProviders) {
      availableProviders.push({ slug: cp.key, name: cp.name, isCustom: true });
    }
  }

  const ready = isPiReady(settings);
  const selectedProviderReady = availableProviders.some(p => p.slug === config.provider);
  const isCustomProvider = availableProviders.find(p => p.slug === config.provider)?.isCustom;

  // Get models for selected provider (codingAgent-capable only)
  const providerModels = config.provider ? getAgentModels(settings, config.provider) : [];

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Pi Coding Agent</span>
          {config.enabled && <StatusDot ready={ready} />}
        </div>
        <ToggleSwitch checked={config.enabled} onChange={handleToggle} />
      </div>
      <p className="text-xs text-muted-foreground mb-3">Third-party agent by Mario Zechner. Works with 20+ LLM providers.</p>

      {config.enabled && (
        <div className="border-t border-border pt-3 space-y-3">
          {availableProviders.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Provider</label>
                <select
                  value={config.provider || ''}
                  onChange={handleProviderChange}
                  className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                >
                  <option value="">Select provider...</option>
                  {availableProviders.map((p) => (
                    <option key={p.slug} value={p.slug}>{p.name}</option>
                  ))}
                </select>
              </div>

              {config.provider && (
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Model</label>
                  {isCustomProvider ? (
                    <input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      onBlur={handleCustomModelSave}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomModelSave()}
                      placeholder="Leave empty for provider default"
                      className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    />
                  ) : (
                    <select
                      value={config.model || ''}
                      onChange={handleModelChange}
                      className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    >
                      <option value="">Default</option>
                      {providerModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {config.provider && !selectedProviderReady && (
                <CredentialHint
                  ready={false}
                  missingText={`${config.provider} API Key is not set. Configure it on the LLMs page.`}
                />
              )}
            </>
          ) : (
            <CredentialHint
              ready={false}
              missingText="Configure at least one LLM provider on the LLMs page to use Pi"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode card (coming soon)
// ─────────────────────────────────────────────────────────────────────────────

function OpenCodeCard() {
  return (
    <div className="rounded-lg border bg-card p-4 opacity-60">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">OpenCode</span>
          <span className="text-xs text-muted-foreground">Coming soon</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Open-source coding agent with multi-provider support.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get models for a provider that are coding-agent capable.
 * Models without a codingAgent flag default to true.
 */
function getAgentModels(settings, providerSlug) {
  const provider = settings?.builtinProviders?.[providerSlug];
  if (!provider?.models) return [];
  return provider.models.filter((m) => m.codingAgent !== false);
}

function isClaudeCodeReady(settings) {
  const { claudeCode } = settings;
  if (!claudeCode?.enabled) return false;
  if (claudeCode.auth === 'oauth') return claudeCode.oauthTokenCount > 0;
  return claudeCode.anthropicKeySet;
}

function isPiReady(settings) {
  if (!settings.pi?.enabled || !settings.pi?.provider) return false;
  // Check if selected provider has credentials
  const statusMap = new Map((settings.credentialStatuses || []).map(s => [s.key, s.isSet]));
  const builtin = settings.builtinProviders?.[settings.pi.provider];
  if (builtin) {
    return builtin.credentials.some(c => statusMap.get(c.key));
  }
  // Custom provider — always considered ready if it exists
  return (settings.customProviders || []).some(cp => cp.key === settings.pi.provider);
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-foreground' : 'bg-border'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function StatusDot({ ready }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${ready ? 'bg-green-500' : 'bg-border'}`} />
      <span className={`text-xs ${ready ? 'text-green-500' : 'text-muted-foreground'}`}>
        {ready ? 'Ready' : 'Missing credentials'}
      </span>
    </span>
  );
}

function CredentialHint({ ready, readyText, missingText }) {
  if (ready) {
    return (
      <p className="text-xs text-green-500 flex items-center gap-1">
        <CheckIcon size={12} />
        {readyText}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {missingText}{' '}
      <a href="/admin/event-handler/llms" className="underline hover:text-foreground transition-colors">
        Go to LLMs settings
      </a>
    </p>
  );
}
