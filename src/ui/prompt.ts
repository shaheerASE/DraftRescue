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
 * WHY `open` AND NOT `closed`
 * The isolation above comes from the shadow boundary itself and is identical in
 * both modes. `closed` only hides `.shadowRoot` from the page's JavaScript,
 * which stops nothing — a page that wanted to interfere could patch
 * `attachShadow` before we run. What `closed` does reliably is hide the pill
 * from our own DevTools inspector and from automated tests, making every
 * styling and positioning bug harder to diagnose, for no security gain.
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
  /** Offer `savedAt`'s draft for `field`. Replaces any prompt already showing. */
  show(field: Element, savedAt: number, onActivate: () => void): void;
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
      const run = activate;
      hide();
      run?.();
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
    if (pill) pill.style.transform = 'translate(-9999px, -9999px)';
    field = null;
    activate = null;
  }

  return {
    show(nextField, savedAt, onActivate) {
      build();
      if (!pill || !label) return;

      if (field && field !== nextField) stopTracking();

      field = nextField;
      activate = onActivate;

      const when = relativeTime(savedAt);
      label.textContent = `Restore draft (${when})`;
      pill.setAttribute('aria-label', `Restore the draft saved ${when}`);
      pill.title = `Draft Rescue — restore the draft saved ${when}`;

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
