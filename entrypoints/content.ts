import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { buildSignals, fieldKeyFor, readFieldText, resolveField } from '../src/capture/field';
import { redact } from '../src/capture/redact';
import { sanitizeHtml } from '../src/capture/sanitize';
import {
  shouldCapture,
  type CaptureContext,
  type EditorKind,
} from '../src/capture/should-capture';
import { DEFAULT_SETTINGS, onSettingsChanged, readSettings, type Settings } from '../src/shared/settings';
import { MESSAGE, type CapturePayload } from '../src/shared/types';

/**
 * THE CONTENT SCRIPT.
 *
 * New-concept note: Chrome injects this file into other people's web pages. It
 * shares the page's DOM but not the page's JavaScript — it runs in an "isolated
 * world", so the page cannot see our variables and we cannot see theirs. We can
 * read and write the DOM; we cannot read the page's React state.
 *
 * Two consequences shape everything here:
 *  - It runs on every page the user visits, so its size and its cost per
 *    keystroke come out of someone else's performance budget. Hence zero
 *    dependencies, no React, and a hard 20 KB gzipped limit.
 *  - If it wrote to IndexedDB it would write to *that website's* database, not
 *    ours. So it only ever sends messages; the service worker does the storing.
 */

/** Spec's 800ms. Long enough to collapse a burst of typing, short enough that
 *  a crash costs you at most a sentence. */
const DEBOUNCE_MS = 800;

interface Pending {
  el: Element;
  kind: EditorKind;
  timer: ReturnType<typeof setTimeout>;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_start',

  main() {
    let settings: Settings = { ...DEFAULT_SETTINGS };
    void readSettings().then((loaded) => {
      settings = loaded;
    });
    onSettingsChanged((next) => {
      settings = next;
    });

    /**
     * Elements we have ever seen as a password field. See the note in
     * should-capture.ts — this is what survives a "show password" toggle.
     * A WeakSet, so it never holds an element the page has thrown away.
     */
    const passwordMemory = new WeakSet<Element>();

    /** The last text we actually sent per element, to avoid duplicate writes. */
    const lastSent = new WeakMap<Element, string>();

    /**
     * Fields waiting on their debounce.
     *
     * A Map rather than a WeakMap because flushing on page-hide has to iterate
     * it. Entries live at most DEBOUNCE_MS, so it stays small — but it is
     * cleared on flush precisely so it cannot become a leak on a long-lived SPA.
     */
    const pending = new Map<Element, Pending>();

    let captured = 0;
    let refused = 0;

    function isIncognito(): boolean {
      try {
        return browser.extension?.inIncognitoContext === true;
      } catch {
        return false;
      }
    }

    function context(): CaptureContext {
      return {
        enabled: settings.enabled,
        incognito: isIncognito(),
        captureInIncognito: settings.captureInIncognito,
        blockedOrigins: settings.blockedOrigins,
        frameHostname: location.hostname,
        passwordMemory,
      };
    }

    /** Does the actual read, redact and send for one field. */
    function capture(el: Element, kind: EditorKind): void {
      // Re-check the gate at flush time, not just at keystroke time: a site can
      // change a field's attributes between the two, and a "show password"
      // toggle is exactly that.
      const decision = shouldCapture(el, context());
      if (!decision.capture) {
        refused++;
        return;
      }

      const raw = readFieldText(el, kind);
      if (raw.length < settings.minLength) return;
      if (lastSent.get(el) === raw) return;

      const { text, count } = redact(raw);

      const signals = buildSignals(el, kind);
      const payload: CapturePayload = {
        fieldKey: fieldKeyFor(signals),
        signals,
        text,
        capturedAt: Date.now(),
        redactions: count,
      };

      // HTML only for contenteditable, and only when it actually carries
      // formatting the plain text does not. sanitizeHtml returns undefined
      // otherwise, so we are not doubling every row for nothing.
      if (kind === 'contenteditable') {
        const html = sanitizeHtml(el);
        if (html !== undefined) payload.html = html;
      }

      lastSent.set(el, raw);
      captured++;
      send(payload);
    }

    function send(payload: CapturePayload): void {
      try {
        const result = browser.runtime.sendMessage({ kind: MESSAGE.capture, payload });
        // Fire and forget, but a rejected promise with no catch is an unhandled
        // rejection in the page's console — someone else's console.
        void Promise.resolve(result).catch(() => {});
      } catch {
        // "Extension context invalidated" — the extension was reloaded or
        // updated while this page stayed open. Nothing to do but stop trying;
        // the next page load gets a fresh content script.
      }
    }

    /** Runs work when the browser is not busy, so typing never waits on us. */
    function whenIdle(fn: () => void): void {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback;
      if (typeof ric === 'function') ric(fn, { timeout: 2000 });
      else setTimeout(fn, 0);
    }

    function schedule(el: Element, kind: EditorKind): void {
      const existing = pending.get(el);
      if (existing) clearTimeout(existing.timer);

      const timer = setTimeout(() => {
        pending.delete(el);
        whenIdle(() => capture(el, kind));
      }, DEBOUNCE_MS);

      pending.set(el, { el, kind, timer });
    }

    /**
     * Writes everything waiting, immediately.
     *
     * Called when the page is going away, so this skips requestIdleCallback —
     * there may be no idle moment left.
     */
    function flush(): void {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        capture(entry.el, entry.kind);
      }
      pending.clear();
    }

    // --- The one listener -----------------------------------------------------
    //
    // `input` events bubble, so a single listener on `document` catches every
    // field on the page — including fields React or a modal adds later, which is
    // why this beats watching the DOM with a MutationObserver. On a page like
    // Gmail, a MutationObserver on the body would fire constantly for reasons
    // that have nothing to do with us.
    //
    // `capture: true` means we see the event on the way down, before the page's
    // own handlers get a chance to call stopPropagation.
    document.addEventListener(
      'input',
      (event) => {
        // composedPath, not event.target: inside a Shadow DOM the browser
        // retargets the event to the host element, so event.target would be the
        // web component, not the field the user typed into.
        const el = resolveField(event.composedPath());
        if (!el) return;

        const decision = shouldCapture(el, context());
        if (!decision.capture) {
          refused++;
          return;
        }

        schedule(el, decision.kind);
      },
      { capture: true, passive: true },
    );

    // --- Flushing on the way out ---------------------------------------------
    //
    // NOT `unload`. That event is deprecated, and registering a handler for it
    // disqualifies the page from the browser's back-forward cache — so using it
    // to protect drafts would make the back button slower for every page the
    // user visits. `visibilitychange` and `pagehide` cover the real cases:
    // switching tab, minimising, navigating away, and closing.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);

    if (import.meta.env.DEV) {
      // Reachable from DevTools by switching the console's context dropdown
      // from "top" to the Draft Rescue entry — content scripts run in their own
      // isolated world, so this is not visible to the page itself.
      (window as unknown as Record<string, unknown>).__draftRescue = {
        get stats() {
          return { captured, refused, pending: pending.size, settings };
        },
        explain(el: Element) {
          return shouldCapture(el, context());
        },
        flush,
      };
      console.log('[Draft Rescue] capturing', {
        url: location.href,
        isTopFrame: window.top === window.self,
      });
    }
  },
});
