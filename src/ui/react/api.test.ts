import { describe, expect, it } from 'vitest';
import type { FieldSignals, Snapshot } from '../../shared/types';
import { formatBytes, formatWhen, groupBySite, hostOf, previewOf } from './api';

function snapshot(over: Partial<Snapshot> & { origin?: string; pathname?: string } = {}): Snapshot {
  const signals: FieldSignals = {
    origin: over.origin ?? 'https://www.upwork.com',
    pathname: over.pathname ?? '/proposals/1',
    isTopFrame: true,
    tagName: 'TEXTAREA',
    editorKind: 'textarea',
    domPath: 'body>form>textarea',
  };
  return {
    id: 1,
    fieldKey: 'k',
    signals,
    text: 'a draft',
    createdAt: Date.now(),
    length: 7,
    bytes: 100,
    redactions: 0,
    ...over,
  };
}

describe('groupBySite', () => {
  it('groups by site, then by page', () => {
    const rows = [
      snapshot({ id: 1, origin: 'https://a.test', pathname: '/one' }),
      snapshot({ id: 2, origin: 'https://a.test', pathname: '/two' }),
      snapshot({ id: 3, origin: 'https://b.test', pathname: '/one' }),
    ];
    const groups = groupBySite(rows);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.origin === 'https://a.test')?.pages).toHaveLength(2);
  });

  it('counts every draft under its site', () => {
    const rows = [
      snapshot({ id: 1, origin: 'https://a.test', pathname: '/one' }),
      snapshot({ id: 2, origin: 'https://a.test', pathname: '/one' }),
      snapshot({ id: 3, origin: 'https://a.test', pathname: '/two' }),
    ];
    expect(groupBySite(rows)[0]?.count).toBe(3);
  });

  it('puts the site with the newest draft first', () => {
    const now = Date.now();
    const rows = [
      snapshot({ id: 1, origin: 'https://old.test', createdAt: now - 100_000 }),
      snapshot({ id: 2, origin: 'https://new.test', createdAt: now }),
    ];
    expect(groupBySite(rows).map((g) => g.origin)).toEqual([
      'https://new.test',
      'https://old.test',
    ]);
  });

  it('orders drafts within a page newest first', () => {
    const now = Date.now();
    const rows = [
      snapshot({ id: 1, createdAt: now - 5000, text: 'older' }),
      snapshot({ id: 2, createdAt: now, text: 'newer' }),
    ];
    expect(groupBySite(rows)[0]?.pages[0]?.snapshots.map((s) => s.text)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('handles an empty list', () => {
    expect(groupBySite([])).toEqual([]);
  });
});

describe('hostOf', () => {
  it.each([
    ['https://www.upwork.com', 'upwork.com'],
    ['https://mail.google.com', 'mail.google.com'],
    ['https://reddit.com', 'reddit.com'],
    ['http://localhost:3000', 'localhost'],
  ])('%s -> %s', (origin, expected) => {
    expect(hostOf(origin)).toBe(expected);
  });

  it('returns the input unchanged when it is not a URL', () => {
    expect(hostOf('not a url')).toBe('not a url');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2 KB'],
    [1024 * 1024, '1.0 MB'],
    [52_428_800, '50.0 MB'],
  ])('%d -> %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('previewOf', () => {
  it('collapses newlines so a preview stays on its lines', () => {
    expect(previewOf('line one\n\n\nline two')).toBe('line one line two');
  });

  it('truncates long text with an ellipsis', () => {
    const result = previewOf('x'.repeat(500), 100);
    expect(result).toHaveLength(101); // 100 plus the ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('leaves short text alone', () => {
    expect(previewOf('short')).toBe('short');
  });
});

describe('formatWhen', () => {
  it('shows only a time for today, and a date for anything older', () => {
    const now = Date.now();
    const today = formatWhen(now);
    const lastWeek = formatWhen(now - 7 * 24 * 60 * 60 * 1000);

    // An absolute timestamp, not "3d ago": someone hunting for the draft they
    // wrote before lunch needs the clock, not an interval.
    expect(today).toMatch(/\d/);
    expect(lastWeek.length).toBeGreaterThan(today.length);
  });
});
