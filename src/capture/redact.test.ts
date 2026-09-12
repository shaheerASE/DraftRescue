import { describe, expect, it } from 'vitest';
import { luhn, redact, REDACTED } from './redact';

describe('luhn', () => {
  it.each([
    '4242424242424242', // Visa test number
    '4111111111111111',
    '5555555555554444', // Mastercard
    '378282246310005', // Amex, 15 digits
    '6011111111111117', // Discover
    '30569309025904', // Diners, 14 digits
    '3530111333300000', // JCB
  ])('accepts %s', (digits) => {
    expect(luhn(digits)).toBe(true);
  });

  it.each(['4242424242424241', '1234567890123456', '0000000000000001'])(
    'rejects %s',
    (digits) => {
      expect(luhn(digits)).toBe(false);
    },
  );

  it('rejects empty and non-numeric input', () => {
    expect(luhn('')).toBe(false);
    expect(luhn('42424242424242a2')).toBe(false);
  });
});

describe('redact — card numbers', () => {
  it.each([
    ['bare', 'my card is 4242424242424242 ok'],
    ['spaced', 'my card is 4242 4242 4242 4242 ok'],
    ['hyphenated', 'my card is 4242-4242-4242-4242 ok'],
    ['mixed separators', 'my card is 4242-4242 4242-4242 ok'],
    ['amex 15 digit', 'my card is 3782 822463 10005 ok'],
    ['diners 14 digit', 'my card is 3056 930902 5904 ok'],
  ])('redacts a %s card number', (_label, input) => {
    const result = redact(input);
    expect(result.text).toBe(`my card is ${REDACTED} ok`);
    expect(result.count).toBe(1);
  });

  it('redacts several in one string', () => {
    const result = redact('4242424242424242 and 5555555555554444');
    expect(result.text).toBe(`${REDACTED} and ${REDACTED}`);
    expect(result.count).toBe(2);
  });

  it('leaves a card-length number that fails the checksum alone', () => {
    const input = 'order number 4242424242424241 shipped';
    expect(redact(input).text).toBe(input);
  });
});

describe('redact — text that must survive untouched', () => {
  // A draft-saving extension that quietly eats ordinary numbers out of people's
  // writing is worse than one that saves nothing.
  it.each([
    'I earned 45000 rupees in 2024 from 12 clients.',
    'Call me on 0300 1234567 any time.',
    'My number is +92 300 1234567.',
    'Invoice 2024-11-04 for 1500 USD.',
    'The build finished in 1234 ms across 5678 files.',
    'Version 1.2.3 shipped on 2024-03-15.',
    'Order #A1234567 arrives Tuesday.',
    'Rooms 101, 102 and 103 are free.',
    'It cost 1,299.99 including tax.',
    'Between 1990 and 2024 the figure rose from 100 to 20000.',
  ])('leaves %s alone', (input) => {
    const result = redact(input);
    expect(result.text).toBe(input);
    expect(result.count).toBe(0);
  });

  it('leaves an empty string alone', () => {
    expect(redact('')).toEqual({ text: '', count: 0 });
  });

  it('leaves ordinary prose alone', () => {
    const input = 'Dear hiring manager,\n\nI am writing about the role.\n';
    expect(redact(input).text).toBe(input);
  });
});

describe('redact — CNIC', () => {
  it.each([
    'my cnic is 42101-1234567-1 thanks',
    'my cnic is 42101 1234567 1 thanks',
    'my cnic is 4210112345671 thanks',
  ])('redacts %s', (input) => {
    const result = redact(input);
    expect(result.text).toBe('my cnic is [redacted] thanks');
    expect(result.count).toBe(1);
  });

  it('does not swallow a shorter or longer number', () => {
    expect(redact('id 421011234567 here').text).toBe('id 421011234567 here'); // 12
    expect(redact('id 42101123456712 here').text).toBe('id 42101123456712 here'); // 14
  });
});

describe('redact — combined', () => {
  it('handles a draft containing both, and counts them', () => {
    const result = redact(
      'Please charge 4242 4242 4242 4242 and my cnic is 42101-1234567-1.',
    );
    expect(result.text).toBe(
      `Please charge ${REDACTED} and my cnic is ${REDACTED}.`,
    );
    expect(result.count).toBe(2);
  });

  it('preserves surrounding whitespace and line structure', () => {
    const result = redact('line one\n4242424242424242\nline three');
    expect(result.text).toBe(`line one\n${REDACTED}\nline three`);
  });
});
