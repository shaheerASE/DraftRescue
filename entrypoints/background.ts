import { defineBackground } from 'wxt/utils/define-background';

/**
 * THE SERVICE WORKER (Manifest V3 "background").
 *
 * New-concept note, since this is the piece that trips up everyone coming from
 * normal web dev:
 *
 * 1. This is not a page and it is not always running. Chrome starts it when
 *    something needs it (a message arrives, an alarm fires, the extension is
 *    installed) and KILLS IT after roughly 30 seconds of idle.
 * 2. Because it gets killed, every module-level variable in this file is
 *    volatile. A counter here will silently reset. Anything that must survive
 *    goes to IndexedDB or chrome.storage, never to a variable.
 * 3. Because it gets killed, setTimeout/setInterval longer than a few seconds
 *    are useless — the worker dies before they fire. Long-lived scheduling uses
 *    chrome.alarms, which wakes the worker back up. That is why the spec calls
 *    for alarms for the purge job.
 *
 * It has no DOM, no window, and it cannot see the page. What it does have is
 * the extension's own origin — which is exactly why it, and only it, will own
 * the IndexedDB writes (Phase 1).
 *
 * `defineBackground` is WXT's wrapper; the function body runs on every wake.
 */
export default defineBackground(() => {
  console.log('[Draft Rescue] service worker awake', {
    at: new Date().toISOString(),
  });
});
