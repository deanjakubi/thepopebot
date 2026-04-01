import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { getDb } from './db/index.js';
import { settings } from './db/schema.js';
import { invalidateApiKeyCache } from './db/api-keys.js';

const ONE_HOUR = 60 * 60 * 1000;

function cleanExpiredAgentJobKeys() {
  try {
    const db = getDb();
    const cutoff = Date.now() - ONE_HOUR;
    const rows = db
      .select({ id: settings.id, lastUsedAt: settings.lastUsedAt, createdAt: settings.createdAt })
      .from(settings)
      .where(eq(settings.type, 'agent_job_api_key'))
      .all();
    const expiredIds = rows
      .filter(r => r.lastUsedAt !== null ? r.lastUsedAt < cutoff : r.createdAt < cutoff)
      .map(r => r.id);
    if (expiredIds.length > 0) {
      for (const id of expiredIds) {
        db.delete(settings).where(eq(settings.id, id)).run();
      }
      invalidateApiKeyCache();
      console.log(`[maintenance] Deleted ${expiredIds.length} expired agent job key(s)`);
    } else {
      console.log(`[maintenance] No expired agent job keys (${rows.length} active)`);
    }
  } catch (err) {
    console.error('[maintenance] cleanExpiredAgentJobKeys failed:', err);
  }
}

function runMaintenance() {
  console.log('[maintenance] Running maintenance...');
  cleanExpiredAgentJobKeys();
}

export function startMaintenanceCron() {
  cron.schedule('0 * * * *', runMaintenance);
}
