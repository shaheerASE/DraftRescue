import { browser } from 'wxt/browser';

export function Popup() {
  const version = browser.runtime.getManifest().version;

  return (
    <div className="w-[360px] bg-ink-50 p-5 text-ink-900">
      <h1 className="text-base font-semibold">Draft Rescue</h1>
      <p className="mt-1 text-sm text-ink-500">
        Scaffold only. History, search and restore land in Phase 4.
      </p>

      <button
        type="button"
        onClick={() => browser.runtime.openOptionsPage()}
        className="mt-4 rounded-md bg-rescue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rescue-600"
      >
        Open settings
      </button>

      <p className="mt-4 text-xs text-ink-300">v{version} · nothing leaves this device</p>
    </div>
  );
}
