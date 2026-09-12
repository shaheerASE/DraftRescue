/**
 * The second safety layer: redaction of the captured text itself.
 *
 * shouldCapture decides whether a *field* is safe. This decides whether the
 * *text* is safe, and it runs on every capture regardless of what the field was
 * called. That independence is the point — someone pasting a card number into
 * an ordinary comment box is not something any amount of attribute-sniffing
 * will catch, and it is exactly the case that would end us.
 *
 * It also buys the gate some slack. should-capture.ts can afford not to refuse
 * every field with "card" in its name precisely because this net is underneath.
 */

export const REDACTED = '[redacted]';

export interface RedactionResult {
  text: string;
  /** How many spans were replaced. Zero means the text was untouched. */
  count: number;
}

/**
 * The Luhn checksum, the check digit scheme every payment card uses.
 *
 * It is what keeps this from redacting ordinary long numbers: an order ID or a
 * tracking number of the same length passes through untouched roughly nine
 * times out of ten, while a real card number never does.
 */
export function luhn(digits: string): boolean {
  if (digits.length === 0) return false;

  let sum = 0;
  let double = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    const code = digits.charCodeAt(i) - 48;
    if (code < 0 || code > 9) return false;

    let value = code;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }

  return sum % 10 === 0;
}

/**
 * Maximal runs of digits joined by at most one space or hyphen each.
 *
 * Written this way rather than as one clever pattern so the run is maximal by
 * construction: `4242 4242 4242 4242` is one match, not four.
 */
const DIGIT_RUN = /\d(?:[ -]?\d)*/g;

/**
 * Everything that can sit between two groups of digits and look like a space.
 *
 * This exists because a plain `[ -]` is not what reaches us. A contenteditable
 * turns typed spaces into non-breaking ones and `innerText` hands them back as
 * U+00A0, so `4242 4242 4242 4242` typed into Gmail arrives here with four
 * NBSPs in it and decomposes into four harmless 4-digit runs. Pasting a number
 * out of a rendered page, a statement or a PDF brings whatever separator that
 * document used — a figure space, a narrow NBSP, sometimes a zero-width joiner
 * left over from the markup.
 *
 * Matching is done against a copy with all of these folded to a plain space.
 * The fold is one character for one character, so the positions of the matches
 * are the positions in the original, and everything outside a match is copied
 * across untouched.
 */
const SEPARATOR_LIKE = /[\p{Zs}\u200b-\u200d\u2060\ufeff]/gu;

/**
 * Find matches in the normalised copy, cut them out of the original.
 *
 * Written once and shared because the card and CNIC passes need exactly the
 * same "match over there, replace over here" behaviour, and getting the offsets
 * wrong in one of them would be a silent leak rather than a visible bug.
 */
function replaceMatches(
  input: string,
  pattern: RegExp,
  accept: (match: string) => boolean,
): RedactionResult {
  const probe = input.replace(SEPARATOR_LIKE, ' ');

  let count = 0;
  let out = '';
  let taken = 0;

  for (const found of probe.matchAll(pattern)) {
    const match = found[0];
    const at = found.index;
    if (at === undefined || !accept(match)) continue;

    out += input.slice(taken, at) + REDACTED;
    taken = at + match.length;
    count++;
  }

  if (count === 0) return { text: input, count: 0 };
  return { text: out + input.slice(taken), count };
}

/** Card-shaped: 13 to 19 digits, and the checksum has to agree. */
function redactCardNumbers(input: string): RedactionResult {
  return replaceMatches(input, DIGIT_RUN, (match) => {
    const digits = match.replace(/[^0-9]/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    return luhn(digits);
  });
}

/**
 * Pakistani CNIC: five digits, seven digits, one check digit — `42101-1234567-1`.
 *
 * Separators are optional because people type it both ways, which means a bare
 * 13-digit run also matches. That is deliberate: a bare 13-digit number in
 * prose is almost always an identity number of some sort. The known collision
 * is a 13-digit ISBN typed without its hyphens, which we accept — a redacted
 * ISBN costs the user nothing they cannot retype.
 */
const CNIC = /(?<!\d)\d{5}[- ]?\d{7}[- ]?\d(?!\d)/g;

function redactCnic(input: string): RedactionResult {
  return replaceMatches(input, CNIC, () => true);
}

/**
 * Run every redaction rule over a string.
 *
 * Order matters: cards first, because a Luhn-valid 13-digit number is more
 * likely a card than a CNIC and we would rather label it the more dangerous of
 * the two.
 */
export function redact(input: string): RedactionResult {
  if (!input) return { text: input, count: 0 };

  const cards = redactCardNumbers(input);
  const cnics = redactCnic(cards.text);

  return { text: cnics.text, count: cards.count + cnics.count };
}
