import { redact } from './redact';

/**
 * Turns a contenteditable's markup into HTML that is safe to store and, later,
 * safe to put back into a page.
 *
 * WHY SANITISE ON WRITE, NOT ON READ
 * If we stored the page's raw HTML, our database would hold whatever the site
 * (or anything that had got into the site) put in the editor, and every future
 * feature that renders a preview or restores formatting would be one mistake
 * away from executing it. Sanitising here means the dangerous form never exists
 * in our storage at all, so no future code path can reach it.
 *
 * WHY THIS RUNS IN THE CONTENT SCRIPT
 * The service worker is the single writer, so this would naturally live there —
 * except a Manifest V3 service worker has no DOM. No `document`, no
 * `DOMParser`, no `createElement`. Parsing HTML safely without a parser means
 * either hand-rolling one (a bad idea, historically) or spinning up an
 * offscreen document (another permission, another moving part). The content
 * script already has the page's DOM, so it sanitises before sending. The cost
 * is bytes in the content script bundle, which we have budget for.
 */

/**
 * Formatting we keep. Everything else is unwrapped (children preserved, tag
 * dropped) rather than deleted, so text never disappears just because it was
 * inside a tag we do not know.
 */
const ALLOWED_TAGS = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'I', 'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRIKE', 'STRONG',
  'SUB', 'SUP', 'U', 'UL',
]);

/**
 * Tags dropped entirely, contents and all. These carry no draft text worth
 * keeping and every one of them is a way to smuggle behaviour back in.
 */
const DROPPED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'APPLET', 'LINK',
  'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'SVG',
  'MATH', 'TEMPLATE', 'NOSCRIPT', 'CANVAS', 'AUDIO', 'VIDEO', 'SOURCE',
]);

/** The only attributes that survive, per tag. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href']),
};

const SAFE_URL = /^(https?:|mailto:|tel:)/i;

/** Beyond this we keep the plain text only. Formatting is a nicety; text is not. */
export const MAX_HTML_BYTES = 128 * 1024;

function isSafeHref(value: string): boolean {
  const trimmed = value.trim();
  // Relative URLs are fine and common in editors; anything with a scheme has to
  // be on the allowlist, which keeps out javascript: and data:.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
  return SAFE_URL.test(trimmed);
}

/**
 * Sanitise in place inside a detached clone.
 *
 * Walks children backwards because unwrapping a node mutates the child list,
 * and going backwards means the indices we have not visited yet stay valid.
 */
function clean(node: Element): void {
  const children = Array.from(node.childNodes);

  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (!child) continue;

    if (child.nodeType === 3 /* Node.TEXT_NODE */) {
      // Redact here, on text nodes only. Running the redaction regexes over the
      // HTML string instead would let them match inside tags and attributes and
      // produce broken markup.
      const value = child.nodeValue ?? '';
      const { text } = redact(value);
      if (text !== value) child.nodeValue = text;
      continue;
    }

    if (child.nodeType !== 1 /* Node.ELEMENT_NODE */) {
      // Comments and anything else exotic: drop.
      child.parentNode?.removeChild(child);
      continue;
    }

    const el = child as Element;
    const tag = el.tagName.toUpperCase();

    if (DROPPED_TAGS.has(tag)) {
      el.parentNode?.removeChild(el);
      continue;
    }

    clean(el);

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: keep the text, lose the tag.
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
      continue;
    }

    const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
    for (const attr of Array.from(el.attributes)) {
      if (!allowed.has(attr.name.toLowerCase())) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (attr.name.toLowerCase() === 'href' && !isSafeHref(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

/**
 * Returns sanitised HTML for an element, or undefined when there is no point
 * storing any: no markup worth keeping, or too much of it.
 */
export function sanitizeHtml(source: Element): string | undefined {
  const clone = source.cloneNode(true) as Element;
  clean(clone);

  const html = clone.innerHTML;
  if (!html) return undefined;
  if (html.length > MAX_HTML_BYTES) return undefined;

  // If the markup carries no formatting the plain text does not already have,
  // storing it doubles the row for nothing.
  const stripped = html.replace(/<[^>]*>/g, '');
  if (stripped === html) return undefined;

  return html;
}
