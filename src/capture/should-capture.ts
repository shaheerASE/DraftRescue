import {
  CAPTURABLE_INPUT_TYPES,
  PAYMENT_FORM_PATTERN,
  PAYMENT_ORIGIN_SUFFIXES,
  SENSITIVE_AUTOCOMPLETE_EXACT,
  SENSITIVE_AUTOCOMPLETE_PREFIXES,
  SENSITIVE_SUBSTRINGS,
  SENSITIVE_TOKENS,
  SENSITIVE_TOKEN_SUFFIXES,
} from './patterns';

export type EditorKind = 'textarea' | 'input' | 'contenteditable';

export type RefusalReason =
  | 'disabled'
  | 'not-an-element'
  | 'not-editable'
  | 'input-type'
  | 'password'
  | 'was-password'
  | 'autocomplete'
  | 'identifier'
  | 'payment-form'
  | 'payment-origin'
  | 'blocked-origin'
  | 'incognito'
  | 'our-own-ui';

export type CaptureDecision =
  | { capture: true; kind: EditorKind }
  | { capture: false; reason: RefusalReason; detail?: string };

/**
 * Everything shouldCapture needs that does not live on the element.
 *
 * Passed in rather than read from globals so the whole gate is testable without
 * a browser, and so there is exactly one place that decides these values.
 */
export interface CaptureContext {
  /** Master switch — the user can pause capture entirely. */
  enabled: boolean;
  /** True when this frame is an incognito window. */
  incognito: boolean;
  /** Off by default. See the note on the incognito rule below. */
  captureInIncognito: boolean;
  /** Hostnames the user has blocked, exact or parent-domain match. */
  blockedOrigins: readonly string[];
  /** This frame's hostname — not the top page's. Matters inside iframes. */
  frameHostname: string;
  /**
   * Elements we have ever seen as `input[type="password"]`.
   *
   * Why this is needed: a "show password" toggle flips a real password field to
   * `type="text"`. At that instant every type-based rule stops firing and the
   * field looks like an ordinary text input. Remembering that we once saw it as
   * a password closes that window.
   *
   * A WeakSet so entries vanish with the elements — no leak on SPA navigation.
   */
  passwordMemory: WeakSet<Element>;
}

/** Lowercase, strip every separator: `api_key`, `api-key`, `apiKey` -> `apikey`. */
export function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Split an identifier into whole words, including across camelCase humps. */
export function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // cardNumber -> card Number
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // OTPCode   -> OTP Code
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2') // pin2      -> pin 2
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True if one identifier string looks sensitive.
 *
 * Note this is checked per source string (name, then id, then placeholder, ...)
 * and never on those strings joined together. Joining would invent matches that
 * are not in any single value: name="api" plus placeholder="Key here" would
 * normalise to "apikeyhere" and trip the `apikey` rule for a field that is
 * nothing of the sort.
 */
export function isSensitiveIdentifier(raw: string | null | undefined): boolean {
  if (!raw) return false;

  const normalized = normalizeIdentifier(raw);
  if (!normalized) return false;
  for (const needle of SENSITIVE_SUBSTRINGS) {
    if (normalized.includes(needle)) return true;
  }

  const tokens = tokenize(raw);
  for (const token of tokens) {
    if (SENSITIVE_TOKENS.includes(token)) return true;
    for (const suffix of SENSITIVE_TOKEN_SUFFIXES) {
      // `> suffix.length` and not `>=`: an exact match is SENSITIVE_TOKENS'
      // job, and requiring a real prefix keeps `pin` from matching itself here
      // twice while still catching `atmpin`.
      if (token.length > suffix.length && token.endsWith(suffix)) return true;
    }
  }

  return false;
}

/** `sub.example.com` is blocked by an entry of `example.com`; `notexample.com` is not. */
export function hostMatches(hostname: string, suffix: string): boolean {
  const host = hostname.toLowerCase();
  const needle = suffix.toLowerCase().replace(/^\*\./, '');
  return host === needle || host.endsWith('.' + needle);
}

function attr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

/** The label text associated with a field, via any of the ways sites express it. */
export function labelTextFor(el: Element): string | null {
  const parts: string[] = [];

  const labelledBy = attr(el, 'aria-labelledby');
  if (labelledBy) {
    const doc = el.ownerDocument;
    for (const id of labelledBy.split(/\s+/)) {
      const target = doc.getElementById(id);
      if (target?.textContent) parts.push(target.textContent);
    }
  }

  // `.labels` is the browser's own answer for form controls: it resolves both
  // <label for="..."> and a wrapping <label>, which we would otherwise have to
  // hunt for separately.
  const labels = (el as HTMLInputElement).labels;
  if (labels) {
    for (const label of Array.from(labels)) {
      if (label.textContent) parts.push(label.textContent);
    }
  } else {
    const wrapping = el.closest('label');
    if (wrapping?.textContent) parts.push(wrapping.textContent);
  }

  const joined = parts.join(' ').trim();
  return joined || null;
}

/**
 * All the human-readable strings attached to a field, each kept separate.
 *
 * `data-placeholder` is in here because Gmail, Slack and several other
 * contenteditable editors use it instead of a real placeholder attribute.
 */
export function identifierSources(el: Element): Array<string | null> {
  return [
    attr(el, 'name'),
    attr(el, 'id'),
    attr(el, 'placeholder'),
    attr(el, 'data-placeholder'),
    attr(el, 'aria-label'),
    attr(el, 'title'),
    attr(el, 'data-testid'),
    labelTextFor(el),
  ];
}

/** The kind of editor an element is, or null if it is not one we capture. */
export function editorKindOf(el: Element): EditorKind | null {
  const tag = el.tagName;

  if (tag === 'TEXTAREA') return 'textarea';

  if (tag === 'INPUT') {
    // A missing type attribute behaves as text, so normalise before checking.
    const type = (attr(el, 'type') ?? 'text').toLowerCase();
    return CAPTURABLE_INPUT_TYPES.includes(type) ? 'input' : null;
  }

  // `contenteditable` with no value is valid HTML and means true. Chrome also
  // supports `plaintext-only`, which several editors use.
  const editable = attr(el, 'contenteditable');
  if (editable !== null) {
    const value = editable.toLowerCase();
    if (value === '' || value === 'true' || value === 'plaintext-only') {
      return 'contenteditable';
    }
  }

  return null;
}

/**
 * THE GATE. Every field passes through here before anything is stored.
 *
 * Side effect, deliberately: when this sees an `input[type="password"]` it
 * records the element in `ctx.passwordMemory`. This is the only moment we
 * reliably observe that a field is a password field, so the observation has to
 * happen here — see the note on `passwordMemory` above.
 */
export function shouldCapture(el: Element | null, ctx: CaptureContext): CaptureDecision {
  if (!el || typeof el.tagName !== 'string') {
    return { capture: false, reason: 'not-an-element' };
  }

  // --- Rules that do not depend on the element -----------------------------
  // Checked first because they are cheap and they refuse the most.

  if (!ctx.enabled) {
    return { capture: false, reason: 'disabled' };
  }

  // Chrome does not run extensions in incognito unless the user ticks "Allow in
  // incognito" on chrome://extensions, which is off by default. This is our own
  // second refusal on top of that, so capturing in a private window takes two
  // separate deliberate acts by the user.
  if (ctx.incognito && !ctx.captureInIncognito) {
    return { capture: false, reason: 'incognito' };
  }

  for (const suffix of PAYMENT_ORIGIN_SUFFIXES) {
    if (hostMatches(ctx.frameHostname, suffix)) {
      return { capture: false, reason: 'payment-origin', detail: suffix };
    }
  }

  for (const blocked of ctx.blockedOrigins) {
    if (hostMatches(ctx.frameHostname, blocked)) {
      return { capture: false, reason: 'blocked-origin', detail: blocked };
    }
  }

  // Our own injected UI (the Phase 3 restore pill) must never capture itself.
  if (el.closest('[data-draft-rescue-ui]')) {
    return { capture: false, reason: 'our-own-ui' };
  }

  // --- Is it even a field we handle? ---------------------------------------

  if (el.tagName === 'INPUT') {
    const type = (attr(el, 'type') ?? 'text').toLowerCase();
    if (type === 'password') {
      ctx.passwordMemory.add(el);
      return { capture: false, reason: 'password' };
    }
  }

  if (ctx.passwordMemory.has(el)) {
    return { capture: false, reason: 'was-password' };
  }

  const kind = editorKindOf(el);
  if (kind === null) {
    return {
      capture: false,
      reason: el.tagName === 'INPUT' ? 'input-type' : 'not-editable',
    };
  }

  // --- Sensitivity rules ----------------------------------------------------

  // autocomplete is the strongest signal we get, because sites set it honestly:
  // it is what makes the browser's own password and card autofill work, so a
  // site that wants autofill has to declare what the field really is.
  const autocomplete = (attr(el, 'autocomplete') ?? '').toLowerCase().trim();
  if (autocomplete) {
    // The attribute can carry a section/token list, e.g. "section-a cc-number".
    for (const part of autocomplete.split(/\s+/)) {
      if (SENSITIVE_AUTOCOMPLETE_EXACT.includes(part)) {
        return { capture: false, reason: 'autocomplete', detail: part };
      }
      for (const prefix of SENSITIVE_AUTOCOMPLETE_PREFIXES) {
        if (part.startsWith(prefix)) {
          return { capture: false, reason: 'autocomplete', detail: part };
        }
      }
    }
  }

  for (const source of identifierSources(el)) {
    if (isSensitiveIdentifier(source)) {
      return { capture: false, reason: 'identifier', detail: source ?? undefined };
    }
  }

  // A field inside something that looks like a checkout form is refused whatever
  // it is called, because payment forms routinely name fields vaguely: `number`,
  // `code`, `name`.
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  if (form) {
    const action = attr(form, 'action') ?? '';
    const formId = attr(form, 'id') ?? '';
    const formName = attr(form, 'name') ?? '';
    if (
      PAYMENT_FORM_PATTERN.test(action) ||
      PAYMENT_FORM_PATTERN.test(formId) ||
      PAYMENT_FORM_PATTERN.test(formName)
    ) {
      return { capture: false, reason: 'payment-form' };
    }
  }

  return { capture: true, kind };
}
