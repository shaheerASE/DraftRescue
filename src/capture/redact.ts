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

/** Card-shaped: 13 to 19 digits, and the checksum has to agree. */
function redactCardNumbers(input: string): RedactionResult {
  let count = 0;
  const text = input.replace(DIGIT_RUN, (match) => {
    const digits = match.replace(/[^0-9]/g, '');
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhn(digits)) return match;
    count++;
    return REDACTED;
  });
  return { text, count };
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
  let count = 0;
  const text = input.replace(CNIC, () => {
    count++;
    return REDACTED;
  });
  return { text, count };
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
