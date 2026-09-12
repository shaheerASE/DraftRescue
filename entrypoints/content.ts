import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * THE CONTENT SCRIPT.
 *
 * New-concept note: this file is injected by Chrome into other people's web
 * pages. It shares the page's DOM but NOT the page's JavaScript — it runs in an
 * "isolated world", so the page cannot see our variables and we cannot see
 * theirs. We can read and write the DOM; we cannot read the page's React state.
 *
 * Two consequences that shape the whole product:
 *  - It runs on every page the user visits, so its size and its cost on every
 *    keystroke are other people's performance budget, not ours. Hence: zero
 *    dependencies here, no React, and a hard 20 KB gzipped budget.
 *  - If we write to IndexedDB from here, we write to *that website's*
 *    IndexedDB, not ours. That is the reason this file will only ever send
 *    messages, and the service worker does the storing.
 *
 * `matches: ['<all_urls>']` is the permission that lets Chrome inject us
 * everywhere. It is the single most scrutinised thing in our manifest and it is
 * also the entire product, so it stays.
 *
 * `all_frames: true` injects a separate copy of this script into every frame on
 * the page, including cross-origin iframes — each copy messages the service
 * worker on its own. (Note: this is why cross-origin iframes are NOT a
 * limitation for us. What is impossible is reaching *into* a cross-origin
 * iframe from the top frame's script, which we never need to do.)
 *
 * `runAt: 'document_start'` means we attach our listener before the page's own
 * scripts run, so we cannot be beaten to the first keystroke.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_start',

  main() {
    console.log('[Draft Rescue] content script attached', {
      url: location.href,
      isTopFrame: window.top === window.self,
    });
  },
});
