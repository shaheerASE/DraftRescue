import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Snapshot } from '../../src/shared/types';
import {
  deleteEverything,
  deleteSite,
  deleteSnapshot,
  fetchSnapshots,
  fetchStats,
  formatBytes,
  formatWhen,
  groupBySite,
  previewOf,
  type SiteGroup,
} from '../../src/ui/react/api';

/**
 * The popup: everything ever saved, and a way out of it.
 *
 * The inline prompt handles the common case — you are on the page, the box is
 * empty, one click and the draft is back. This is the other case: the tab is
 * gone, the site has changed, the field never matched. It has to answer "where
 * is the thing I wrote" for someone who only half-remembers where they wrote
 * it, which is why it groups by site rather than listing by time.
 */

const STORAGE_CAP_BYTES = 50 * 1024 * 1024;

export function Popup() {
  const [query, setQuery] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [stats, setStats] = useState({ snapshots: 0, fields: 0, bytes: 0 });
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async (search: string) => {
    const [rows, totals] = await Promise.all([
      fetchSnapshots({ search, limit: 300 }),
      fetchStats(),
    ]);
    setSnapshots(rows);
    setStats(totals);
  }, []);

  useEffect(() => {
    // Debounced so typing in the search box does not run a cursor over the
    // whole database on every keystroke.
    const timer = setTimeout(() => void reload(query), query ? 140 : 0);
    return () => clearTimeout(timer);
  }, [query, reload]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const groups = useMemo(() => groupBySite(snapshots ?? []), [snapshots]);

  const copy = useCallback(async (snapshot: Snapshot) => {
    try {
      await navigator.clipboard.writeText(snapshot.text);
      setCopiedId(snapshot.id ?? null);
      setTimeout(() => setCopiedId(null), 1400);
    } catch {
      // Clipboard can be refused; the preview is still selectable by hand.
    }
  }, []);

  const removeOne = useCallback(
    async (snapshot: Snapshot) => {
      if (snapshot.id === undefined) return;
      // Optimistic: the row leaves immediately, because waiting on a round trip
      // to the worker makes a delete feel broken.
      setSnapshots((rows) => rows?.filter((row) => row.id !== snapshot.id) ?? null);
      await deleteSnapshot(snapshot.id);
      setStats(await fetchStats());
    },
    [],
  );

  const removeSite = useCallback(
    async (origin: string) => {
      setSnapshots((rows) => rows?.filter((row) => row.signals.origin !== origin) ?? null);
      await deleteSite(origin);
      setStats(await fetchStats());
    },
    [],
  );

  const wipe = useCallback(async () => {
    await deleteEverything();
    setConfirmingWipe(false);
    await reload(query);
  }, [query, reload]);

  const loading = snapshots === null;
  const empty = !loading && groups.length === 0;

  return (
    <div className="flex h-[540px] w-[400px] flex-col bg-surface text-text">
      <Header stats={stats} />

      <div className="border-b border-line px-3 py-2">
        <label className="flex items-center gap-2">
          <span aria-hidden className="text-faint">/</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.stopPropagation();
                setQuery('');
              }
            }}
            placeholder="search your drafts"
            aria-label="Search your drafts"
            spellCheck={false}
            className="w-full bg-transparent text-[12px] text-text placeholder:text-faint focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-[11px] text-faint hover:text-text"
              aria-label="Clear search"
            >
              esc
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading && <Notice>reading…</Notice>}

        {empty && query && (
          <Notice>
            nothing matches <span className="text-text">{query}</span>
          </Notice>
        )}

        {empty && !query && (
          <Notice>
            no drafts yet
            <span className="mt-2 block font-serif text-[13px] leading-relaxed text-faint">
              Type more than 15 characters into any text box and it will appear
              here. Nothing you write leaves this machine.
            </span>
          </Notice>
        )}

        {groups.map((group, index) => (
          <Site
            key={group.origin}
            group={group}
            index={index}
            copiedId={copiedId}
            onCopy={copy}
            onDelete={removeOne}
            onDeleteSite={removeSite}
          />
        ))}
      </div>

      <Footer
        confirming={confirmingWipe}
        disabled={stats.snapshots === 0}
        onAsk={() => setConfirmingWipe(true)}
        onCancel={() => setConfirmingWipe(false)}
        onConfirm={wipe}
      />
    </div>
  );
}

function Header({ stats }: { stats: { snapshots: number; fields: number; bytes: number } }) {
  const fraction = Math.min(1, stats.bytes / STORAGE_CAP_BYTES);

  return (
    <header className="border-b border-line px-3 pb-2 pt-2.5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[11px] font-medium uppercase tracking-[0.14em] text-text">
          Draft Rescue
        </h1>
        <button
          type="button"
          onClick={() => void browser.runtime.openOptionsPage()}
          className="text-[11px] text-faint underline-offset-2 hover:text-text hover:underline"
        >
          settings
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
        <span>
          <span className="text-text">{stats.snapshots}</span> saved
        </span>
        <span className="text-faint">·</span>
        <span>
          <span className="text-text">{stats.fields}</span> fields
        </span>
        <span className="text-faint">·</span>
        <span title={`${stats.bytes.toLocaleString()} bytes of 50 MB`}>
          {formatBytes(stats.bytes)}
        </span>

        {/* The meter is a hairline rather than a bar: it is reference
            information, not the point of the panel. */}
        <span
          className="ml-auto h-[3px] w-16 overflow-hidden rounded-full bg-sunken"
          role="img"
          aria-label={`Storage used: ${formatBytes(stats.bytes)} of 50 MB`}
        >
          <span
            className="block h-full bg-accent transition-[width] duration-500"
            style={{ width: `${Math.max(fraction * 100, stats.bytes > 0 ? 2 : 0)}%` }}
          />
        </span>
      </div>
    </header>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-[12px] text-muted">{children}</p>;
}

function Site({
  group,
  index,
  copiedId,
  onCopy,
  onDelete,
  onDeleteSite,
}: {
  group: SiteGroup;
  index: number;
  copiedId: number | null;
  onCopy: (snapshot: Snapshot) => void;
  onDelete: (snapshot: Snapshot) => void;
  onDeleteSite: (origin: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section
      className="rise border-b border-line last:border-b-0"
      // Staggered, but capped: past a handful the delay stops reading as
      // sequence and starts reading as lag.
      style={{ animationDelay: `${Math.min(index, 6) * 28}ms` }}
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-1.5 backdrop-blur-sm">
        <h2 className="truncate text-[11px] font-medium tracking-wide text-text">
          {group.host}
        </h2>
        <span className="text-[11px] text-faint">{group.count}</span>

        {confirming ? (
          <span className="ml-auto flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDeleteSite(group.origin);
              }}
              className="text-alarm hover:underline"
            >
              delete all {group.count}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-faint hover:text-text"
            >
              cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="ml-auto text-[11px] text-faint hover:text-alarm"
            aria-label={`Delete all drafts from ${group.host}`}
          >
            forget site
          </button>
        )}
      </div>

      {group.pages.map((page) => (
        <div key={page.pathname}>
          <p
            className="truncate px-3 pb-0.5 pt-2 text-[10px] text-faint"
            title={page.pathname}
          >
            {page.pathname}
          </p>
          <ul>
            {page.snapshots.map((snapshot) => (
              <Row
                key={snapshot.id}
                snapshot={snapshot}
                copied={copiedId === snapshot.id}
                onCopy={onCopy}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Row({
  snapshot,
  copied,
  onCopy,
  onDelete,
}: {
  snapshot: Snapshot;
  copied: boolean;
  onCopy: (snapshot: Snapshot) => void;
  onDelete: (snapshot: Snapshot) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const field = snapshot.signals.labelText ?? snapshot.signals.fieldName ?? null;

  return (
    <li className="group border-b border-line/60 px-3 py-2 last:border-b-0 hover:bg-hover">
      <div className="flex items-baseline gap-2 text-[10px]">
        <time className="text-muted" dateTime={new Date(snapshot.createdAt).toISOString()}>
          {formatWhen(snapshot.createdAt)}
        </time>
        <span className="text-faint">{snapshot.length} ch</span>
        {field && (
          <span className="truncate text-faint" title={field}>
            {field}
          </span>
        )}
        {snapshot.redactions > 0 && (
          <span
            className="text-faint"
            title={`${snapshot.redactions} sensitive value(s) were replaced with [redacted] before this was stored`}
          >
            redacted×{snapshot.redactions}
          </span>
        )}

        {/* Actions stay hidden until the row is hovered or focused within, so a
            list of twenty drafts reads as twenty drafts and not sixty buttons. */}
        <span className="ml-auto flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onCopy(snapshot)}
            className={copied ? 'text-accent' : 'text-muted hover:text-text'}
          >
            {copied ? 'copied' : 'copy'}
          </button>
          <button
            type="button"
            onClick={() => onDelete(snapshot)}
            className="text-muted hover:text-alarm"
            aria-label="Delete this draft"
          >
            delete
          </button>
        </span>
      </div>

      {/* The draft itself, in serif: the user's own writing, set apart from the
          instrument around it. */}
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="mt-1 block w-full text-left font-serif text-[13px] leading-snug text-text"
      >
        {expanded ? (
          <span className="block max-h-56 overflow-y-auto whitespace-pre-wrap">
            {snapshot.text}
          </span>
        ) : (
          // No `block` alongside line-clamp: line-clamp sets its own display,
          // and a display utility next to it silently wins and un-clamps.
          <span className="line-clamp-3">{previewOf(snapshot.text)}</span>
        )}
      </button>
    </li>
  );
}

function Footer({
  confirming,
  disabled,
  onAsk,
  onCancel,
  onConfirm,
}: {
  confirming: boolean;
  disabled: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <footer className="border-t border-line px-3 py-2">
      {confirming ? (
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-text">Delete every draft? This cannot be undone.</span>
          <button
            type="button"
            onClick={onConfirm}
            className="ml-auto rounded-sm bg-alarm px-2 py-1 text-[11px] text-on-accent"
          >
            delete everything
          </button>
          <button type="button" onClick={onCancel} className="text-faint hover:text-text">
            cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-faint">nothing leaves this device</span>
          <button
            type="button"
            onClick={onAsk}
            disabled={disabled}
            className="ml-auto text-muted hover:text-alarm disabled:cursor-not-allowed disabled:text-faint disabled:hover:text-faint"
          >
            delete everything
          </button>
        </div>
      )}
    </footer>
  );
}
