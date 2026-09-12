import { describe, expect, it } from 'vitest';
import type { FieldSignals, Snapshot } from '../shared/types';
import {
  bestMatch,
  bestVersionToOffer,
  domPathSimilarity,
  MATCH_THRESHOLD,
  rankFieldCandidates,
  scoreFieldMatch,
} from './score';

function signals(overrides: Partial<FieldSignals> = {}): FieldSignals {
  return {
    origin: 'https://www.upwork.com',
    pathname: '/proposals/12345',
    isTopFrame: true,
    tagName: 'TEXTAREA',
    editorKind: 'textarea',
    domPath: 'body:nth-of-type(1)>main:nth-of-type(1)>form:nth-of-type(1)>textarea:nth-of-type(1)',
    fieldName: 'coverLetter',
    labelText: 'Cover letter',
    ...overrides,
  };
}

let nextId = 1;
function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  const sig = over.signals ?? signals();
  return {
    id: nextId++,
    fieldKey: 'field-a',
    signals: sig,
    text: 'a draft long enough to be worth keeping',
    createdAt: Date.now(),
    length: 39,
    bytes: 512,
    redactions: 0,
    ...over,
  };
}

describe('domPathSimilarity', () => {
  it('is 1 for identical paths and 0 when either is empty', () => {
    expect(domPathSimilarity('body>div>textarea', 'body>div>textarea')).toBe(1);
    expect(domPathSimilarity('', 'body>div')).toBe(0);
  });

  it('gives partial credit for a shared tail', () => {
    // The site wrapped the page in one more div. Everything near the field is
    // unchanged, so this should stay high.
    const before = 'body>main>form>textarea:nth-of-type(1)';
    const after = 'body>div>main>form>textarea:nth-of-type(1)';
    expect(domPathSimilarity(before, after)).toBeGreaterThan(0.5);
  });

  it('scores near zero when the field itself sits somewhere else', () => {
    expect(
      domPathSimilarity('body>main>form>textarea:nth-of-type(1)', 'body>aside>div>input:nth-of-type(3)'),
    ).toBe(0);
  });
});

describe('scoreFieldMatch — the same field', () => {
  it('scores an identical fingerprint at 1', () => {
    expect(scoreFieldMatch(signals(), signals()).score).toBe(1);
  });

  it('still matches after the site restructures its markup', () => {
    // Same box, same label, new DOM path. The case a CSS selector cannot survive.
    const result = scoreFieldMatch(
      signals(),
      signals({ domPath: 'body:nth-of-type(1)>div:nth-of-type(4)>section>textarea:nth-of-type(1)' }),
    );
    expect(result.score).toBeGreaterThan(MATCH_THRESHOLD);
  });

  it('still matches when the page id in the URL changes', () => {
    const result = scoreFieldMatch(signals(), signals({ pathname: '/proposals/98765' }));
    expect(result.score).toBeGreaterThan(MATCH_THRESHOLD);
    expect(result.reasons).toContain('same page');
  });

  it('still matches when a generated id changes between builds', () => {
    const result = scoreFieldMatch(
      signals({ fieldId: ':r1a:' }),
      signals({ fieldId: ':r9z:' }),
    );
    expect(result.score).toBeGreaterThan(MATCH_THRESHOLD);
  });

  it('still matches when the site adds an aria-label it did not have before', () => {
    const result = scoreFieldMatch(
      signals({ ariaLabel: 'Cover letter' }),
      signals({ ariaLabel: undefined }),
    );
    expect(result.score).toBeGreaterThan(MATCH_THRESHOLD);
  });
});

describe('scoreFieldMatch — a different field', () => {
  it('refuses to match across sites', () => {
    const result = scoreFieldMatch(signals(), signals({ origin: 'https://www.fiverr.com' }));
    expect(result.score).toBe(0);
    expect(result.reasons).toContain('different site');
  });

  it('refuses two boxes on the same page with different names', () => {
    // Side by side, same tag, similar position. Only the name disagrees — and
    // that is the strongest evidence there is.
    const result = scoreFieldMatch(
      signals({ fieldName: 'coverLetter', labelText: 'Cover letter' }),
      signals({ fieldName: 'clientQuestion', labelText: 'Question for the client' }),
    );
    expect(result.score).toBeLessThan(MATCH_THRESHOLD);
    expect(result.reasons.some((r) => r.startsWith('fieldName differs'))).toBe(true);
  });

  it('will not offer a draft from a different page of the same site', () => {
    const result = scoreFieldMatch(
      signals({ pathname: '/proposals/12345' }),
      signals({ pathname: '/messages/inbox' }),
    );
    expect(result.score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('will not cross the threshold from another page even on a perfect signal match', () => {
    // A "comment" box exists on every article. Identical fingerprints, wrong
    // page — this must stay below the line.
    const result = scoreFieldMatch(
      signals({ pathname: '/article/one' }),
      signals({ pathname: '/article/two-hundred' }),
    );
    expect(result.score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('does not match two anonymous fields sitting in different places', () => {
    const anonymous = {
      fieldName: undefined,
      labelText: undefined,
      ariaLabel: undefined,
      fieldId: undefined,
    };
    const result = scoreFieldMatch(
      signals({ ...anonymous, domPath: 'body>form>textarea:nth-of-type(1)' }),
      signals({ ...anonymous, domPath: 'body>aside>div>input:nth-of-type(2)' }),
    );
    expect(result.score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('matches two anonymous fields in the same place', () => {
    const anonymous = {
      fieldName: undefined,
      labelText: undefined,
      ariaLabel: undefined,
      fieldId: undefined,
    };
    const result = scoreFieldMatch(signals(anonymous), signals(anonymous));
    expect(result.score).toBeGreaterThan(MATCH_THRESHOLD);
  });

  it('reports why, not just how much', () => {
    const result = scoreFieldMatch(signals(), signals({ fieldName: 'other' }));
    expect(result.reasons.join(' ')).toContain('capped');
  });
});

describe('rankFieldCandidates', () => {
  it('groups versions under one field and keeps them newest first', () => {
    const base = Date.now();
    const rows = [
      snapshot({ fieldKey: 'a', createdAt: base, text: 'oldest version of this' }),
      snapshot({ fieldKey: 'a', createdAt: base + 2000, text: 'newest version of this' }),
      snapshot({ fieldKey: 'a', createdAt: base + 1000, text: 'middle version of this' }),
    ];

    const [candidate] = rankFieldCandidates(signals(), rows);
    expect(candidate?.versions.map((v) => v.text)).toEqual([
      'newest version of this',
      'middle version of this',
      'oldest version of this',
    ]);
  });

  it('ranks the better match first', () => {
    const rows = [
      snapshot({ fieldKey: 'wrong', signals: signals({ pathname: '/somewhere/else' }) }),
      snapshot({ fieldKey: 'right', signals: signals() }),
    ];
    const ranked = rankFieldCandidates(signals(), rows);
    expect(ranked[0]?.fieldKey).toBe('right');
  });

  it('drops anything from another site entirely', () => {
    const rows = [snapshot({ signals: signals({ origin: 'https://elsewhere.test' }) })];
    expect(rankFieldCandidates(signals(), rows)).toHaveLength(0);
  });

  it('respects the limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      snapshot({ fieldKey: `f${i}`, signals: signals({ fieldName: `field${i}` }) }),
    );
    expect(rankFieldCandidates(signals(), rows, 3)).toHaveLength(3);
  });
});

describe('bestVersionToOffer', () => {
  const base = Date.now();

  it('offers the complete draft, not the fragment left behind while deleting', () => {
    // The reported bug: type a long draft, backspace most of it away, come
    // back, and the prompt handed over seventeen characters of seventy-seven.
    const full = 'This is my actual long draft that took me ages to write.';
    const versions = [
      snapshot({ text: 'This is my actual', createdAt: base + 5000 }),
      snapshot({ text: 'This is my actual long draft', createdAt: base + 3000 }),
      snapshot({ text: full, createdAt: base }),
    ];
    expect(bestVersionToOffer(versions)?.text).toBe(full);
  });

  it('offers the newest when it is genuinely different work', () => {
    // Someone who rewrote a sprawling draft into a tighter one wants the
    // tighter one back, not last week's sprawl.
    const rewrite = 'A completely different and much tighter draft.';
    const versions = [
      snapshot({ text: rewrite, createdAt: base + 5000 }),
      snapshot({
        text: 'An older, longer draft about something else entirely, at length.',
        createdAt: base,
      }),
    ];
    expect(bestVersionToOffer(versions)?.text).toBe(rewrite);
  });

  it('offers the only version when there is just one', () => {
    const only = snapshot({ text: 'the one and only draft here' });
    expect(bestVersionToOffer([only])).toBe(only);
  });

  it('returns undefined for an empty history', () => {
    expect(bestVersionToOffer([])).toBeUndefined();
  });

  it('handles a remnant that sits in the middle of the fuller version', () => {
    // Deleting from both ends, not just the tail.
    const full = 'Opening line. The middle part that survived. Closing line.';
    const versions = [
      snapshot({ text: 'The middle part that survived.', createdAt: base + 1000 }),
      snapshot({ text: full, createdAt: base }),
    ];
    expect(bestVersionToOffer(versions)?.text).toBe(full);
  });
});

describe('rankFieldCandidates — what it offers', () => {
  it('attaches the version worth offering, not simply the newest', () => {
    const base = Date.now();
    const full = 'The complete draft that the user actually wrote out in full.';
    const rows = [
      snapshot({ fieldKey: 'a', text: full, createdAt: base }),
      snapshot({ fieldKey: 'a', text: 'The complete draft', createdAt: base + 2000 }),
    ];
    const [candidate] = rankFieldCandidates(signals(), rows);
    expect(candidate?.versions[0]?.text).toBe('The complete draft'); // newest
    expect(candidate?.offer.text).toBe(full); // but this is what to hand back
  });
});

describe('bestMatch', () => {
  it('returns the field when it is convincing', () => {
    const rows = [snapshot({ fieldKey: 'a', signals: signals() })];
    expect(bestMatch(signals(), rows)?.fieldKey).toBe('a');
  });

  it('returns null rather than offering a doubtful match', () => {
    // Never lose data because we could not match a field — but never offer the
    // wrong draft either. Below the line means no prompt, not no record.
    const rows = [snapshot({ signals: signals({ fieldName: 'somethingElse' }) })];
    expect(bestMatch(signals(), rows)).toBeNull();
  });

  it('returns null when there is nothing stored', () => {
    expect(bestMatch(signals(), [])).toBeNull();
  });
});
