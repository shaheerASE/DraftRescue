import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { readSettings } from '../src/shared/settings';
import { MESSAGE, type ExtensionMessage } from '../src/shared/types';
import { getStats, purgeExpired, recentSnapshots, writeSnapshot } from '../src/storage/snapshots';

/**
 * THE SERVICE WORKER (Manifest V3 "background").
 *
 * New-concept note, because this is the piece that catches out everyone coming
 * from normal web development:
 *
 * 1. It is not a page and it is not always running. Chrome starts it when
 *    something needs it — a message arrives, an alarm fires — and kills it after
 *    roughly 30 seconds of idle.
 * 2. Because it gets killed, every module-level variable here is volatile. A
 *    counter would silently reset. Anything that must survive goes to IndexedDB
 *    or chrome.storage, never to a variable.
 * 3. Because it gets killed, setTimeout and setInterval beyond a few seconds
 *    never fire — the worker is gone before they do. Long-lived scheduling uses
 *    chrome.alarms, which wakes the worker back up.
 *
 * It has no DOM: no document, no DOMParser, no innerHTML. That is why HTML
 * sanitising happens in the content script instead of here.
 *
 * What it does have is the extension's own origin, which is why it — and only
 * it — writes to IndexedDB.
 */

const PURGE_ALARM = 'draft-rescue/purge';
const PURGE_PERIOD_MINUTES = 6 * 60;

export default defineBackground(() => {
  /**
   * Ask Chrome not to evict our data under storage pressure.
   *
   * Without this, IndexedDB is "best effort" and the browser may clear it when
   * the disk gets tight — which for a tool whose only job is not losing text
   * would be the worst possible failure. Chrome grants this silently for
   * installed extensions.
   */
  async function requestPersistence(): Promise<void> {
    try {
      await navigator.storage?.persist?.();
    } catch {
      // Not fatal — we just stay evictable.
    }
  }

  async function schedulePurge(): Promise<void> {
    // create() replaces an alarm of the same name, so this is safe to call on
    // every wake without piling up duplicates.
    await browser.alarms.create(PURGE_ALARM, {
      periodInMinutes: PURGE_PERIOD_MINUTES,
      delayInMinutes: 1,
    });
  }

  browser.runtime.onInstalled.addListener(() => {
    void requestPersistence();
    void schedulePurge();
  });

  // Also on plain startup: onInstalled only fires on install and update, and an
  // alarm can be lost if the profile is restored or the extension is disabled
  // and re-enabled.
  browser.runtime.onStartup.addListener(() => {
    void schedulePurge();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== PURGE_ALARM) return;
    void (async () => {
      const settings = await readSettings();
      const removed = await purgeExpired(settings);
      if (import.meta.env.DEV && removed > 0) {
        console.log('[Draft Rescue] purged expired snapshots', { removed });
      }
    })();
  });

  /**
   * The only write path.
   *
   * Note the explicit sendResponse + `return true` rather than returning a
   * promise: Chrome's native onMessage does not understand a returned promise,
   * and `return true` is what tells it to keep the message channel open until
   * sendResponse is called.
   */
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message as ExtensionMessage;

    if (msg?.kind === MESSAGE.capture) {
      void (async () => {
        try {
          const settings = await readSettings();
          const outcome = await writeSnapshot(msg.payload, settings);
          if (import.meta.env.DEV) {
            console.log('[Draft Rescue] capture', {
              origin: msg.payload.signals.origin,
              field: msg.payload.signals.fieldName ?? msg.payload.signals.domPath,
              chars: msg.payload.text.length,
              redactions: msg.payload.redactions,
              outcome,
            });
          }
          sendResponse(outcome);
        } catch (error) {
          console.error('[Draft Rescue] write failed', error);
          sendResponse({ stored: false, reason: 'error' });
        }
      })();
      return true;
    }

    // Lets the content script's dev console ask what actually landed in the
    // database, without the user having to find the service worker's DevTools.
    if (msg?.kind === MESSAGE.recent) {
      void (async () => {
        try {
          sendResponse(await recentSnapshots(msg.limit ?? 20));
        } catch (error) {
          console.error('[Draft Rescue] recent failed', error);
          sendResponse([]);
        }
      })();
      return true;
    }

    if (msg?.kind === MESSAGE.stats) {
      void (async () => {
        try {
          sendResponse(await getStats());
        } catch (error) {
          console.error('[Draft Rescue] stats failed', error);
          sendResponse(null);
        }
      })();
      return true;
    }

    return false;
  });

  if (import.meta.env.DEV) {
    console.log('[Draft Rescue] service worker awake', { at: new Date().toISOString() });
  }
});
