import type { Settings } from '../shared/settings';
import type { CapturePayload, Snapshot, StorageStats } from '../shared/types';
import { estimateBytes, getDb } from './db';

const STATS_KEY = 'stats';

export type WriteOutcome =
  | { stored: true; id: number; evicted: number }
  | { stored: false; reason: 'too-short' | 'unchanged' | 'empty' };

/**
 * Every version of one field, oldest first.
 *
 * The upper bound is `[fieldKey, []]` rather than a big number because
 * IndexedDB sorts arrays after every other key type, so an empty array is
 * reliably greater than any timestamp. Using Infinity would work today and
 * break the first time the second element is not a number.
 */
function fieldRange(fieldKey: string): IDBKeyRange {
  return IDBKeyRange.bound([fieldKey], [fieldKey, []]);
}

/**
 * Stores one version of one field.
 *
 * Everything here happens inside a single transaction. That matters more than
 * it looks: the running byte total and the rows it counts must not be able to
 * drift apart, and a service worker can be killed at any moment — including
 * between two separate writes.
 */
export async function writeSnapshot(
  payload: CapturePayload,
  settings: Settings,
): Promise<WriteOutcome> {
  const text = payload.text;

  if (!text.trim()) return { stored: false, reason: 'empty' };

  // Below this it is not a draft worth a row. Someone typing "ok" into a search
  // box does not need rescuing, and storing it would bury the things that do.
  if (text.length < settings.minLength) return { stored: false, reason: 'too-short' };

  const db = await getDb();
  const tx = db.transaction(['snapshots', 'meta'], 'readwrite');
  const store = tx.objectStore('snapshots');
  const meta = tx.objectStore('meta');
  const byFieldCreated = store.index('by-field-created');

  // --- Skip an unchanged write ---------------------------------------------
  // The debounce already collapses bursts of typing, but a user who pauses,
  // clicks away and comes back would otherwise write the same text again.
  const existing: Snapshot[] = await byFieldCreated.getAll(fieldRange(payload.fieldKey));
  const newest = existing[existing.length - 1];
  if (newest && newest.text === text && newest.html === payload.html) {
    await tx.done;
    return { stored: false, reason: 'unchanged' };
  }

  const snapshot: Omit<Snapshot, 'id'> = {
    fieldKey: payload.fieldKey,
    signals: payload.signals,
    text,
    createdAt: payload.capturedAt,
    length: text.length,
    bytes: 0,
    redactions: payload.redactions,
  };
  if (payload.html !== undefined) snapshot.html = payload.html;
  snapshot.bytes = estimateBytes(snapshot);

  const id = (await store.add(snapshot as Snapshot)) as number;

  const stats = (await meta.get(STATS_KEY)) ?? { bytes: 0, snapshots: 0 };
  stats.bytes += snapshot.bytes;
  stats.snapshots += 1;

  // --- Keep only the newest N versions of this field ------------------------
  // Versions, plural, on purpose: the paragraph the user deleted five minutes
  // ago is exactly the thing they want back, and a single latest-only row
  // would have overwritten it.
  let evicted = 0;
  const keep = Math.max(1, settings.versionsPerField);
  const overflow = existing.length + 1 - keep;
  for (let i = 0; i < overflow; i++) {
    const victim = existing[i];
    if (!victim?.id) continue;
    await store.delete(victim.id);
    stats.bytes -= victim.bytes;
    stats.snapshots -= 1;
    evicted++;
  }

  await meta.put(stats, STATS_KEY);
  await tx.done;

  if (stats.bytes > settings.maxBytes) {
    evicted += await evictOldest(settings.maxBytes);
  }

  return { stored: true, id, evicted };
}

/**
 * Deletes oldest-first until total storage is back under the cap.
 *
 * Oldest-first rather than largest-first: a long draft is more valuable than a
 * short one, so size is the wrong thing to punish. Age is the honest proxy for
 * "the user has stopped caring about this".
 */
export async function evictOldest(maxBytes: number): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(['snapshots', 'meta'], 'readwrite');
  const store = tx.objectStore('snapshots');
  const meta = tx.objectStore('meta');
  const stats = (await meta.get(STATS_KEY)) ?? { bytes: 0, snapshots: 0 };

  let removed = 0;
  let cursor = await store.index('by-created').openCursor();

  while (cursor && stats.bytes > maxBytes) {
    stats.bytes -= cursor.value.bytes;
    stats.snapshots -= 1;
    removed++;
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await meta.put(stats, STATS_KEY);
  await tx.done;
  return removed;
}

/**
 * Deletes everything older than the retention window.
 *
 * Called from a chrome.alarms handler, not a setInterval: the service worker is
 * killed after ~30 seconds idle, so any timer longer than that never fires.
 * Alarms wake the worker back up, which is the whole reason they exist.
 */
export async function purgeExpired(settings: Settings, now = Date.now()): Promise<number> {
  if (settings.retentionDays <= 0) return 0; // 0 means keep forever

  const cutoff = now - settings.retentionDays * 24 * 60 * 60 * 1000;

  const db = await getDb();
  const tx = db.transaction(['snapshots', 'meta'], 'readwrite');
  const store = tx.objectStore('snapshots');
  const meta = tx.objectStore('meta');
  const stats = (await meta.get(STATS_KEY)) ?? { bytes: 0, snapshots: 0 };

  let removed = 0;
  let cursor = await store.index('by-created').openCursor(IDBKeyRange.upperBound(cutoff, true));

  while (cursor) {
    stats.bytes -= cursor.value.bytes;
    stats.snapshots -= 1;
    removed++;
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await meta.put(stats, STATS_KEY);
  await tx.done;
  return removed;
}

/** Newest-first versions of one field. */
export async function versionsOfField(fieldKey: string, limit = 10): Promise<Snapshot[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('snapshots', 'by-field-created', fieldRange(fieldKey));
  return rows.reverse().slice(0, limit);
}

/** Newest-first across everything. Phase 4's popup will page through this. */
export async function recentSnapshots(limit = 50): Promise<Snapshot[]> {
  const db = await getDb();
  const rows: Snapshot[] = [];
  let cursor = await db
    .transaction('snapshots')
    .store.index('by-created')
    .openCursor(null, 'prev');

  while (cursor && rows.length < limit) {
    rows.push(cursor.value);
    cursor = await cursor.continue();
  }
  return rows;
}

/**
 * Every snapshot stored for one site.
 *
 * Scoped by origin because that is the one gate the scorer applies before
 * anything else — there is no such thing as a partial match across two sites,
 * so there is no point loading them.
 */
export async function snapshotsForOrigin(origin: string, limit = 500): Promise<Snapshot[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('snapshots', 'by-origin', IDBKeyRange.only(origin));
  return rows.slice(-limit);
}

export async function getStats(): Promise<StorageStats> {
  const db = await getDb();
  const meta = await db.get('meta', STATS_KEY);

  // Distinct field count needs a unique cursor over the index: getAllKeys
  // returns the *primary* keys of matching rows, one per snapshot, which would
  // just count rows again.
  let fields = 0;
  let cursor = await db
    .transaction('snapshots')
    .store.index('by-field')
    .openKeyCursor(null, 'nextunique');
  while (cursor) {
    fields++;
    cursor = await cursor.continue();
  }

  return { snapshots: meta?.snapshots ?? 0, bytes: meta?.bytes ?? 0, fields };
}

export async function deleteAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['snapshots', 'meta'], 'readwrite');
  await tx.objectStore('snapshots').clear();
  await tx.objectStore('meta').put({ bytes: 0, snapshots: 0 }, STATS_KEY);
  await tx.done;
}
