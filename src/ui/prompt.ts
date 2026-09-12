/**
 * The inline restore prompt: a small pill offering a draft back.
 *
 * WHY A SHADOW DOM
 * This element lives inside someone else's page, so two things have to be true
 * at once: their CSS must not be able to break our pill, and our CSS must not
 * be able to break their page. A shadow root gives both — style rules do not
 * cross the boundary in either direction. Without it, a single `button { ... }`
 * rule on the host page could make our prompt unreadable, or worse, our styles
 * could leak out and change their buttons.
 *
 * WHY `open`, AND WHAT THAT COSTS
 * The isolation above comes from the shadow boundary itself and is identical in
 * both modes. `open` differs in one way that matters: the page's own scripts
 * can reach `host.shadowRoot` and read or poke at what is inside. We keep it
 * because the browser test suite drives the pill through that boundary, and
 * because `closed` is not the wall it looks like either — but we do not rely on
 * it for anything, and nothing below assumes the page cannot see in.
 *
 * Two consequences are handled explicitly, because a hostile script on the page
 * (an XSS, an ad tag, a compromised dependency) is a real thing and drafts are
 * the one asset this extension holds:
 *
 *   1. Nothing may activate the restore except a person. A page calling
 *      `pill.click()` would otherwise pull a draft the user never asked for
 *      back into a field the page can read. Every activation is checked for
 *      `isTrusted`, which only the browser can set.
 *   2. The draft's text is never left sitting in the DOM. The preview tooltip
 *      exists only while a real pointer is over the pill; before that there is
 *      nothing in the shadow tree but the word "Restore" and an age.
 *
 * What a page can still learn is that a draft exists for the focused field and
 * roughly how old it is. That is the price of showing an offer at all.
 */

import { relativeTime } from '../shared/time';

/** Marks our own UI, so the capture gate never treats it as a page field. */
export const UI_MARKER = 'data-draft-rescue-ui';

/** Breathing room between the pill and the field's edge. */
const GAP = 6;

const STYLES = `
:host {
  all: initial;
}

.pill {
  position: fixed;
  top: 0;
  left: 0;
  /* Out of the way until the first measurement lands, so it never flashes in
     the top-left corner before it is positioned. */
  transform: translate(-9999px, -9999px);

  z-index: 2147483647;

  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 5px 10px;
  border: 0;
  border-radius: 999px;

  background: #1f2333;
  color: #ffffff;
  box-shadow:
    0 2px 10px rgba(0, 0, 0, 0.3),
    inset 0 0 0 1px rgba(255, 255, 255, 0.09);

  /* Every property stated outright: font and colour INHERIT through a shadow
     boundary even though selectors do not, so leaving these unset would let the
     host page's body styles reach in. */
  font: 500 12px/1.25 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", sans-serif;
  letter-spacing: 0;
  text-transform: none;
  white-space: nowrap;
  -webkit-font-smoothing: antialiased;

  cursor: pointer;

  /* Hidden means genuinely gone, not merely transparent.
     An opacity-0 element still has a box and still swallows clicks, so fading
     alone would leave an invisible button intercepting taps on whatever is
     underneath it. visibility and pointer-events make it inert; the delayed
     visibility transition lets the fade-out finish before it vanishes. */
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 140ms ease,
    background-color 140ms ease,
    visibility 0s linear 140ms;
}

.pill[data-visible="true"] {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition:
    opacity 140ms ease,
    background-color 140ms ease,
    visibility 0s linear 0s;
}

.pill:hover {
  background: #2b3048;
}

.pill:active {
  background: #171a28;
}

.pill:focus-visible {
  outline: 2px solid #7c8cff;
  outline-offset: 2px;
}

.icon {
  font-size: 13px;
  line-height: 1;
}

@media (prefers-reduced-motion: reduce) {
  .pill {
    transition: none;
  }
}
`;

export interface RestorePrompt {
  /** Offer a draft for `field`. Replaces any prompt already showing. */
  show(field: Element, savedAt: number, text: string, onActivate: () => void): void;
  hide(): void;
  /** Tear down entirely. */
  destroy(): void;
  /** The field currently being offered for, or null. */
  anchor(): Element | null;
  /** Test seam: the shadow root, reachable precisely because it is `open`. */
  shadowRoot(): ShadowRoot | null;
}

export function createRestorePrompt(doc: Document = document): RestorePrompt {
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let pill: HTMLButtonElement | null = null;
  let label: HTMLElement | null = null;

  let field: Element | null = null;
  let activate: (() => void) | null = null;
  /**
   * The tooltip text, kept here in the isolated world rather than on the
   * element. See point 2 in the note at the top of this file: an attribute is
   * readable by the page the instant it is set, and the pill is shown without
   * the user having done anything but focus a field.
   */
  let preview = '';
  let observer: ResizeObserver | null = null;
  let frame = 0;

  function build(): void {
    if (host) return;

    host = doc.createElement('div');
    host.setAttribute(UI_MARKER, '');
    // Inline and important, because the host element itself is NOT protected by
    // the shadow boundary — page rules can still match it. Everything inside is.
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('position', 'static', 'important');

    root = host.attachShadow({ mode: 'open' });

    const style = doc.createElement('style');
    style.textContent = STYLES;

    pill = doc.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';

    const icon = doc.createElement('span');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '↺';

    label = doc.createElement('span');
    label.className = 'label';

    pill.append(icon, label);
    root.append(style, pill);

    // Clicking a button normally moves focus to it, which would blur the field
    // we are about to write into — and for a rich editor, losing the selection
    // means execCommand has nowhere to insert. Cancelling mousedown's default
    // keeps focus exactly where it is.
    pill.addEventListener('mousedown', (event) => event.preventDefault());

    pill.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // `isTrusted` is set by the browser and cannot be forged from script, so
      // this is what separates a person clicking from the page calling
      // `.click()` on a button it found through the open shadow root. A real
      // click and a keyboard Enter or Space on the focused pill are both
      // trusted; everything a script can produce is not.
      if (!event.isTrusted) return;
      const run = activate;
      hide();
      run?.();
    });

    // The preview appears only under a real pointer. `focus` is deliberately
    // not a trigger: `element.focus()` from page script produces a *trusted*
    // focus event, so it would hand the draft straight back.
    pill.addEventListener('pointerenter', (event) => {
      if (event.isTrusted && preview) pill?.setAttribute('title', preview);
    });
    pill.addEventListener('pointerleave', () => {
      pill?.removeAttribute('title');
    });

    doc.documentElement.append(host);
  }

  function setVisible(visible: boolean): void {
    pill?.setAttribute('data-visible', visible ? 'true' : 'false');
  }

  /**
   * Put the pill where the field is.
   *
   * Fixed positioning, measured from getBoundingClientRect, rather than
   * absolute positioning plus scroll offsets: the field may sit inside its own
   * scrolling container, and viewport coordinates are correct for all of them
   * without having to find and add up every scrolling ancestor.
   *
   * Moved with a transform rather than top/left so repositioning during a
   * scroll does not force the page into a fresh layout on every frame.
   */
  function place(): void {
    if (!pill || !field) return;

    const rect = field.getBoundingClientRect();

    // The field was removed, or collapsed to nothing.
    if (rect.width === 0 && rect.height === 0) {
      setVisible(false);
      return;
    }

    const viewportWidth = doc.documentElement.clientWidth;
    const viewportHeight = doc.documentElement.clientHeight;

    // Scrolled out of sight: hide rather than pin the pill to an edge, which
    // would point at a field the user cannot see.
    if (
      rect.bottom < 0 ||
      rect.top > viewportHeight ||
      rect.right < 0 ||
      rect.left > viewportWidth
    ) {
      setVisible(false);
      return;
    }

    const size = pill.getBoundingClientRect();

    let left: number;
    let top: number;

    if (rect.height >= size.height + GAP * 2) {
      // Room to sit inside the field's bottom-right corner, as specified.
      left = rect.right - size.width - GAP;
      top = rect.bottom - size.height - GAP;
    } else {
      // A single-line input is not tall enough to hold the pill without
      // covering what the user is typing, so sit just underneath it instead.
      left = rect.right - size.width;
      top = rect.bottom + GAP;
    }

    // Keep it on screen even when the field is at the very edge.
    left = Math.max(GAP, Math.min(left, viewportWidth - size.width - GAP));
    top = Math.max(GAP, Math.min(top, viewportHeight - size.height - GAP));

    pill.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    setVisible(true);
  }

  /** Coalesce bursts of scroll events into one measurement per frame. */
  function schedulePlace(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  }

  function startTracking(): void {
    // `capture: true` so this fires for scrolling inside any container on the
    // page, not just the document — scroll events do not bubble.
    doc.addEventListener('scroll', schedulePlace, { capture: true, passive: true });
    (doc.defaultView ?? window).addEventListener('resize', schedulePlace, { passive: true });

    if (typeof ResizeObserver === 'function' && field) {
      observer = new ResizeObserver(schedulePlace);
      observer.observe(field);
    }
  }

  function stopTracking(): void {
    doc.removeEventListener('scroll', schedulePlace, { capture: true });
    (doc.defaultView ?? window).removeEventListener('resize', schedulePlace);
    observer?.disconnect();
    observer = null;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function hide(): void {
    if (!field) return;
    stopTracking();
    setVisible(false);
    if (pill) {
      pill.style.transform = 'translate(-9999px, -9999px)';
      pill.removeAttribute('title');
    }
    field = null;
    activate = null;
    preview = '';
  }

  return {
    show(nextField, savedAt, text, onActivate) {
      build();
      if (!pill || !label) return;

      if (field && field !== nextField) stopTracking();

      field = nextField;
      activate = onActivate;

      const when = relativeTime(savedAt);
      label.textContent = `Restore draft (${when})`;
      pill.setAttribute('aria-label', `Restore the draft saved ${when}`);

      // The tooltip shows WHAT will come back, not just when it was saved.
      // Without it the pill asks for a click on an unknown quantity, and the
      // first thing a person wonders on seeing the result is whether the
      // extension picked the wrong draft. It is composed now and shown later,
      // on hover — putting it on the element here would publish the draft to
      // the page before the user has done anything at all.
      const flat = text.replace(/\s+/g, ' ').trim();
      const shown = flat.length > 180 ? `${flat.slice(0, 180)}\u2026` : flat;
      preview = `Draft Rescue \u2014 saved ${when}, ${text.length} characters\n\n${shown}`;
      pill.removeAttribute('title');

      startTracking();
      // Measure after the label is in place, so the pill's width is final.
      schedulePlace();
    },

    hide,

    destroy() {
      hide();
      host?.remove();
      host = null;
      root = null;
      pill = null;
      label = null;
    },

    anchor: () => field,
    shadowRoot: () => root,
  };
}
