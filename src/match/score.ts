import { looksGenerated, normalizePathname } from '../shared/identity';
import type { FieldSignals, Snapshot } from '../shared/types';

/**
 * "Is this the same field the user was typing in yesterday?"
 *
 * The hard part of the whole product. A single CSS selector cannot answer it:
 * sites built with React regenerate ids and class names between builds, and
 * restructure their markup between sprints. So instead of demanding an exact
 * match we score every stored fingerprint against the live field and take the
 * best one, if it is good enough.
 *
 * The guiding asymmetry:
 *
 *   A missed match costs an inline prompt. The draft is still in the popup,
 *   searchable by site and date. Annoying; recoverable.
 *
 *   A WRONG match offers someone the text from a different box — possibly a
 *   different conversation, possibly private. Restoring is a click, and the
 *   click comes before they have read what it is.
 *
 * So this leans towards refusing. Where a signal actively disagrees, that
 * counts against far harder than its absence counts for.
 *
 * DOM-free on purpose: this runs in the service worker, which has no document.
 */

/**
 * Weights, ordered by how well each signal survives a site redesign.
 *
 * Labels and names outlive layouts. A site can rewrite its markup completely
 * and still call the box "Cover letter", but any change at all to the
 * surrounding elements moves the DOM path. That is the whole reason domPath is
 * worth a third of what fieldName is worth, and never enough on its own.
 */
export const WEIGHTS = {
  fieldName: 30,
  labelText: 26,
  ariaLabel: 26,
  fieldId: 20,
  placeholder: 14,
  domPath: 12,
  editorKind: 10,
  tagName: 6,
  frameDepth: 4,
} as const;

/** Below this we show no inline prompt. The draft stays findable in the popup. */
export const MATCH_THRESHOLD = 0.6;

/**
 * Multiplier when the normalised paths differ — a "comment" box on the article
 * page and on the settings page are not the same field. Low enough that even a
 * perfect signal match cannot cross the threshold from the wrong page.
 */
const OFF_PAGE_FACTOR = 0.35;

/**
 * Ceiling when a human-meaningful identity signal actively contradicts.
 *
 * Two textareas named `coverLetter` and `clientQuestion` sit side by side on
 * the same page, in similar positions, with similar everything else. Without
 * this they would score well on shared signals alone. A name that disagrees is
 * not weak evidence — it is the strongest evidence available that these are
 * different boxes.
 */
const IDENTITY_CONFLICT_CAP = 0.2;

/**
 * Ceiling when nothing that actually identifies THIS field agrees.
 *
 * Without this the arithmetic has a floor problem. `tagName`, `editorKind` and
 * `frameDepth` match for practically any pair of text boxes on a site, so they
 * add the same amount to both sides of the ratio no matter how unrelated the
 * two fields are — two anonymous fields in completely different parts of a page
 * scored 0.625 on those alone.
 *
 * So a match has to rest on something that distinguishes this field from the
 * other fields around it: a name, a label, an aria-label, a trustworthy id, a
 * placeholder, or a DOM position that is recognisably the same. "It is a
 * textarea on this website" is not identification.
 */
const UNCORROBORATED_CAP = 0.3;

/** How alike two DOM paths must be before they count as identifying. */
const DOM_PATH_CORROBORATES_AT = 0.5;

export interface MatchResult {
  score: number;
  /** Human-readable, for the debug console and for tests to assert on. */
  reasons: string[];
}

/**
 * How alike two DOM paths are, compared from the field outwards.
 *
 * Outwards because the segments nearest the field are the meaningful ones: a
 * site wrapping the whole page in one more div shifts every path by a segment
 * at the far end, and should barely matter.
 */
export function domPathSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const left = a.split('>');
  const right = b.split('>');
  const shortest = Math.min(left.length, right.length);

  let matched = 0;
  for (let i = 1; i <= shortest; i++) {
    if (left[left.length - i] !== right[right.length - i]) break;
    matched++;
  }

  return matched / Math.max(left.length, right.length);
}

/** An id worth comparing: present, and not something a framework generated. */
function trustworthyId(signals: FieldSignals): string | undefined {
  const id = signals.fieldId;
  if (!id || looksGenerated(id)) return undefined;
  return id;
}

export function scoreFieldMatch(live: FieldSignals, stored: FieldSignals): MatchResult {
  const reasons: string[] = [];

  // Origin is a gate, not a weight. There is no such thing as a partial match
  // across two different sites, and offering one site's draft on another would
  // be both useless and alarming.
  if (live.origin !== stored.origin) {
    return { score: 0, reasons: ['different site'] };
  }

  let earned = 0;
  let possible = 0;
  let identityConflict = false;
  /** Did anything that actually identifies THIS field agree? */
  let corroborated = false;

  /**
   * Compare one signal.
   *
   * A signal only counts when BOTH sides have it. Absence is genuinely
   * uninformative — plenty of legitimate fields carry no aria-label — so
   * scoring it as a miss would punish sparse markup rather than wrong markup.
   *
   * The three classes are the point of this function:
   *
   *   identity   — names this particular field. Agreement identifies it;
   *                disagreement is strong evidence against.
   *   supporting — belongs to this field but is weaker, and a difference is
   *                not damning (a site can reword a placeholder).
   *   weak       — true of almost every text box on the site. Worth a little
   *                when it agrees, but can never establish identity on its
   *                own, and a difference means nothing.
   */
  const compare = (
    label: string,
    a: string | undefined,
    b: string | undefined,
    weight: number,
    klass: 'identity' | 'supporting' | 'weak',
  ): void => {
    if (!a || !b) return;
    possible += weight;
    if (a === b) {
      earned += weight;
      if (klass !== 'weak') corroborated = true;
      reasons.push(`${label} matches`);
      return;
    }
    reasons.push(`${label} differs (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
    if (klass === 'identity') identityConflict = true;
  };

  compare('fieldName', live.fieldName, stored.fieldName, WEIGHTS.fieldName, 'identity');
  compare('labelText', live.labelText, stored.labelText, WEIGHTS.labelText, 'identity');
  compare('ariaLabel', live.ariaLabel, stored.ariaLabel, WEIGHTS.ariaLabel, 'identity');
  compare('fieldId', trustworthyId(live), trustworthyId(stored), WEIGHTS.fieldId, 'identity');
  compare('placeholder', live.placeholder, stored.placeholder, WEIGHTS.placeholder, 'supporting');
  compare('editorKind', live.editorKind, stored.editorKind, WEIGHTS.editorKind, 'weak');
  compare('tagName', live.tagName, stored.tagName, WEIGHTS.tagName, 'weak');

  // Structural position: partial credit, because a path that agrees for the
  // last four segments and diverges above is still decent evidence.
  const structural = domPathSimilarity(live.domPath, stored.domPath);
  if (live.domPath && stored.domPath) {
    possible += WEIGHTS.domPath;
    earned += WEIGHTS.domPath * structural;
    if (structural >= DOM_PATH_CORROBORATES_AT) corroborated = true;
    reasons.push(`domPath ${Math.round(structural * 100)}% alike`);
  }

  // Top frame versus inside an iframe. Weak, but a real distinction.
  possible += WEIGHTS.frameDepth;
  if (live.isTopFrame === stored.isTopFrame) {
    earned += WEIGHTS.frameDepth;
  } else {
    reasons.push('one is in a frame and the other is not');
  }

  let score = possible === 0 ? 0 : earned / possible;

  if (identityConflict) {
    score = Math.min(score, IDENTITY_CONFLICT_CAP);
    reasons.push('capped: a name or label actively disagrees');
  } else if (!corroborated) {
    score = Math.min(score, UNCORROBORATED_CAP);
    reasons.push('capped: nothing identifies this as the same field');
  }

  const livePath = normalizePathname(live.pathname);
  const storedPath = normalizePathname(stored.pathname);
  if (livePath !== storedPath) {
    score *= OFF_PAGE_FACTOR;
    reasons.push(`different page (${storedPath} vs ${livePath})`);
  } else {
    reasons.push('same page');
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

export interface FieldCandidate {
  fieldKey: string;
  score: number;
  reasons: string[];
  /** Newest first. The spec's ten versions, so a deleted paragraph is reachable. */
  versions: Snapshot[];
  /** The one version worth offering first. See bestVersionToOffer. */
  offer: Snapshot;
}

/**
 * Which single version should the restore prompt offer?
 *
 * "The newest" is the obvious answer and it is wrong in the case that matters
 * most. Deleting a draft is not one event: someone backspacing through it,
 * pausing to think, produces a save at every pause, each shorter than the last.
 * The newest version is then the last fragment before the box went empty — so
 * offering "the newest" hands back seventeen characters of a draft that was
 * seventy-seven, and looks like the product simply failed.
 *
 * But "the longest" is wrong too. Someone who deliberately rewrote a long draft
 * into a tighter one wants the tighter one back, not last week's sprawl.
 *
 * The rule that separates those two: if the newest text appears INSIDE an older,
 * longer version, then the newest is a remnant of that version — what is left
 * after deleting from it — and the longer one is strictly more complete. If it
 * does not appear inside any of them, the newest is genuinely different work and
 * stands on its own.
 */
export function bestVersionToOffer(versions: readonly Snapshot[]): Snapshot | undefined {
  const newest = versions[0];
  if (!newest) return undefined;

  const remnant = newest.text.trim();
  if (!remnant) return newest;

  let best = newest;
  for (const candidate of versions) {
    if (candidate === newest) continue;
    if (candidate.text.length <= best.text.length) continue;
    if (candidate.text.includes(remnant)) best = candidate;
  }

  return best;
}

/**
 * Rank stored drafts against a live field, grouped by field.
 *
 * Grouped rather than flat because ten versions of the right field would
 * otherwise crowd out the second-best field entirely, and the restore UI needs
 * to offer "this box, earlier" as well as "some other box".
 */
export function rankFieldCandidates(
  live: FieldSignals,
  snapshots: readonly Snapshot[],
  limit = 5,
): FieldCandidate[] {
  const byField = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots) {
    const list = byField.get(snapshot.fieldKey);
    if (list) list.push(snapshot);
    else byField.set(snapshot.fieldKey, [snapshot]);
  }

  const candidates: FieldCandidate[] = [];
  for (const [fieldKey, versions] of byField) {
    versions.sort((a, b) => b.createdAt - a.createdAt);
    const newest = versions[0];
    if (!newest) continue;

    const { score, reasons } = scoreFieldMatch(live, newest.signals);
    if (score <= 0) continue;

    const offer = bestVersionToOffer(versions);
    if (!offer) continue;

    candidates.push({ fieldKey, score, reasons, versions, offer });
  }

  candidates.sort((a, b) => b.score - a.score || (b.versions[0]?.createdAt ?? 0) - (a.versions[0]?.createdAt ?? 0));
  return candidates.slice(0, limit);
}

/** The single best match, or null when nothing is convincing enough to offer. */
export function bestMatch(
  live: FieldSignals,
  snapshots: readonly Snapshot[],
  threshold = MATCH_THRESHOLD,
): FieldCandidate | null {
  const [top] = rankFieldCandidates(live, snapshots, 1);
  return top && top.score >= threshold ? top : null;
}
