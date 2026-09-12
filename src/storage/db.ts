import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Snapshot } from '../shared/types';

/**
 * IndexedDB, opened in the extension's own origin.
 *
 * WHY HERE AND NOT IN THE CONTENT SCRIPT
 * IndexedDB is scoped to an origin. A content script runs inside the page, so
 * if it opened a database it would open *upwork.com's* database, not ours. The
 * drafts would be siloed per site, invisible to the popup, and wiped whenever
 * the user cleared that site's data. The service worker runs in the extension's
 * own origin, so it is the only place the real store can live — which is why it
 * is the single writer and the content script only ever sends messages.
 *
 * WHY INDEXEDDB AND NOT chrome.storage.local
 * chrome.storage.local is a key-value store that serialises the whole value on
 * every write, with no indexes and no cursors. For thousands of text snapshots
 * that we need to query by field, by site and by date, it is the wrong shape.
 * Settings still live there, because the content script has to read those.
 */

export const DB_NAME = 'draft-rescue';
export const DB_VERSION = 1;

/** Running totals, kept in the database so they survive the worker being killed. */
export interface MetaStats {
  bytes: number;
  snapshots: number;
}

export interface DraftRescueDB extends DBSchema {
  snapshots: {
    key: number;
    value: Snapshot;
    indexes: {
      'by-field': string;
      'by-created': number;
      'by-origin': string;
      /** Compound, so "the newest N versions of this field" is one cursor. */
      'by-field-created': [string, number];
    };
  };
  meta: {
    key: string;
    value: MetaStats;
  };
}

export type DraftRescueDatabase = IDBPDatabase<DraftRescueDB>;

/**
 * Cached across calls, but deliberately re-created when missing.
 *
 * A Manifest V3 service worker is killed after ~30 seconds idle and this module
 * is re-evaluated on the next wake, so this variable is empty again. Treating
 * the connection as a cache rather than as state is what makes that harmless.
 */
let connection: Promise<DraftRescueDatabase> | null = null;

export function getDb(): Promise<DraftRescueDatabase> {
  connection ??= openDB<DraftRescueDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const snapshots = db.createObjectStore('snapshots', {
        keyPath: 'id',
        autoIncrement: true,
      });
      snapshots.createIndex('by-field', 'fieldKey');
      snapshots.createIndex('by-created', 'createdAt');
      snapshots.createIndex('by-origin', 'signals.origin');
      snapshots.createIndex('by-field-created', ['fieldKey', 'createdAt']);

      db.createObjectStore('meta');
    },
    blocking() {
      // Another context is trying to upgrade the schema. Let go of the
      // connection so the upgrade is not blocked forever by a sleeping worker.
      void closeDb();
    },
    terminated() {
      // Chrome closed the connection under us. Drop the cache so the next call
      // opens a fresh one rather than reusing a dead handle.
      connection = null;
    },
  });

  return connection;
}

export async function closeDb(): Promise<void> {
  const current = connection;
  connection = null;
  if (current) (await current).close();
}

/** Test hook: forget the cached connection without touching the database. */
export function resetDbConnectionForTests(): void {
  connection = null;
}

/**
 * Roughly how much space a snapshot costs.
 *
 * Deliberately an estimate. Measuring exactly would mean encoding every string
 * on every keystroke-flush, and the number is only used to decide when to start
 * evicting — being 10% out just moves that threshold slightly. Strings are
 * counted at two bytes per character, which is what a UTF-16 engine actually
 * holds, plus a flat allowance for the row's structure and index entries.
 */
export function estimateBytes(snapshot: Pick<Snapshot, 'text' | 'html' | 'signals'>): number {
  const textBytes = snapshot.text.length * 2;
  const htmlBytes = (snapshot.html?.length ?? 0) * 2;
  const signalBytes = JSON.stringify(snapshot.signals).length * 2;
  return textBytes + htmlBytes + signalBytes + 256;
}
