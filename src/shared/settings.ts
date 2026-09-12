import { browser } from 'wxt/browser';

/**
 * User settings.
 *
 * These live in chrome.storage.local rather than IndexedDB for one reason: the
 * content script needs to read them on every page, and a content script cannot
 * reach the extension's IndexedDB — it would open the *website's* database
 * instead. chrome.storage is the one store both sides can see, and it fires a
 * change event so every open tab updates without a reload.
 *
 * Drafts do not go here. chrome.storage.local is the wrong tool for thousands
 * of text snapshots; that is IndexedDB's job, in the service worker.
 */
export interface Settings {
  /** Master switch. */
  enabled: boolean;
  /**
   * Off by default, and Chrome gates incognito separately: the extension does
   * not run in a private window at all unless the user ticks "Allow in
   * incognito" on chrome://extensions. This setting is our own second refusal
   * on top of that, not a way to grant it.
   */
  captureInIncognito: boolean;
  /** Hostnames never captured on. Matches the host and its subdomains. */
  blockedOrigins: string[];
  /** Days to keep a snapshot. 0 means forever. */
  retentionDays: number;
  /** Versions kept per field. The spec's 10 — the paragraph you deleted
   *  five minutes ago is the one you want back. */
  versionsPerField: number;
  /** Hard cap on total storage, evicting oldest first when exceeded. */
  maxBytes: number;
  /** Shortest text worth storing. Below this it is not a draft. */
  minLength: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  captureInIncognito: false,
  blockedOrigins: [],
  retentionDays: 7,
  versionsPerField: 10,
  maxBytes: 50 * 1024 * 1024,
  minLength: 15,
};

const KEY = 'settings';

export async function readSettings(): Promise<Settings> {
  try {
    const stored = await browser.storage.local.get(KEY);
    return { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
  } catch {
    // A content script can find the extension context gone mid-navigation, or
    // during a dev reload. Falling back to defaults keeps capture working
    // rather than throwing inside someone else's page.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await readSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

/** Calls back whenever settings change, in any tab. Returns an unsubscribe. */
export function onSettingsChanged(fn: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes[KEY]) return;
    fn({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
