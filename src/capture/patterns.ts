/**
 * The word lists behind the "never capture" gate.
 *
 * Kept as data, separate from the logic in should-capture.ts, because these
 * lists are the part most likely to need editing when a user reports either
 * kind of failure — and the two kinds of failure are not equally bad:
 *
 *   False negative: we store a password. Catastrophic. One-star reviews,
 *                   removal from the Web Store, and we deserve both.
 *   False positive: we silently refuse to save a legitimate draft. Bad — it is
 *                   the product failing at its only job, invisibly — but
 *                   recoverable.
 *
 * So the bias is towards refusing. But not blindly: a gate that refuses too
 * much is a product nobody keeps installed, and the spec's original regex
 * refused an enormous amount by accident. See NOTE ON SUBSTRING MATCHING below.
 */

/**
 * NOTE ON SUBSTRING MATCHING — why this file is not one regex.
 *
 * The obvious implementation is a single regex of substrings:
 *
 *   /pass|pwd|card|cvv|cvc|ccv|secur|iban|ssn|cnic|pin|otp|token|secret|seed/i
 *
 * It looks right and it is badly wrong, because short tokens appear inside
 * ordinary English words:
 *
 *   "pin"  is inside  shipping, typing, opinion, mapping, helping, pinterest
 *   "card" is inside  flashcard, wildcard, discard, postcard, cardio
 *   "pass" is inside  passenger, passage, compass, bypass
 *   "seed" is inside  seeded, linseed
 *
 * A field named `shippingAddress` or a Trello-style `card-description` would be
 * silently refused — and "silently" is the problem, because the user never
 * finds out until they need the draft back.
 *
 * So matching happens at two levels instead:
 *
 *   NORMALIZED SUBSTRING — the haystack with every separator removed, so
 *     `api_key`, `api-key` and `apiKey` all become "apikey". Patterns here are
 *     long enough that a hit is essentially never innocent.
 *
 *   TOKEN — the haystack split into words (on separators AND camelCase humps),
 *     matched whole. This is where the short, ambiguous ones live: `pin`
 *     matches a field named `pin` or `atm_pin`, but not `shipping`.
 *
 * One deliberate omission: bare `card` is NOT a token pattern. Kanban and
 * project tools name things `card-title`, `cardDescription`, `card_body` — real
 * drafts people lose. Actual card-number fields are caught four other ways
 * (autocomplete `cc-*`, the compound substrings below, the checkout-form rule,
 * and the payment-origin list), and the Luhn redaction pass in redact.ts is a
 * final net that works regardless of what the field is called.
 */

/**
 * Matched against the haystack with all non-alphanumerics stripped.
 * Every entry here must be long/specific enough that an innocent hit is
 * implausible — if you are tempted to add a short one, it belongs in
 * SENSITIVE_TOKENS instead.
 */
export const SENSITIVE_SUBSTRINGS: readonly string[] = [
  // Passwords
  'password',
  'passwd',
  'passwrd',
  'passphrase',
  'passcode',
  'passkey',
  'userpass',

  // Payment cards. `cardholder` is here because a name on a card still
  // identifies the instrument, and it always sits in a form we do not want.
  'cardnumber',
  'cardnum',
  'cardno',
  'creditcard',
  'debitcard',
  'ccnumber',
  'cardholder',
  'cardexpiry',
  'expirydate',
  'securitycode',

  // Knowledge-based auth
  'securityquestion',
  'securityanswer',
  'secretquestion',
  'secretanswer',

  // Government identity
  'socialsecurity',
  'socialinsurance',
  'nationalid',
  'nationalidentity',
  'idnumber',
  'identitycard',
  'identitynumber',
  'cnicnumber',
  'aadhaar',
  'taxid',

  // Banking
  'accountnumber',
  'routingnumber',
  'sortcode',
  'swiftcode',
  'ibannumber',

  // Crypto wallets — losing these is unrecoverable for the user, so we are
  // especially strict here.
  'seedphrase',
  'recoveryphrase',
  'recoverykey',
  'backupphrase',
  'privatekey',
  'walletkey',

  // API and session credentials
  'apikey',
  'apisecret',
  'apitoken',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'bearertoken',
  'sessiontoken',
  'csrftoken',
  'clientsecret',
  'secretkey',
  'accesskey',
  'privatetoken',

  // One-time codes
  'onetimecode',
  'onetimepassword',
  'verificationcode',
  'confirmationcode',
  'authcode',
  'smscode',
  'pincode',
  'pinnumber',
  'atmpin',
];

/**
 * Matched against whole words only. Safe to be short here — `pin` will match a
 * field called `pin` or `atm_pin` or `pinEntry`, and will not match `shipping`.
 */
export const SENSITIVE_TOKENS: readonly string[] = [
  'pass',
  'passwd',
  'password',
  'pwd',
  'pw',

  'cvv',
  'cvc',
  'ccv',
  'csc',
  'cid',
  'cc', // `cc-csc`, `cc-number` split to this; see also the autocomplete rule

  'pin',
  'pins',

  'otp',
  'totp',
  'mfa',

  'ssn',
  'sin',
  'nric',
  'cnic',
  'nid',
  'nin',
  'tin',

  'iban',
  'bic',
  'bsb',

  'secret',
  'secrets',
  'token',
  'tokens',
  'seed',
  'mnemonic',
  'otpcode',
];

/**
 * Matched against the END of any whole word, for the short identity tokens that
 * are routinely prefixed: `atmpin`, `userotp`, `myssn`, `customercnic`.
 * Deliberately narrow — a suffix rule on a common token would reintroduce
 * exactly the false positives this file exists to avoid.
 */
export const SENSITIVE_TOKEN_SUFFIXES: readonly string[] = [
  'pin',
  'otp',
  'cvv',
  'cvc',
  'ssn',
  'cnic',
  'iban',
  'password',
];

/**
 * `autocomplete` values that disqualify a field outright.
 *
 * This attribute is the most reliable signal we get, because sites set it for
 * their own benefit — it is what makes the browser's own password and card
 * autofill work. A site that wants autofill has to tell the truth here.
 */
export const SENSITIVE_AUTOCOMPLETE_EXACT: readonly string[] = [
  'current-password',
  'new-password',
  'one-time-code',
];

/** Any `autocomplete` starting with one of these is refused. `cc-` covers
 *  cc-number, cc-csc, cc-exp, cc-name and the rest of the payment set. */
export const SENSITIVE_AUTOCOMPLETE_PREFIXES: readonly string[] = ['cc-'];

/**
 * A field inside a form that looks like a payment form is refused regardless of
 * what the field itself is called, because checkout forms routinely name things
 * vaguely (`number`, `code`, `name`).
 */
export const PAYMENT_FORM_PATTERN = /pay|checkout|billing|card|invoice|purchase/i;

/**
 * Origins we never capture on, independent of the user's own blocklist.
 *
 * This exists because of a consequence of `all_frames: true` that is easy to
 * miss: we are injected into cross-origin iframes, and hosted payment fields
 * (Stripe Elements, Braintree, Adyen) are *exactly* that — a real `<input>`
 * inside an iframe owned by the processor. So we run inside them.
 *
 * The attribute rules above already catch Stripe's markup (`name="cardnumber"`,
 * `autocomplete="cc-number"`). This list is the belt to that pair of braces: if
 * a processor ever ships an unlabelled field, we still do not touch it.
 *
 * Matched against the frame's hostname, as a suffix, so `js.stripe.com` matches
 * `stripe.com` and an unrelated `notstripe.com` does not.
 */
export const PAYMENT_ORIGIN_SUFFIXES: readonly string[] = [
  'stripe.com',
  'stripe.network',
  'braintreegateway.com',
  'braintree-api.com',
  'paypal.com',
  'paypalobjects.com',
  'adyen.com',
  'checkout.com',
  'squareup.com',
  'square.site',
  'razorpay.com',
  'payfast.co.za',
  '2checkout.com',
  'worldpay.com',
  'authorize.net',
  'klarna.com',
  'affirm.com',
  'mollie.com',
  'paddle.com',
  'lemonsqueezy.com',
  'jazzcash.com.pk',
  'easypaisa.com.pk',
];

/**
 * `<input>` types we will capture. Everything not on this list is refused,
 * including `password`, `number`, `hidden`, `date` and the button types.
 *
 * An `<input>` with no `type` attribute at all behaves as `text`, so the
 * caller normalises a missing type to `text` before checking.
 */
export const CAPTURABLE_INPUT_TYPES: readonly string[] = [
  'text',
  'search',
  'email',
  'url',
  'tel',
];
