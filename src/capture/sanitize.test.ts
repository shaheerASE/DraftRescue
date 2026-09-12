import { describe, expect, it } from 'vitest';
import { MAX_HTML_BYTES, sanitizeHtml } from './sanitize';

/**
 * Built detached on purpose. Attaching a fixture containing an <iframe> makes
 * the DOM implementation try to actually load its src, which is both slow and
 * a real network call from a unit test.
 */
function make(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

/**
 * Written by code point rather than as escapes in the fixture strings: a
 * literal tab or newline inside a test file is invisible, and the whole point
 * of these cases is that the character is there.
 */
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);

describe('sanitizeHtml — keeps formatting', () => {
  it.each([
    ['<b>bold</b> text', '<b>bold</b> text'],
    ['<em>a</em> and <strong>b</strong>', '<em>a</em> and <strong>b</strong>'],
    ['line<br>break', 'line<br>break'],
    ['<ul><li>one</li><li>two</li></ul>', '<ul><li>one</li><li>two</li></ul>'],
    ['<blockquote>quoted</blockquote>', '<blockquote>quoted</blockquote>'],
    ['<p>para</p>', '<p>para</p>'],
  ])('%s', (input, expected) => {
    expect(sanitizeHtml(make(input))).toBe(expected);
  });

  it('keeps a safe link but drops its other attributes', () => {
    expect(sanitizeHtml(make('<a href="https://x.test" onclick="evil()" class="c">x</a>')))
      .toBe('<a href="https://x.test">x</a>');
  });

  it('keeps a relative link', () => {
    expect(sanitizeHtml(make('<a href="/jobs">x</a>'))).toBe('<a href="/jobs">x</a>');
  });
});

describe('sanitizeHtml — removes danger', () => {
  it('drops script tags and their contents', () => {
    expect(sanitizeHtml(make('hello<script>alert(1)</script>world')))
      .toBeUndefined(); // nothing but text remains, so no HTML worth storing
  });

  it('drops a script but keeps surrounding formatting', () => {
    expect(sanitizeHtml(make('<b>hi</b><script>alert(1)</script>')))
      .toBe('<b>hi</b>');
  });

  it.each([
    '<b>x</b><style>body{display:none}</style>',
    '<b>x</b><iframe src="https://evil.test"></iframe>',
    '<b>x</b><object data="x"></object>',
    '<b>x</b><svg onload="evil()"></svg>',
    '<b>x</b><form><input name="p"></form>',
  ])('drops dangerous element in %s', (input) => {
    expect(sanitizeHtml(make(input))).toBe('<b>x</b>');
  });

  it.each([
    '<b onclick="evil()">x</b>',
    '<b onmouseover="evil()">x</b>',
    '<b style="background:url(evil)">x</b>',
    '<b data-anything="y">x</b>',
  ])('strips attributes: %s', (input) => {
    expect(sanitizeHtml(make(input))).toBe('<b>x</b>');
  });

  it.each([
    '<a href="javascript:evil()">x</a>',
    '<a href="data:text/html,<script>evil()</script>">x</a>',
    '<a href="vbscript:evil()">x</a>',
  ])('strips an unsafe href: %s', (input) => {
    expect(sanitizeHtml(make(input))).toBe('<a>x</a>');
  });

  /**
   * Browsers delete tab, newline and carriage return from a URL before they
   * parse its scheme, so every one of these is `javascript:alert(1)` by the
   * time it is clicked, however it looks in the markup. An editor never
   * produces one; a page that wants us to store an executable link does.
   */
  it.each([
    ['tab', `<a href="java${TAB}script:evil()">x</a>`],
    ['newline', `<a href="java${LF}script:evil()">x</a>`],
    ['carriage return', `<a href="java${CR}script:evil()">x</a>`],
    ['leading NUL', `<a href="${NUL}javascript:evil()">x</a>`],
    ['leading tab', `<a href="${TAB}javascript:evil()">x</a>`],
    ['split data: url', `<a href="da${LF}ta:text/html,x">x</a>`],
    ['mixed case and tab', `<a href="Ja${TAB}vaScRiPt:evil()">x</a>`],
  ])('strips an unsafe href hidden with a %s', (_name, input) => {
    expect(sanitizeHtml(make(input))).toBe('<a>x</a>');
  });

  it('still keeps a relative href that contains a space', () => {
    expect(sanitizeHtml(make('<a href="/my page">x</a>')))
      .toBe('<a href="/my page">x</a>');
  });

  it('still keeps a safe href written with leading whitespace', () => {
    expect(sanitizeHtml(make(`<a href="${TAB} https://x.test">x</a>`)))
      .toBe(`<a href="${TAB} https://x.test">x</a>`);
  });

  it('unwraps an unknown tag rather than losing its text', () => {
    expect(sanitizeHtml(make('<b>keep</b><marquee>this text</marquee>')))
      .toBe('<b>keep</b>this text');
  });

  it('drops comments', () => {
    expect(sanitizeHtml(make('<b>x</b><!-- secret -->'))).toBe('<b>x</b>');
  });
});

describe('sanitizeHtml — redaction applies inside markup', () => {
  it('redacts a card number in a text node', () => {
    expect(sanitizeHtml(make('<b>pay</b> 4242 4242 4242 4242')))
      .toBe('<b>pay</b> [redacted]');
  });

  it('redacts inside nested formatting', () => {
    expect(sanitizeHtml(make('<p><em>cnic 42101-1234567-1</em></p>')))
      .toBe('<p><em>cnic [redacted]</em></p>');
  });
});

describe('sanitizeHtml — when not to bother', () => {
  it('returns undefined for plain text with no markup', () => {
    expect(sanitizeHtml(make('just some words'))).toBeUndefined();
  });

  it('returns undefined for empty content', () => {
    expect(sanitizeHtml(make(''))).toBeUndefined();
  });

  it('returns undefined when the markup is enormous', () => {
    // One element with a very long text node: same size check, without making
    // the DOM implementation parse tens of thousands of nodes.
    const huge = `<b>${'x'.repeat(MAX_HTML_BYTES + 1000)}</b>`;
    expect(sanitizeHtml(make(huge))).toBeUndefined();
  });
});

/**
 * A card number split across two text nodes is the ordinary output of a rich
 * editor, not an attack. `clean` redacts one text node at a time and cannot see
 * a match that spans a boundary, so the markup has to be checked as a whole
 * afterwards — otherwise the stored row says `[redacted]` in its text and
 * carries the full number in its html.
 */
describe('sanitizeHtml — a number split across elements', () => {
  it.each([
    ['bolded last group', 'Card 4242 4242 <b>4242 4242</b>'],
    ['editor spans', '<span>4242 4242 </span><span>4242 4242</span>'],
    ['split mid-group', '<b>42424242</b><i>42424242</i>'],
    ['CNIC across a span', 'cnic 42101-<b>1234567-1</b>'],
  ])('stores no markup at all when a %s hides a number', (_name, input) => {
    expect(sanitizeHtml(make(input))).toBeUndefined();
  });

  it('still stores markup for a draft with no number in it', () => {
    expect(sanitizeHtml(make('Card <b>details</b> to follow')))
      .toBe('Card <b>details</b> to follow');
  });

  it('still redacts and keeps the markup when the number is in one node', () => {
    expect(sanitizeHtml(make('<b>pay</b> 4242 4242 4242 4242')))
      .toBe('<b>pay</b> [redacted]');
  });
});
