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

/**
 * Characters a browser throws away before it looks at a URL's scheme: the C0
 * control range (which includes tab, newline and carriage return) and DEL.
 *
 * This is the whole reason this function is not a one-line regex. The URL
 * standard has browsers strip ASCII tab, LF and CR from anywhere in a URL, and
 * strip leading control characters and spaces, *before* parsing the scheme. So
 * `java<TAB>script:alert(1)` is a relative path to a naive regex and a
 * javascript: URL to Chrome. Test the scheme against what the browser will
 * actually see, not against what was written.
 *
 * We remove the whole control range rather than only the three characters the
 * standard names. That is stricter than a browser, which can only ever make us
 * refuse an href — and an href with a control character in it was already
 * broken.
 */
const URL_IGNORED = /[\u0000-\u001f\u007f]/g;

function isSafeHref(value: string): boolean {
  const url = value.replace(URL_IGNORED, '').replace(/^ +/, '');
  // Relative URLs are fine and common in editors; anything with a scheme has to
  // be on the allowlist, which keeps out javascript: and data:.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;
  return SAFE_URL.test(url);
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

  /**
   * Second redaction pass, across element boundaries.
   *
   * `clean` redacts text node by text node, which is all it can do — it is
   * editing the tree in place and a match cannot span two nodes. But a text
   * node boundary is the normal state of a contenteditable: bold one group of a
   * card number, or paste from anywhere styled, and Gmail, Slack, Quill and
   * Lexical all split the run into spans. Each half is then too short to look
   * like a card, so nothing is redacted and the full number goes to disk —
   * while the plain text stored alongside it, which is read whole, says
   * `[redacted]`. A row that claims to be clean and is not is the worst
   * possible version of this bug.
   *
   * When the joined text redacts to something the node-by-node pass did not
   * catch, the markup is thrown away and the draft is stored as text only.
   * Reassembling the match across nodes would keep the formatting, but this
   * file's rule is already that formatting is a nicety and text is not.
   */
  if (redact(clone.textContent ?? '').count > 0) return undefined;

  const html = clone.innerHTML;
  if (!html) return undefined;
  if (html.length > MAX_HTML_BYTES) return undefined;

  // If the markup carries no formatting the plain text does not already have,
  // storing it doubles the row for nothing.
  const stripped = html.replace(/<[^>]*>/g, '');
  if (stripped === html) return undefined;

  return html;
}
