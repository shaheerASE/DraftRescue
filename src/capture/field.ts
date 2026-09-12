import type { EditorKind, FieldSignals } from '../shared/types';
import { editorKindOf, labelTextFor } from './should-capture';

/**
 * Finds the real field behind an event.
 *
 * WHY composedPath AND NOT event.target
 * Plenty of modern sites put their inputs inside a Shadow DOM — a private DOM
 * tree attached to an element, which the page can style and script in isolation
 * from everything else. When an event crosses out of one, the browser retargets
 * it: `event.target` is reported as the *host* element, not the field the user
 * typed into. `composedPath()` gives the full list of nodes the event actually
 * travelled through, innermost first, so the real field is in there.
 *
 * This is most of why we work on sites the alternatives do not.
 *
 * WHY WALKING THE PATH BEATS TAKING [0]
 * For a contenteditable editor the innermost node is usually a text node or a
 * <span> the editor made — not the editable element. `contenteditable`
 * inherits, so those children are editable without carrying the attribute.
 * Walking outwards until we find the element that actually has the attribute
 * lands us on the editing host, which is the thing whose text we want.
 */
export function resolveField(path: readonly EventTarget[]): Element | null {
  for (const entry of path) {
    const el = entry as Element;
    if (!el || typeof el.tagName !== 'string') continue;
    if (editorKindOf(el) !== null) return el;
  }
  return null;
}

/** The current text of a field. */
export function readFieldText(el: Element, kind: EditorKind): string {
  if (kind === 'textarea' || kind === 'input') {
    return (el as HTMLTextAreaElement | HTMLInputElement).value ?? '';
  }

  // innerText, not textContent: textContent is cheaper but concatenates
  // everything into one line, and in a draft the line breaks are content. The
  // cost is that innerText forces a layout, which is why this only ever runs
  // behind the debounce and inside requestIdleCallback.
  const html = el as HTMLElement;
  return html.innerText ?? html.textContent ?? '';
}

/**
 * Whether an id looks machine-generated, and so worthless as identity.
 *
 * React's useId emits `:r1a:`, Radix emits `radix-:r3:`, MUI emits `mui-4821`,
 * CSS-in-JS emits hashes. All of them change between builds, and some change
 * between renders — keying a draft on one means losing the match on the site's
 * next deploy.
 */
export function looksGenerated(value: string): boolean {
  if (!value) return true;

  // React 18's useId format, which is deliberately not a valid CSS identifier.
  if (value.includes(':')) return true;

  if (/^(radix|mui|headlessui|react-aria|chakra|mantine|ember|ext-gen|yui)[-_]/i.test(value)) {
    return true;
  }

  // uuid
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value)) {
    return true;
  }

  // A run of hex long enough to be a hash rather than a word.
  if (/[0-9a-f]{8,}/i.test(value)) return true;

  // The spec's shape: an optional word, then a long hex-ish tail.
  if (/^[a-z]*[-_]?[0-9a-f]{6,}$/i.test(value)) return true;

  // nanoid and cuid style: long, no word structure, mixed alphabet.
  if (
    /^[A-Za-z0-9_-]{16,}$/.test(value) &&
    /\d/.test(value) &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value)
  ) {
    return true;
  }

  // Four or more digits anywhere is a counter, an index or a timestamp — not
  // something a person typed as a name. Catches `input-48213`, `field_20240315`.
  if ((value.match(/\d/g) ?? []).length >= 4) return true;

  return false;
}

/**
 * Collapses the volatile parts of a URL path.
 *
 * `/proposals/12345` and `/proposals/67890` are different pages but the same
 * *kind* of page with the same fields. Keying on the raw path would mean a user
 * who reloads a proposal under a new id loses the match. The raw path is stored
 * alongside, so nothing is thrown away.
 */
export function normalizePathname(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return ':uuid';
      if (/^[0-9a-f]{12,}$/i.test(segment)) return ':hash';
      if (/\d{4,}/.test(segment)) return ':id';
      return segment;
    })
    .join('/');
}

/**
 * A structural address for an element, used when nothing else identifies it.
 *
 * Crosses out of shadow roots via `.host`, because otherwise the path for a
 * field inside a web component would be a couple of meaningless segments.
 * Depth-capped: deep paths are both long to store and the first thing to break
 * when a site changes its layout.
 */
export function domPath(el: Element, maxDepth = 12): string {
  const parts: string[] = [];
  let node: Element | null = el;

  for (let depth = 0; node && depth < maxDepth; depth++) {
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;

    if (!parent) {
      parts.unshift(tag);
      const root = node.getRootNode();
      const host = (root as ShadowRoot).host as Element | undefined;
      if (!host) break;
      node = host;
      continue;
    }

    let index = 1;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node) break;
      if (sibling.tagName === node.tagName) index++;
    }
    parts.unshift(`${tag}:nth-of-type(${index})`);
    node = parent;
  }

  return parts.join('>');
}

function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

/** Everything we know about a field's identity, read off the live element. */
export function buildSignals(el: Element, kind: EditorKind): FieldSignals {
  const isTopFrame = window.top === window.self;

  const signals: FieldSignals = {
    origin: location.origin,
    pathname: location.pathname,
    isTopFrame,
    tagName: el.tagName,
    editorKind: kind,
    domPath: domPath(el),
  };

  if (!isTopFrame) signals.frameUrl = location.href;

  const inputType = el.getAttribute('type');
  if (kind === 'input' && inputType) signals.inputType = inputType.toLowerCase();

  const id = text(el.getAttribute('id'));
  if (id) signals.fieldId = id;

  const name = text(el.getAttribute('name'));
  if (name) signals.fieldName = name;

  const aria = text(el.getAttribute('aria-label') ?? el.getAttribute('aria-placeholder'));
  if (aria) signals.ariaLabel = aria;

  const placeholder = text(
    el.getAttribute('placeholder') ?? el.getAttribute('data-placeholder'),
  );
  if (placeholder) signals.placeholder = placeholder;

  const label = text(labelTextFor(el));
  if (label) signals.labelText = label;

  return signals;
}

/** FNV-1a, 32 bits. Small and fast; we are grouping rows, not signing them. */
function fnv1a(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Two independent hashes concatenated, to make accidental collisions unlikely. */
function hash(input: string): string {
  return (
    fnv1a(input, 0x811c9dc5).toString(36) + fnv1a(input, 0x7fffffff).toString(36)
  );
}

/** Separator that cannot appear in any of the parts it joins. */
const SEP = String.fromCharCode(0);

/**
 * The key that groups versions of one field together.
 *
 * Two strategies, because one does not fit both cases:
 *
 *   A field with a human-meaningful name, label or aria-label gets keyed on
 *   that. Labels outlive layouts — a site can restructure its markup every
 *   sprint and still call the box "Cover letter".
 *
 *   A field with nothing but generated ids falls back to its position in the
 *   DOM. Brittle, but it is all there is, and the alternative is every
 *   anonymous textarea on a page sharing one key and overwriting each other.
 *
 * When the key does change, drafts are not lost: the rows are still there,
 * still searchable in the popup, and Phase 2's scorer matches on the stored
 * signals rather than on this key.
 */
export function fieldKeyFor(signals: FieldSignals): string {
  const stable = [
    signals.fieldName,
    signals.ariaLabel,
    signals.labelText,
    signals.placeholder,
    signals.fieldId && !looksGenerated(signals.fieldId) ? signals.fieldId : undefined,
  ].filter(Boolean);

  const identity = stable.length > 0 ? stable.join('|') : `dom:${signals.domPath}`;

  return hash(
    [
      signals.origin,
      normalizePathname(signals.pathname),
      signals.tagName,
      signals.editorKind,
      identity,
    ].join(SEP),
  );
}
