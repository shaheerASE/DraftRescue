import { browser } from 'wxt/browser';
import { MESSAGE, type Snapshot, type StorageStats } from '../../shared/types';

/**
 * Everything the popup and options page ask the service worker for.
 *
 * They are pages in the extension's own origin, so they COULD open IndexedDB
 * directly. They go through the worker anyway so that exactly one piece of code
 * knows the schema and keeps the byte totals honest — two writers drifting
 * apart is the kind of bug that only shows up as a storage meter that lies.
 */

async function send<T>(message: unknown, fallback: T): Promise<T> {
  try {
    const result = await browser.runtime.sendMessage(message);
    return (result ?? fallback) as T;
  } catch {
    // The worker can be mid-restart, or the extension mid-reload. A page that
    // throws here would show a blank panel; a page that falls back shows an
    // empty one and recovers on the next interaction.
    return fallback;
  }
}

export function fetchSnapshots(options: { search?: string; limit?: number } = {}) {
  return send<Snapshot[]>({ kind: MESSAGE.query, ...options }, []);
}

export function fetchStats() {
  return send<StorageStats>({ kind: MESSAGE.stats }, { snapshots: 0, fields: 0, bytes: 0 });
}

export function deleteSnapshot(id: number) {
  return send<boolean>({ kind: MESSAGE.deleteOne, id }, false);
}

export function deleteSite(origin: string) {
  return send<number>({ kind: MESSAGE.deleteSite, origin }, 0);
}

export function deleteEverything() {
  return send<boolean>({ kind: MESSAGE.deleteAll }, false);
}

/** One site's drafts, with the pages under it. */
export interface SiteGroup {
  origin: string;
  host: string;
  count: number;
  newest: number;
  pages: Array<{ pathname: string; snapshots: Snapshot[] }>;
}

/**
 * Group flat rows into site → page → drafts.
 *
 * Grouped because that is how people look for a draft: they remember where they
 * were writing long before they remember when. A flat reverse-chronological
 * list makes you scan every row on every site to find the one from LinkedIn.
 */
export function groupBySite(snapshots: readonly Snapshot[]): SiteGroup[] {
  const sites = new Map<string, Map<string, Snapshot[]>>();

  for (const snapshot of snapshots) {
    const { origin, pathname } = snapshot.signals;
    let pages = sites.get(origin);
    if (!pages) {
      pages = new Map();
      sites.set(origin, pages);
    }
    const rows = pages.get(pathname);
    if (rows) rows.push(snapshot);
    else pages.set(pathname, [snapshot]);
  }

  const groups: SiteGroup[] = [];
  for (const [origin, pages] of sites) {
    let count = 0;
    let newest = 0;
    const collected: SiteGroup['pages'] = [];

    for (const [pathname, rows] of pages) {
      rows.sort((a, b) => b.createdAt - a.createdAt);
      count += rows.length;
      newest = Math.max(newest, rows[0]?.createdAt ?? 0);
      collected.push({ pathname, snapshots: rows });
    }

    collected.sort(
      (a, b) => (b.snapshots[0]?.createdAt ?? 0) - (a.snapshots[0]?.createdAt ?? 0),
    );

    groups.push({ origin, host: hostOf(origin), count, newest, pages: collected });
  }

  groups.sort((a, b) => b.newest - a.newest);
  return groups;
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return origin;
  }
}

/** Bytes in a form that fits a narrow column and never jitters in width. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** An absolute timestamp, because "3d ago" is useless when hunting for a draft. */
export function formatWhen(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;

  const day = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  return `${day} ${time}`;
}

/** Collapse whitespace so a preview line stays one line. */
export function previewOf(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
