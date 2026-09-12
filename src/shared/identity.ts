/**
 * Pure string helpers for deciding what part of a field's identity is worth
 * trusting.
 *
 * DOM-free on purpose. The service worker scores stored fingerprints against
 * live ones, and a Manifest V3 service worker has no DOM at all — importing
 * anything that touches `document` or `location` from there is a runtime error
 * waiting to happen. Keeping these separate makes that impossible rather than
 * merely unlikely.
 */

/**
 * Whether an id looks machine-generated, and so worthless as identity.
 *
 * React's useId emits `:r1a:`, Radix emits `radix-:r3:`, MUI emits `mui-4821`,
 * CSS-in-JS emits hashes. All of them change between builds, and some change
 * between renders — keying a draft on one means losing the match on the site's
 * next deploy.
 */
export function looksGenerated(value: string): boolean {
  if (!value) return true;

  // React 18's useId format, which is deliberately not a valid CSS identifier.
  if (value.includes(':')) return true;

  if (/^(radix|mui|headlessui|react-aria|chakra|mantine|ember|ext-gen|yui)[-_]/i.test(value)) {
    return true;
  }

  // uuid
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value)) {
    return true;
  }

  // A run of hex long enough to be a hash rather than a word.
  if (/[0-9a-f]{8,}/i.test(value)) return true;

  // The spec's shape: an optional word, then a long hex-ish tail.
  if (/^[a-z]*[-_]?[0-9a-f]{6,}$/i.test(value)) return true;

  // nanoid and cuid style: long, no word structure, mixed alphabet.
  if (
    /^[A-Za-z0-9_-]{16,}$/.test(value) &&
    /\d/.test(value) &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value)
  ) {
    return true;
  }

  // Four or more digits anywhere is a counter, an index or a timestamp — not
  // something a person typed as a name. Catches `input-48213`, `field_20240315`.
  if ((value.match(/\d/g) ?? []).length >= 4) return true;

  return false;
}

/**
 * Collapses the volatile parts of a URL path.
 *
 * `/proposals/12345` and `/proposals/67890` are different pages but the same
 * *kind* of page with the same fields. Keying on the raw path would mean a user
 * who reloads a proposal under a new id loses the match. The raw path is stored
 * alongside, so nothing is thrown away.
 */
export function normalizePathname(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return ':uuid';
      if (/^[0-9a-f]{12,}$/i.test(segment)) return ':hash';
      if (/\d{4,}/.test(segment)) return ':id';
      return segment;
    })
    .join('/');
}
