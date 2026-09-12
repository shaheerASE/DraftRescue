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
