import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import type { CapturePayload, FieldSignals } from '../shared/types';
import { closeDb, DB_NAME, resetDbConnectionForTests } from './db';
import {
  deleteAll,
  evictOldest,
  getStats,
  purgeExpired,
  recentSnapshots,
  versionsOfField,
  writeSnapshot,
} from './snapshots';

const DAY = 24 * 60 * 60 * 1000;

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function signals(overrides: Partial<FieldSignals> = {}): FieldSignals {
  return {
    origin: 'https://www.upwork.com',
    pathname: '/proposals/12345',
    isTopFrame: true,
    tagName: 'TEXTAREA',
    editorKind: 'textarea',
    domPath: 'body>form>textarea',
    fieldName: 'coverLetter',
    ...overrides,
  };
}

function payload(overrides: Partial<CapturePayload> = {}): CapturePayload {
  return {
    fieldKey: 'field-a',
    signals: signals(),
    text: 'This is a draft long enough to be worth storing.',
    capturedAt: Date.now(),
    redactions: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  resetDbConnectionForTests();
});

describe('writeSnapshot — what gets stored', () => {
  it('stores a draft and counts it', async () => {
    const result = await writeSnapshot(payload(), settings());
    expect(result).toMatchObject({ stored: true });

    const stats = await getStats();
    expect(stats.snapshots).toBe(1);
    expect(stats.fields).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('refuses text shorter than the minimum', async () => {
    const result = await writeSnapshot(payload({ text: 'too short' }), settings());
    expect(result).toEqual({ stored: false, reason: 'too-short' });
    expect((await getStats()).snapshots).toBe(0);
  });

  it('refuses whitespace-only text', async () => {
    const result = await writeSnapshot(payload({ text: '            \n\n   ' }), settings());
    expect(result).toEqual({ stored: false, reason: 'empty' });
  });

  it('skips a write when the text has not changed', async () => {
    await writeSnapshot(payload(), settings());
    const second = await writeSnapshot(payload({ capturedAt: Date.now() + 1000 }), settings());

    expect(second).toEqual({ stored: false, reason: 'unchanged' });
    expect((await getStats()).snapshots).toBe(1);
  });

  it('stores a new version when the text does change', async () => {
    await writeSnapshot(payload({ text: 'first version of the cover letter' }), settings());
    await writeSnapshot(
      payload({ text: 'second version of the cover letter', capturedAt: Date.now() + 1000 }),
      settings(),
    );
    expect((await getStats()).snapshots).toBe(2);
  });

  it('keeps the html when one is supplied', async () => {
    await writeSnapshot(payload({ html: '<b>bold</b> draft text here now' }), settings());
    const [row] = await versionsOfField('field-a');
    expect(row?.html).toBe('<b>bold</b> draft text here now');
  });

  it('records how many redactions ran', async () => {
    await writeSnapshot(payload({ redactions: 2 }), settings());
    const [row] = await versionsOfField('field-a');
    expect(row?.redactions).toBe(2);
  });
});

describe('writeSnapshot — version history', () => {
  it('keeps the newest N versions and drops the oldest', async () => {
    const base = Date.now();
    for (let i = 0; i < 15; i++) {
      await writeSnapshot(
        payload({ text: `version number ${i} of this draft`, capturedAt: base + i * 1000 }),
        settings({ versionsPerField: 10 }),
      );
    }

    const versions = await versionsOfField('field-a', 50);
    expect(versions).toHaveLength(10);
    // Newest first, and the five oldest are gone.
    expect(versions[0]?.text).toBe('version number 14 of this draft');
    expect(versions[9]?.text).toBe('version number 5 of this draft');
    expect((await getStats()).snapshots).toBe(10);
  });

  it('keeps a deleted paragraph recoverable from an older version', async () => {
    // The whole reason for versions rather than one latest row.
    const base = Date.now();
    await writeSnapshot(
      payload({ text: 'Intro paragraph. The paragraph they will delete. Outro.', capturedAt: base }),
      settings(),
    );
    await writeSnapshot(
      payload({ text: 'Intro paragraph. Outro.', capturedAt: base + 1000 }),
      settings(),
    );

    const versions = await versionsOfField('field-a');
    expect(versions[0]?.text).not.toContain('they will delete');
    expect(versions[1]?.text).toContain('they will delete');
  });

  it('never evicts the most complete version, however much is deleted', async () => {
    // The bug this exists for: deleting a draft is not one event. Someone
    // backspacing through it, pausing to think, saves a shorter version at
    // every pause. Under a plain "keep newest 10", ten pauses filled all ten
    // slots with fragments and evicted the complete draft as the oldest — so
    // the one action that loses a person's writing was also what destroyed our
    // copy of it.
    const base = Date.now();
    const full = 'This is my actual long draft that took me ages to write and must not be lost.';

    await writeSnapshot(payload({ text: full, capturedAt: base }), settings());

    // Now delete it, a chunk at a time, with a save at every pause.
    for (let i = 1; i <= 20; i++) {
      const shorter = full.slice(0, Math.max(16, full.length - i * 3));
      await writeSnapshot(
        payload({ text: shorter, capturedAt: base + i * 1000 }),
        settings({ versionsPerField: 10 }),
      );
    }

    const versions = await versionsOfField('field-a', 50);
    expect(versions).toHaveLength(10);
    expect(versions.some((v) => v.text === full)).toBe(true);
  });

  it('still drops ordinary old versions when nothing is being deleted', async () => {
    // The protection is for the high-water mark only; growing drafts should
    // still roll over normally.
    const base = Date.now();
    for (let i = 0; i < 15; i++) {
      await writeSnapshot(
        payload({ text: `version ${i} `.padEnd(20 + i, 'x'), capturedAt: base + i * 1000 }),
        settings({ versionsPerField: 10 }),
      );
    }
    const versions = await versionsOfField('field-a', 50);
    expect(versions).toHaveLength(10);
    // The newest is always kept.
    expect(versions[0]?.text).toContain('version 14');
  });

  it('counts versions per field, not globally', async () => {
    const base = Date.now();
    for (let i = 0; i < 12; i++) {
      await writeSnapshot(
        payload({ fieldKey: 'field-a', text: `a draft text number ${i}`, capturedAt: base + i }),
        settings({ versionsPerField: 5 }),
      );
      await writeSnapshot(
        payload({ fieldKey: 'field-b', text: `b draft text number ${i}`, capturedAt: base + i }),
        settings({ versionsPerField: 5 }),
      );
    }

    expect(await versionsOfField('field-a', 50)).toHaveLength(5);
    expect(await versionsOfField('field-b', 50)).toHaveLength(5);
    expect((await getStats()).fields).toBe(2);
  });
});

describe('purgeExpired', () => {
  it('deletes rows past the retention window and keeps the rest', async () => {
    const now = Date.now();
    await writeSnapshot(
      payload({ fieldKey: 'old', text: 'an old draft that should go', capturedAt: now - 10 * DAY }),
      settings(),
    );
    await writeSnapshot(
      payload({ fieldKey: 'new', text: 'a recent draft that should stay', capturedAt: now - 1 * DAY }),
      settings(),
    );

    const removed = await purgeExpired(settings({ retentionDays: 7 }), now);

    expect(removed).toBe(1);
    expect(await versionsOfField('old')).toHaveLength(0);
    expect(await versionsOfField('new')).toHaveLength(1);
    expect((await getStats()).snapshots).toBe(1);
  });

  it('keeps everything when retention is set to forever', async () => {
    const now = Date.now();
    await writeSnapshot(
      payload({ text: 'a very old draft indeed here', capturedAt: now - 400 * DAY }),
      settings(),
    );
    expect(await purgeExpired(settings({ retentionDays: 0 }), now)).toBe(0);
    expect((await getStats()).snapshots).toBe(1);
  });

  it('leaves the byte total consistent with what remains', async () => {
    const now = Date.now();
    await writeSnapshot(
      payload({ fieldKey: 'old', text: 'old draft text goes here now', capturedAt: now - 30 * DAY }),
      settings(),
    );
    await writeSnapshot(
      payload({ fieldKey: 'new', text: 'new draft text goes here now', capturedAt: now }),
      settings(),
    );

    await purgeExpired(settings({ retentionDays: 7 }), now);

    const stats = await getStats();
    const remaining = await recentSnapshots(100);
    const actualBytes = remaining.reduce((sum, row) => sum + row.bytes, 0);
    expect(stats.bytes).toBe(actualBytes);
  });
});

describe('evictOldest', () => {
  it('deletes oldest first until back under the cap', async () => {
    const base = Date.now();
    for (let i = 0; i < 6; i++) {
      await writeSnapshot(
        payload({ fieldKey: `f${i}`, text: `draft number ${i} with enough text`, capturedAt: base + i * 1000 }),
        settings(),
      );
    }

    const before = await getStats();
    const target = Math.floor(before.bytes / 2);
    const removed = await evictOldest(target);

    expect(removed).toBeGreaterThan(0);
    const after = await getStats();
    expect(after.bytes).toBeLessThanOrEqual(target);

    // The survivors are the newest ones.
    const left = await recentSnapshots(100);
    expect(left.every((row) => row.createdAt > base)).toBe(true);
  });

  it('is triggered automatically by a write that breaches the cap', async () => {
    const base = Date.now();
    const tiny = settings({ maxBytes: 900, versionsPerField: 100 });

    for (let i = 0; i < 8; i++) {
      await writeSnapshot(
        payload({ fieldKey: `f${i}`, text: `draft number ${i} with enough text`, capturedAt: base + i * 1000 }),
        tiny,
      );
    }

    expect((await getStats()).bytes).toBeLessThanOrEqual(tiny.maxBytes);
  });
});

describe('deleteAll', () => {
  it('empties the store and resets the counters', async () => {
    await writeSnapshot(payload(), settings());
    await writeSnapshot(
      payload({ fieldKey: 'other', text: 'another draft worth keeping' }),
      settings(),
    );

    await deleteAll();

    expect(await getStats()).toEqual({ snapshots: 0, bytes: 0, fields: 0 });
    expect(await recentSnapshots(10)).toHaveLength(0);
  });
});

describe('recentSnapshots', () => {
  it('returns newest first across every field', async () => {
    const base = Date.now();
    await writeSnapshot(payload({ fieldKey: 'a', text: 'draft a text is here', capturedAt: base }), settings());
    await writeSnapshot(payload({ fieldKey: 'b', text: 'draft b text is here', capturedAt: base + 1000 }), settings());
    await writeSnapshot(payload({ fieldKey: 'c', text: 'draft c text is here', capturedAt: base + 2000 }), settings());

    const rows = await recentSnapshots(10);
    expect(rows.map((r) => r.fieldKey)).toEqual(['c', 'b', 'a']);
  });

  it('respects the limit', async () => {
    const base = Date.now();
    for (let i = 0; i < 10; i++) {
      await writeSnapshot(
        payload({ fieldKey: `f${i}`, text: `draft number ${i} with enough text`, capturedAt: base + i }),
        settings(),
      );
    }
    expect(await recentSnapshots(3)).toHaveLength(3);
  });
});
