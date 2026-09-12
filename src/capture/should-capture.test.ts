import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CaptureContext,
  editorKindOf,
  isSensitiveIdentifier,
  labelTextFor,
  hostMatches,
  normalizeIdentifier,
  shouldCapture,
  tokenize,
} from './should-capture';

/** A permissive context, so each test only varies the one thing it is about. */
function ctx(overrides: Partial<CaptureContext> = {}): CaptureContext {
  return {
    enabled: true,
    incognito: false,
    captureInIncognito: false,
    blockedOrigins: [],
    frameHostname: 'example.com',
    frameOrigin: 'https://example.com',
    passwordMemory: new WeakSet<Element>(),
    ...overrides,
  };
}

/** Mount markup and return the element marked `data-t`. */
function mount(html: string): Element {
  document.body.innerHTML = html;
  const el = document.querySelector('[data-t]');
  if (!el) throw new Error('fixture must mark one element with data-t');
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('tokenize', () => {
  it('splits on separators and camelCase humps', () => {
    expect(tokenize('cardNumber')).toEqual(['card', 'number']);
    expect(tokenize('card_number')).toEqual(['card', 'number']);
    expect(tokenize('cc-csc')).toEqual(['cc', 'csc']);
    expect(tokenize('OTPCode')).toEqual(['otp', 'code']);
    expect(tokenize('pin2')).toEqual(['pin', '2']);
  });

  it('keeps an unseparated word whole, so substring rules must catch those', () => {
    expect(tokenize('shipping')).toEqual(['shipping']);
    expect(tokenize('flashcard')).toEqual(['flashcard']);
  });
});

describe('normalizeIdentifier', () => {
  it('collapses every separator style to the same string', () => {
    expect(normalizeIdentifier('api_key')).toBe('apikey');
    expect(normalizeIdentifier('api-key')).toBe('apikey');
    expect(normalizeIdentifier('apiKey')).toBe('apikey');
    expect(normalizeIdentifier('API KEY')).toBe('apikey');
  });
});

describe('isSensitiveIdentifier', () => {
  const sensitive = [
    'password',
    'user_password',
    'newPassword',
    'passwd',
    'pwd',
    'pass',
    'passphrase',
    'cardnumber',
    'card_number',
    'cardNumber',
    'cc-number',
    'creditCardNumber',
    'cardholder-name',
    'cvv',
    'cvc',
    'cc-csc',
    'securityCode',
    'security_question',
    'pin',
    'atm_pin',
    'atmpin',
    'pinCode',
    'otp',
    'otp_code',
    'userOtp',
    'ssn',
    'social_security_number',
    'cnic',
    'cnic_number',
    'customerCnic',
    'iban',
    'ibanNumber',
    'seed',
    'seedPhrase',
    'recovery_phrase',
    'mnemonic',
    'privateKey',
    'api_key',
    'apiSecret',
    'access_token',
    'csrf_token',
    'client_secret',
    'secret',
    'token',
    'one-time-code',
    'verification_code',
    'Enter your password',
    'Card number',
  ];

  it.each(sensitive)('refuses %s', (value) => {
    expect(isSensitiveIdentifier(value)).toBe(true);
  });

  // These are the whole reason this module does not use one big substring
  // regex. Every one of them is a real-world field name that the obvious
  // implementation would have silently refused to save.
  const innocent = [
    'shipping',
    'shippingAddress',
    'shipping_address',
    'typing',
    'opinion',
    'mapping',
    'helping',
    'pinterest',
    'spinner',
    'flashcard',
    'wildcard',
    'discard',
    'postcard',
    'cardio',
    'card-description',
    'cardTitle',
    'card_body',
    'passenger',
    'passengerName',
    'passage',
    'compass',
    'bypass',
    'seeded',
    'linseed',
    'proceed',
    'keyword',
    'keywords',
    'comment',
    'message',
    'body',
    'description',
    'coverLetter',
    'proposal_text',
    'reply',
    'subject',
    'title',
    'bio',
    'about',
    'notes',
    'Write a comment',
    'Tell us about yourself',
  ];

  it.each(innocent)('allows %s', (value) => {
    expect(isSensitiveIdentifier(value)).toBe(false);
  });

  it('does not invent matches across separate attributes', () => {
    // name="api" and placeholder="Key here" must not combine into "apikey".
    expect(isSensitiveIdentifier('api')).toBe(false);
    expect(isSensitiveIdentifier('Key here')).toBe(false);
  });

  it('ignores empty and missing values', () => {
    expect(isSensitiveIdentifier(null)).toBe(false);
    expect(isSensitiveIdentifier(undefined)).toBe(false);
    expect(isSensitiveIdentifier('')).toBe(false);
    expect(isSensitiveIdentifier('   ')).toBe(false);
  });
});

describe('hostMatches', () => {
  it('matches the host and its subdomains only', () => {
    expect(hostMatches('stripe.com', 'stripe.com')).toBe(true);
    expect(hostMatches('js.stripe.com', 'stripe.com')).toBe(true);
    expect(hostMatches('notstripe.com', 'stripe.com')).toBe(false);
    expect(hostMatches('stripe.com.evil.test', 'stripe.com')).toBe(false);
  });
});

describe('editorKindOf', () => {
  it.each([
    ['<textarea data-t></textarea>', 'textarea'],
    ['<input data-t>', 'input'],
    ['<input data-t type="text">', 'input'],
    ['<input data-t type="search">', 'input'],
    ['<input data-t type="email">', 'input'],
    ['<input data-t type="url">', 'input'],
    ['<input data-t type="tel">', 'input'],
    ['<div data-t contenteditable></div>', 'contenteditable'],
    ['<div data-t contenteditable="true"></div>', 'contenteditable'],
    ['<div data-t contenteditable="plaintext-only"></div>', 'contenteditable'],
  ])('%s -> %s', (html, kind) => {
    expect(editorKindOf(mount(html))).toBe(kind);
  });

  it.each([
    '<input data-t type="password">',
    '<input data-t type="number">',
    '<input data-t type="hidden">',
    '<input data-t type="date">',
    '<input data-t type="checkbox">',
    '<input data-t type="file">',
    '<div data-t contenteditable="false"></div>',
    '<div data-t></div>',
    '<span data-t>text</span>',
  ])('%s is not an editor we handle', (html) => {
    expect(editorKindOf(mount(html))).toBeNull();
  });
});

describe('shouldCapture — refusals', () => {
  it('refuses a password field and remembers it', () => {
    const el = mount('<input data-t type="password" name="p">');
    const c = ctx();
    expect(shouldCapture(el, c)).toEqual({ capture: false, reason: 'password' });
    expect(c.passwordMemory.has(el)).toBe(true);
  });

  it('still refuses after a show/hide toggle flips it to type=text', () => {
    const el = mount('<input data-t type="password" name="p">');
    const c = ctx();
    shouldCapture(el, c); // the user typed while it was a password field

    el.setAttribute('type', 'text'); // they clicked "show password"
    el.removeAttribute('name'); // and pretend nothing else gives it away

    expect(shouldCapture(el, c)).toEqual({ capture: false, reason: 'was-password' });
  });

  it.each([
    ['current-password', '<input data-t autocomplete="current-password">'],
    ['new-password', '<input data-t autocomplete="new-password">'],
    ['one-time-code', '<input data-t autocomplete="one-time-code">'],
    ['cc-number', '<input data-t autocomplete="cc-number">'],
    ['cc-csc', '<input data-t autocomplete="cc-csc">'],
    ['cc-exp', '<input data-t autocomplete="cc-exp">'],
    ['cc-name', '<input data-t autocomplete="cc-name">'],
    ['sectioned', '<input data-t autocomplete="section-blue shipping cc-number">'],
  ])('refuses autocomplete %s', (_label, html) => {
    const result = shouldCapture(mount(html), ctx());
    expect(result).toMatchObject({ capture: false, reason: 'autocomplete' });
  });

  it.each([
    '<input data-t name="cardnumber">',
    '<input data-t id="cvv">',
    '<textarea data-t placeholder="Seed phrase"></textarea>',
    '<input data-t aria-label="ATM PIN">',
    '<div data-t contenteditable data-placeholder="Enter your password"></div>',
    '<input data-t name="cnic_number">',
  ])('refuses by identifier: %s', (html) => {
    expect(shouldCapture(mount(html), ctx())).toMatchObject({
      capture: false,
      reason: 'identifier',
    });
  });

  it('refuses by the associated <label>, not just the field attributes', () => {
    const el = mount(
      '<label for="f">Card number</label><input data-t id="f" name="f">',
    );
    expect(shouldCapture(el, ctx())).toMatchObject({
      capture: false,
      reason: 'identifier',
    });
  });

  it('refuses by a wrapping <label>', () => {
    const el = mount('<label>CVV <input data-t name="n"></label>');
    expect(shouldCapture(el, ctx())).toMatchObject({
      capture: false,
      reason: 'identifier',
    });
  });

  it('refuses by aria-labelledby', () => {
    const el = mount(
      '<span id="lbl">Security code</span><input data-t aria-labelledby="lbl">',
    );
    expect(shouldCapture(el, ctx())).toMatchObject({
      capture: false,
      reason: 'identifier',
    });
  });

  it.each([
    '<form action="/checkout"><input data-t name="number"></form>',
    '<form action="https://shop.test/api/pay"><input data-t name="code"></form>',
    '<form id="billing-form"><input data-t name="n"></form>',
    '<form name="card-entry"><input data-t name="n"></form>',
  ])('refuses a vaguely-named field inside a payment form: %s', (html) => {
    expect(shouldCapture(mount(html), ctx())).toMatchObject({
      capture: false,
      reason: 'payment-form',
    });
  });

  it('refuses inside a hosted payment iframe even with no other signal', () => {
    const el = mount('<input data-t name="n">');
    expect(shouldCapture(el, ctx({ frameHostname: 'js.stripe.com' }))).toMatchObject({
      capture: false,
      reason: 'payment-origin',
    });
  });

  it('refuses on a user-blocked origin, including subdomains', () => {
    const el = mount('<textarea data-t name="body"></textarea>');
    expect(
      shouldCapture(el, ctx({ frameHostname: 'mail.bank.test', blockedOrigins: ['bank.test'] })),
    ).toMatchObject({ capture: false, reason: 'blocked-origin' });
  });

  it('refuses in incognito by default, and captures when opted in', () => {
    const el = mount('<textarea data-t name="body"></textarea>');
    expect(shouldCapture(el, ctx({ incognito: true }))).toMatchObject({
      capture: false,
      reason: 'incognito',
    });
    expect(
      shouldCapture(el, ctx({ incognito: true, captureInIncognito: true })),
    ).toEqual({ capture: true, kind: 'textarea' });
  });

  it('refuses when the user has paused capture', () => {
    const el = mount('<textarea data-t name="body"></textarea>');
    expect(shouldCapture(el, ctx({ enabled: false }))).toMatchObject({
      capture: false,
      reason: 'disabled',
    });
  });

  it('refuses our own injected UI', () => {
    const el = mount(
      '<div data-draft-rescue-ui><input data-t name="search"></div>',
    );
    expect(shouldCapture(el, ctx())).toMatchObject({
      capture: false,
      reason: 'our-own-ui',
    });
  });

  it('refuses a sandboxed frame, which has no origin to file a draft under', () => {
    const el = mount('<textarea data-t name="body"></textarea>');
    // Every sandboxed frame on every site reports "null" here, so storing
    // under it would mix unrelated sites into one bucket.
    expect(shouldCapture(el, ctx({ frameOrigin: 'null' }))).toMatchObject({
      capture: false,
      reason: 'opaque-origin',
    });
  });

  it('refuses a null or non-element target', () => {
    expect(shouldCapture(null, ctx())).toMatchObject({ reason: 'not-an-element' });
  });
});

describe('shouldCapture — real markup that must keep working', () => {
  // If any of these start refusing, the product has quietly stopped doing its
  // job on a site people actually use. Shapes taken from the real editors.
  it.each([
    [
      'Gmail compose body',
      '<div data-t contenteditable="true" role="textbox" aria-label="Message Body" g_editable="true"></div>',
    ],
    [
      'LinkedIn post box',
      '<div data-t contenteditable="true" role="textbox" aria-placeholder="What do you want to talk about?" data-placeholder="What do you want to talk about?"></div>',
    ],
    [
      'Reddit comment box',
      '<div data-t contenteditable="true" role="textbox" aria-label="Comment"></div>',
    ],
    ['Upwork proposal', '<textarea data-t name="coverLetter" id="cover_letter"></textarea>'],
    ['Jira description', '<div data-t contenteditable="true" aria-label="Description"></div>'],
    ['X compose', '<div data-t contenteditable="true" data-testid="tweetTextarea_0"></div>'],
    ['Notion block', '<div data-t contenteditable="true" data-placeholder="Type something..."></div>'],
    ['WordPress title', '<input data-t type="text" name="post_title" id="title">'],
    ['Generic search box', '<input data-t type="search" name="q" placeholder="Search">'],
    ['Shipping address', '<input data-t type="text" name="shippingAddress">'],
    ['Trello-style card', '<textarea data-t name="card-description"></textarea>'],
  ])('captures %s', (_label, html) => {
    expect(shouldCapture(mount(html), ctx())).toMatchObject({ capture: true });
  });
});

describe('shouldCapture — Stripe Elements markup specifically', () => {
  // We are injected into cross-origin iframes, which means we run inside hosted
  // payment fields. These assert the attribute rules alone are enough, before
  // the payment-origin list is even consulted.
  it.each([
    '<input data-t class="InputElement" name="cardnumber" autocomplete="cc-number" inputmode="numeric">',
    '<input data-t class="InputElement" name="cvc" autocomplete="cc-csc" inputmode="numeric">',
    '<input data-t class="InputElement" name="exp-date" autocomplete="cc-exp" inputmode="numeric">',
  ])('refuses %s on an ordinary hostname', (html) => {
    expect(shouldCapture(mount(html), ctx({ frameHostname: 'example.com' }))).toMatchObject({
      capture: false,
    });
  });
});

/**
 * Fields inside web components.
 *
 * `resolveField` uses `composedPath()` so that a field inside an open shadow
 * root IS captured — that is a deliberate feature and most of why this works on
 * sites the alternatives do not. The consequence is that every refusal rule has
 * to reach across the same boundary, because `closest()`, form ownership and
 * `document.getElementById` all stop at a shadow root. A checkout built as a
 * custom element is an ordinary thing now, not an exotic one.
 */
describe('shouldCapture — the shadow boundary the capture path crosses', () => {
  /** Mount `inner` inside an open shadow root, hosted inside `outer`. */
  function mountShadow(outer: string, inner: string): Element {
    document.body.innerHTML = outer;
    const host = document.querySelector('[data-host]');
    if (!host) throw new Error('fixture must mark one element with data-host');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = inner;
    const el = root.querySelector('[data-t]');
    if (!el) throw new Error('fixture must mark one element with data-t');
    return el;
  }

  it('refuses a vaguely-named field inside a payment form in the same shadow root', () => {
    const el = mountShadow(
      '<x-checkout data-host></x-checkout>',
      '<form id="billing-card-form"><input data-t name="number"></form>',
    );
    expect(shouldCapture(el, ctx())).toMatchObject({
      capture: false,
      reason: 'payment-form',
    });
  });

  it('refuses when the payment form is outside the component entirely', () => {
    const el = mountShadow(
      '<form action="/checkout"><x-field data-host></x-field></form>',
      '<input data-t name="code">',
    );
    expect(shouldCapture(el, ctx())).toMatchObject({
      capture: false,
      reason: 'payment-form',
    });
  });

  it('reads an aria-labelledby label that lives inside the shadow root', () => {
    const el = mountShadow(
      '<x-checkout data-host></x-checkout>',
      '<span id="lbl">Card number</span><input data-t name="n" aria-labelledby="lbl">',
    );
    expect(labelTextFor(el)).toContain('Card number');
    expect(shouldCapture(el, ctx())).toMatchObject({
      capture: false,
      reason: 'identifier',
    });
  });

  it('reads a wrapping label inside the shadow root', () => {
    const el = mountShadow(
      '<x-pay data-host></x-pay>',
      '<label>Security code <input data-t name="n"></label>',
    );
    expect(labelTextFor(el)).toContain('Security code');
    expect(shouldCapture(el, ctx())).toMatchObject({ capture: false });
  });

  it('still captures an ordinary comment box inside a web component', () => {
    // The point is not to refuse everything in a shadow root.
    const el = mountShadow(
      '<x-comments data-host></x-comments>',
      '<label>Your reply <textarea data-t name="body"></textarea></label>',
    );
    expect(shouldCapture(el, ctx())).toMatchObject({ capture: true });
  });
});
