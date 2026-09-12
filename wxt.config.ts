import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// WXT reads this file to generate manifest.json and wire up the build.
// We never hand-write manifest.json — WXT emits it into .output/ on every build.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Manifest V3 only. MV2 is no longer accepted by the Chrome Web Store.
  // This is a WXT build target, not a manifest key — setting `manifest_version`
  // inside `manifest` below is silently ignored.
  manifestVersion: 3,

  // Entrypoints live at ./entrypoints. Shared logic lives at ./src and is
  // imported by whichever entrypoint needs it.
  srcDir: '.',

  manifest: {
    name: 'Draft Rescue',
    short_name: 'Draft Rescue',
    description:
      'Never lose what you typed. Draft Rescue saves your drafts to your own machine. Nothing is ever uploaded.',

    // PERMISSIONS POLICY FOR THIS PROJECT:
    // We add a permission in the phase that first needs it, never "just in
    // case". Every permission has to be justified in writing at store review,
    // and each one widens the blast radius if we ever ship a bug.
    //
    // The content script's `matches` (see entrypoints/content.ts) is what
    // grants page access, and it is declared there rather than as a blanket
    // `host_permissions` entry.
    permissions: [
      // Phase 1: settings the content script must read on every page. Drafts do
      // NOT go here — those are in IndexedDB, which needs no permission at all.
      'storage',
      // Phase 1: the retention purge. A service worker is killed after ~30
      // seconds idle, so setInterval cannot run a 6-hourly job; alarms wake it.
      'alarms',
    ],

    action: {
      default_title: 'Draft Rescue',
    },

    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
  },

  vite: () => ({
    // Tailwind v4 is a Vite plugin. No tailwind.config.js, no postcss.config.js
    // — content scanning is automatic and the theme lives in CSS.
    plugins: [tailwindcss()],

    build: {
      // Vite normally emits <link rel="modulepreload"> for shared chunks. On an
      // extension page Chrome reports that as "a cross-world extension resource
      // mismatch" and logs a warning against the extension — harmless, but it
      // puts warnings on the Errors button that look like real faults, and the
      // preload buys nothing here: these pages load from local disk, not a
      // network. Turning it off keeps the extension's error list honest, so a
      // warning there always means something.
      modulePreload: false,
    },
  }),
});
