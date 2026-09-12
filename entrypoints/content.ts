import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { buildSignals, fieldKeyFor, readFieldText, resolveField } from '../src/capture/field';
import { redact } from '../src/capture/redact';
import { sanitizeHtml } from '../src/capture/sanitize';
import {
  editorKindOf,
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
    let unresolved = 0;

    // --- Dev diagnostics ------------------------------------------------------
    //
    // These exist because the failure mode of this extension is silence. If a
    // field is refused, or an event never resolves to a field at all, nothing
    // visible happens — which is indistinguishable from "it is working, I just
    // cannot see the database". Everything below compiles out of the production
    // build via import.meta.env.DEV.

    /** Elements already explained once, so typing does not spam the console. */
    const explained = new WeakSet<Element>();

    function describe(el: Element): string {
      const id = el.getAttribute('id');
      const name = el.getAttribute('name');
      const label = el.getAttribute('aria-label');
      return (
        el.tagName.toLowerCase() +
        (id ? `#${id}` : '') +
        (name ? `[name=${name}]` : '') +
        (label ? `[aria-label=${label}]` : '')
      );
    }

    function reportRefusal(el: Element, reason: string, detail?: string): void {
      if (explained.has(el)) return;
      explained.add(el);
      console.log(
        `[Draft Rescue] REFUSED ${describe(el)} — ${reason}${detail ? `: ${JSON.stringify(detail)}` : ''}`,
      );
    }

    /**
     * An input event we could not trace back to a field at all.
     *
     * Almost always a closed shadow root: when a site calls
     * attachShadow({ mode: 'closed' }), composedPath() omits everything inside
     * it, so the innermost node we can see is the custom element wrapping it.
     * Nothing can reach in — not us, not any extension. Worth saying out loud
     * rather than leaving as an unexplained silence.
     */
    /**
     * Is this element a component that merely re-announces a field we can
     * already see inside it?
     *
     * Reddit does this: typing in the comment box produces the real `input`
     * event on the contenteditable, and then <reddit-rte> and
     * <shreddit-composer> each re-dispatch one as themselves. It is the normal
     * pattern for a form-associated custom element proxying its inner field.
     *
     * Those extra events resolve to nothing, which is harmless — but reporting
     * them as unresolved would send someone hunting for a bug that is not
     * there. If the component's own open shadow root contains a field we would
     * capture, the real event already reached us and this one is a duplicate.
     */
    function proxiesAVisibleField(el: Element): boolean {
      const root = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (!root) return false;
      return root.querySelector('textarea, input, [contenteditable]') !== null;
    }

    function reportUnresolved(path: readonly EventTarget[]): void {
      const first = path[0] as Element | undefined;
      if (!first || typeof first.tagName !== 'string') return;
      if (explained.has(first)) return;
      if (proxiesAVisibleField(first)) return;
      explained.add(first);

      // An `input` event always originates on an editable element. So if the
      // innermost node we can see is NOT editable, the real origin is hidden
      // from us — and a closed shadow root is the only thing that hides it.
      // (An open root would have put the field itself in the path, and we would
      // have resolved it.) A closed root is never exposed as `.shadowRoot`,
      // which is the second half of the tell.
      const hasOpenShadow =
        (first as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot != null;
      const likelyClosedRoot = !hasOpenShadow && editorKindOf(first) === null;

      console.log('[Draft Rescue] UNRESOLVED input event', {
        innermostVisible: describe(first),
        path: path
          .slice(0, 6)
          .map((n) => ((n as Element).tagName ?? String(n)).toLowerCase()),
        likelyClosedShadowRoot: likelyClosedRoot,
        note: likelyClosedRoot
          ? 'The field is inside a closed shadow root. No extension can see into one.'
          : 'The event did not come from a field shape we handle.',
      });
    }

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
        void Promise.resolve(result).catch((error: unknown) => {
          // Silent in production; in dev, a message that never arrives is
          // exactly the failure that is hardest to notice, so say so.
          if (import.meta.env.DEV) {
            console.warn('[Draft Rescue] message to the service worker failed', error);
          }
        });
      } catch (error) {
        // "Extension context invalidated" — the extension was reloaded or
        // updated while this page stayed open. Nothing to do but stop trying;
        // the next page load gets a fresh content script.
        if (import.meta.env.DEV) {
          console.warn('[Draft Rescue] could not send (extension reloaded?)', error);
        }
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
        const path = event.composedPath();
        const el = resolveField(path);

        if (!el) {
          unresolved++;
          if (import.meta.env.DEV) reportUnresolved(path);
          return;
        }

        const decision = shouldCapture(el, context());
        if (!decision.capture) {
          refused++;
          if (import.meta.env.DEV) reportRefusal(el, decision.reason, decision.detail);
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
      /**
       * The focused element, following shadow roots down.
       *
       * document.activeElement stops at the shadow host — it reports the custom
       * element, not the field inside it. Each open root has its own
       * activeElement, so reaching the real one means descending.
       */
      const deepActiveElement = (): Element | null => {
        let node: Element | null = document.activeElement;
        while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
        return node;
      };

      (window as unknown as Record<string, unknown>).__draftRescue = {
        get stats() {
          return { captured, refused, unresolved, pending: pending.size, settings };
        },

        /** Why is this field (or the focused one) not being captured? */
        probe(target?: Element) {
          const el = target ?? deepActiveElement();
          if (!el) return 'Nothing is focused. Click into the field first, then run probe().';

          const decision = shouldCapture(el, context());
          const kind = decision.capture ? decision.kind : null;
          return {
            element: describe(el),
            tagName: el.tagName,
            contenteditable: el.getAttribute('contenteditable'),
            decision,
            textLength: kind ? readFieldText(el, kind).length : null,
            minLength: settings.minLength,
            insideShadowRoot: el.getRootNode() !== document,
          };
        },

        /** What actually made it into the database. Asks the service worker. */
        async dump(limit = 20) {
          const rows = await browser.runtime.sendMessage({ kind: MESSAGE.recent, limit });
          if (!Array.isArray(rows) || rows.length === 0) {
            console.log('[Draft Rescue] nothing stored yet');
            return rows ?? [];
          }
          console.table(
            rows.map((r: { signals: { origin: string; fieldName?: string; domPath: string }; text: string; createdAt: number }) => ({
              site: r.signals.origin,
              field: r.signals.fieldName ?? r.signals.domPath.slice(-40),
              chars: r.text.length,
              preview: r.text.slice(0, 60),
              when: new Date(r.createdAt).toLocaleTimeString(),
            })),
          );
          return rows;
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
