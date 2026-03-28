import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { getDb } from './index.js';
import { settings } from './schema.js';
import { encrypt, decrypt } from './crypto.js';
import { createOAuthToken } from './oauth-tokens.js';

// ─────────────────────────────────────────────────────────────────────────────
// Plain config (type: 'config')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a plain config value.
 * @param {string} key
 * @returns {string|null}
 */
export function getConfigValue(key) {
  const db = getDb();
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.type, 'config'), eq(settings.key, key)))
    .get();
  if (!row) return null;
  return JSON.parse(row.value);
}

/**
 * Set a plain config value (upsert: delete + insert).
 * @param {string} key
 * @param {string} value
 * @param {string} [userId]
 */
export function setConfigValue(key, value, userId) {
  const db = getDb();
  const now = Date.now();
  db.delete(settings)
    .where(and(eq(settings.type, 'config'), eq(settings.key, key)))
    .run();
  db.insert(settings)
    .values({
      id: randomUUID(),
      type: 'config',
      key,
      value: JSON.stringify(value),
      createdBy: userId || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/**
 * Delete a plain config value.
 * @param {string} key
 */
export function deleteConfigValue(key) {
  const db = getDb();
  db.delete(settings)
    .where(and(eq(settings.type, 'config'), eq(settings.key, key)))
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Encrypted secrets (type: 'config_secret')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a decrypted secret value.
 * @param {string} key
 * @returns {string|null}
 */
export function getConfigSecret(key) {
  const db = getDb();
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.type, 'config_secret'), eq(settings.key, key)))
    .get();
  if (!row) return null;
  try {
    return decrypt(JSON.parse(row.value));
  } catch {
    return null;
  }
}

/**
 * Set an encrypted secret (upsert: delete + insert).
 * @param {string} key
 * @param {string} value - Plaintext value to encrypt
 * @param {string} [userId]
 */
export function setConfigSecret(key, value, userId) {
  const db = getDb();
  const now = Date.now();
  const encrypted = encrypt(value);
  db.delete(settings)
    .where(and(eq(settings.type, 'config_secret'), eq(settings.key, key)))
    .run();
  db.insert(settings)
    .values({
      id: randomUUID(),
      type: 'config_secret',
      key,
      value: JSON.stringify(encrypted),
      createdBy: userId || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/**
 * Delete an encrypted secret.
 * @param {string} key
 */
export function deleteConfigSecret(key) {
  const db = getDb();
  db.delete(settings)
    .where(and(eq(settings.type, 'config_secret'), eq(settings.key, key)))
    .run();
}

/**
 * Get status (set/not-set + updatedAt) for multiple secret keys. Never returns values.
 * @param {string[]} keys
 * @returns {{ key: string, isSet: boolean, updatedAt: number|null }[]}
 */
export function getSecretStatus(keys) {
  const db = getDb();
  const rows = db
    .select({ key: settings.key, updatedAt: settings.updatedAt })
    .from(settings)
    .where(eq(settings.type, 'config_secret'))
    .all();
  const map = new Map(rows.map((r) => [r.key, r.updatedAt]));
  return keys.map((key) => ({
    key,
    isSet: map.has(key),
    updatedAt: map.get(key) || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom LLM providers (type: 'llm_provider')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all custom providers (API keys masked for UI).
 * @returns {{ key: string, name: string, baseUrl: string, models: string[], hasApiKey: boolean }[]}
 */
export function getCustomProviders() {
  const db = getDb();
  const rows = db
    .select()
    .from(settings)
    .where(eq(settings.type, 'llm_provider'))
    .all();
  return rows.map((row) => {
    const config = JSON.parse(decrypt(JSON.parse(row.value)));
    return {
      key: row.key,
      name: config.name,
      baseUrl: config.baseUrl,
      models: config.models || [],
      hasApiKey: !!config.apiKey,
    };
  });
}

/**
 * Get a single custom provider with full (unmasked) API key — for runtime use.
 * @param {string} key
 * @returns {{ name: string, baseUrl: string, apiKey: string, models: string[] }|null}
 */
export function getCustomProvider(key) {
  const db = getDb();
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.type, 'llm_provider'), eq(settings.key, key)))
    .get();
  if (!row) return null;
  const config = JSON.parse(decrypt(JSON.parse(row.value)));
  if (!config.models) config.models = [];
  return config;
}

/**
 * Create or update a custom provider (encrypted JSON).
 * @param {string} key - Slug identifier (e.g. 'together-ai')
 * @param {{ name: string, baseUrl: string, apiKey?: string, models: string[] }} config
 * @param {string} [userId]
 */
export function setCustomProvider(key, config, userId) {
  const db = getDb();
  const now = Date.now();
  const encrypted = encrypt(JSON.stringify(config));
  db.delete(settings)
    .where(and(eq(settings.type, 'llm_provider'), eq(settings.key, key)))
    .run();
  db.insert(settings)
    .values({
      id: randomUUID(),
      type: 'llm_provider',
      key,
      value: JSON.stringify(encrypted),
      createdBy: userId || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/**
 * Delete a custom provider.
 * @param {string} key
 */
export function deleteCustomProvider(key) {
  const db = getDb();
  db.delete(settings)
    .where(and(eq(settings.type, 'llm_provider'), eq(settings.key, key)))
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent job secrets (type: 'agent_job_secret')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set an agent job secret (upsert, encrypted).
 * @param {string} key
 * @param {string} value - Plaintext value to encrypt
 * @param {string} [userId]
 */
export function setAgentJobSecret(key, value, userId) {
  const db = getDb();
  const now = Date.now();
  const encrypted = encrypt(value);
  db.delete(settings)
    .where(and(eq(settings.type, 'agent_job_secret'), eq(settings.key, key)))
    .run();
  db.insert(settings)
    .values({
      id: randomUUID(),
      type: 'agent_job_secret',
      key,
      value: JSON.stringify(encrypted),
      createdBy: userId || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/**
 * Delete an agent job secret.
 * @param {string} key
 */
export function deleteAgentJobSecret(key) {
  const db = getDb();
  db.delete(settings)
    .where(and(eq(settings.type, 'agent_job_secret'), eq(settings.key, key)))
    .run();
}

/**
 * List agent job secrets (metadata only, never values).
 * @returns {{ key: string, isSet: boolean, updatedAt: number }[]}
 */
export function listAgentJobSecrets() {
  const db = getDb();
  const rows = db
    .select({ key: settings.key, updatedAt: settings.updatedAt })
    .from(settings)
    .where(eq(settings.type, 'agent_job_secret'))
    .all();
  return rows.map((r) => ({ key: r.key, isSet: true, updatedAt: r.updatedAt }));
}

/**
 * Get all agent job secrets decrypted (for runtime injection only).
 * @returns {{ key: string, value: string }[]}
 */
export function getAllAgentJobSecrets() {
  const db = getDb();
  const rows = db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.type, 'agent_job_secret'))
    .all();
  return rows.map((r) => {
    try {
      return { key: r.key, value: decrypt(JSON.parse(r.value)) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration: import env vars to DB on first run
// ─────────────────────────────────────────────────────────────────────────────

// Secrets to migrate from process.env → config_secret
const MIGRATE_SECRETS = [
  'GH_TOKEN',
  'GH_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
];

// Plain config to migrate from process.env → config
const MIGRATE_CONFIG = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_MAX_TOKENS',
  'AGENT_BACKEND',
  'CUSTOM_OPENAI_BASE_URL',
  'TELEGRAM_CHAT_ID',
];

/**
 * One-time migration: import env vars into DB if no config entries exist yet.
 * Idempotent — checks for any existing config/config_secret rows first.
 */
export function migrateEnvToDb() {
  const db = getDb();

  // Check if migration already happened (any config or config_secret row exists)
  const existing = db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.type, 'config'))
    .limit(1)
    .get();
  const existingSecret = db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.type, 'config_secret'))
    .limit(1)
    .get();

  if (existing || existingSecret) return; // Already migrated

  let migrated = 0;

  for (const key of MIGRATE_SECRETS) {
    const value = process.env[key];
    if (value) {
      if (key === 'CLAUDE_CODE_OAUTH_TOKEN') {
        // OAuth tokens use {name, token} wrapper format for multi-token support
        createOAuthToken('claudeCode', 'OAuth Token', value, 'migration');
      } else {
        setConfigSecret(key, value, 'migration');
      }
      migrated++;
    }
  }

  for (const key of MIGRATE_CONFIG) {
    const value = process.env[key];
    if (value) {
      setConfigValue(key, value, 'migration');
      migrated++;
    }
  }

  // Migrate custom provider from OPENAI_BASE_URL + CUSTOM_API_KEY
  if (process.env.LLM_PROVIDER === 'custom' && (process.env.CUSTOM_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL)) {
    setCustomProvider('custom', {
      name: 'Custom',
      baseUrl: process.env.CUSTOM_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL,
      apiKey: process.env.CUSTOM_API_KEY || '',
      models: process.env.LLM_MODEL ? [process.env.LLM_MODEL] : [],
    }, 'migration');
    migrated++;
  }

  if (migrated > 0) {
    console.log(`Migrated ${migrated} config values from .env to database`);
  }

  // Rename OPENAI_BASE_URL → CUSTOM_OPENAI_BASE_URL (added in unified coding agent release)
  migrateConfigKey('OPENAI_BASE_URL', 'CUSTOM_OPENAI_BASE_URL');
}

/**
 * Rename a config key in the DB if the old key exists and the new key does not.
 * @param {string} oldKey
 * @param {string} newKey
 */
function migrateConfigKey(oldKey, newKey) {
  const db = getDb();
  const oldRow = db
    .select()
    .from(settings)
    .where(and(eq(settings.type, 'config'), eq(settings.key, oldKey)))
    .get();
  if (!oldRow) return;
  const newRow = db
    .select({ id: settings.id })
    .from(settings)
    .where(and(eq(settings.type, 'config'), eq(settings.key, newKey)))
    .get();
  if (newRow) {
    // New key already exists, just delete the old one
    db.delete(settings).where(eq(settings.id, oldRow.id)).run();
  } else {
    // Rename by inserting new + deleting old
    const now = Date.now();
    db.insert(settings)
      .values({
        id: randomUUID(),
        type: 'config',
        key: newKey,
        value: oldRow.value,
        createdBy: oldRow.createdBy,
        createdAt: oldRow.createdAt,
        updatedAt: now,
      })
      .run();
    db.delete(settings).where(eq(settings.id, oldRow.id)).run();
  }
  console.log(`Migrated config key ${oldKey} → ${newKey}`);
}
