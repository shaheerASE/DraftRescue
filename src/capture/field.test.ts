import { beforeEach, describe, expect, it } from 'vitest';
import type { FieldSignals } from '../shared/types';
import {
  buildSignals,
  domPath,
  fieldKeyFor,
  looksGenerated,
  normalizePathname,
  readFieldText,
  resolveField,
} from './field';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('resolveField', () => {
  it('returns the textarea from a path that starts at it', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const el = document.getElementById('t')!;
    expect(resolveField([el, document.body, document])).toBe(el);
  });

  it('walks past inner nodes to the contenteditable host', () => {
    // What a real editor's path looks like: the user types inside a <span> the
    // editor created, which does not carry the attribute itself.
    document.body.innerHTML =
      '<div id="editor" contenteditable="true"><p id="p"><span id="s">hi</span></p></div>';
    const span = document.getElementById('s')!;
    const p = document.getElementById('p')!;
    const editor = document.getElementById('editor')!;

    expect(resolveField([span, p, editor, document.body])).toBe(editor);
  });

  it('ignores non-element entries such as document and window', () => {
    document.body.innerHTML = '<input id="i">';
    const el = document.getElementById('i')!;
    expect(resolveField([el, document.body, document, window])).toBe(el);
  });

  it('returns null when the path holds nothing capturable', () => {
    document.body.innerHTML = '<div id="d"><span id="s">x</span></div>';
    expect(
      resolveField([document.getElementById('s')!, document.getElementById('d')!]),
    ).toBeNull();
  });

  it('finds a field inside an open shadow root', () => {
    // The whole point of composedPath: from the page's perspective the event
    // target would be <my-widget>, not the textarea.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<textarea></textarea>';
    const inner = root.querySelector('textarea')!;

    expect(resolveField([inner, root, host, document.body])).toBe(inner);
  });
});

describe('readFieldText', () => {
  it('reads a textarea value', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const el = document.getElementById('t') as HTMLTextAreaElement;
    el.value = 'hello';
    expect(readFieldText(el, 'textarea')).toBe('hello');
  });

  it('reads an input value', () => {
    document.body.innerHTML = '<input id="i">';
    const el = document.getElementById('i') as HTMLInputElement;
    el.value = 'world';
    expect(readFieldText(el, 'input')).toBe('world');
  });

  it('reads contenteditable text', () => {
    document.body.innerHTML = '<div id="e" contenteditable>some draft</div>';
    expect(readFieldText(document.getElementById('e')!, 'contenteditable')).toContain(
      'some draft',
    );
  });
});

describe('looksGenerated', () => {
  it.each([
    ':r1a:',
    'radix-:r3:',
    'mui-4821',
    'headlessui-input-12',
    'input-48213',
    'a1b2c3d4e5',
    '7f3a9b2c-1d4e-4a5b-8c9d-0e1f2a3b4c5d',
    'x9f8e7d6c5',
    'V1StGXR8_Z5jdHi6BmyT', // nanoid
    'field_20240315', // a date used as an id
  ])('treats %s as generated', (value) => {
    expect(looksGenerated(value)).toBe(true);
  });

  it.each([
    'cover_letter',
    'coverLetter',
    'message',
    'post_title',
    'comment-body',
    'proposal',
    'description',
    'email',
    'search',
  ])('treats %s as meaningful', (value) => {
    expect(looksGenerated(value)).toBe(false);
  });

  it('treats an empty id as generated, so it is never used as identity', () => {
    expect(looksGenerated('')).toBe(true);
  });
});

describe('normalizePathname', () => {
  it.each([
    ['/proposals/12345', '/proposals/:id'],
    ['/r/reactjs/comments/1a2b3c/title', '/r/reactjs/comments/1a2b3c/title'],
    ['/users/7f3a9b2c-1d4e-4a5b-8c9d-0e1f2a3b4c5d/edit', '/users/:uuid/edit'],
    ['/jobs/apply', '/jobs/apply'],
    ['/', '/'],
    ['/issue/PROJ-4821', '/issue/:id'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePathname(input)).toBe(expected);
  });

  it('makes two instances of the same page shape agree', () => {
    expect(normalizePathname('/proposals/111')).toBe(normalizePathname('/proposals/222'));
  });
});

describe('domPath', () => {
  it('describes position by tag and index among same-tag siblings', () => {
    document.body.innerHTML =
      '<div><p>a</p><p>b</p><textarea id="t"></textarea></div>';
    const path = domPath(document.getElementById('t')!);
    expect(path).toContain('textarea:nth-of-type(1)');
    expect(path).toContain('div:nth-of-type(1)');
  });

  it('distinguishes siblings of the same tag', () => {
    document.body.innerHTML =
      '<div><textarea id="a"></textarea><textarea id="b"></textarea></div>';
    expect(domPath(document.getElementById('a')!)).not.toBe(
      domPath(document.getElementById('b')!),
    );
  });

  it('crosses out of a shadow root through its host', () => {
    const host = document.createElement('section');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<textarea></textarea>';

    const path = domPath(root.querySelector('textarea')!);
    expect(path).toContain('textarea');
    expect(path).toContain('section');
  });

  it('respects the depth cap', () => {
    let html = '<textarea id="deep"></textarea>';
    for (let i = 0; i < 30; i++) html = `<div>${html}</div>`;
    document.body.innerHTML = html;

    const parts = domPath(document.getElementById('deep')!).split('>');
    expect(parts.length).toBeLessThanOrEqual(12);
  });
});

describe('buildSignals', () => {
  it('collects the identity signals off a labelled field', () => {
    document.body.innerHTML =
      '<label for="cl">Cover letter</label>' +
      '<textarea id="cl" name="coverLetter" placeholder="Why you?"></textarea>';

    const signals = buildSignals(document.getElementById('cl')!, 'textarea');

    expect(signals).toMatchObject({
      tagName: 'TEXTAREA',
      editorKind: 'textarea',
      fieldId: 'cl',
      fieldName: 'coverLetter',
      placeholder: 'Why you?',
      labelText: 'Cover letter',
      isTopFrame: true,
    });
    expect(signals.domPath).toContain('textarea');
  });

  it('reads a contenteditable data-placeholder, as Gmail and Slack use', () => {
    document.body.innerHTML =
      '<div id="e" contenteditable data-placeholder="Write something"></div>';
    expect(buildSignals(document.getElementById('e')!, 'contenteditable')).toMatchObject({
      placeholder: 'Write something',
      editorKind: 'contenteditable',
    });
  });

  it('omits absent signals rather than storing empty strings', () => {
    document.body.innerHTML = '<textarea id="bare"></textarea>';
    const signals = buildSignals(document.getElementById('bare')!, 'textarea');
    expect(signals.fieldName).toBeUndefined();
    expect(signals.ariaLabel).toBeUndefined();
    expect(signals.labelText).toBeUndefined();
  });
});

describe('fieldKeyFor', () => {
  function signals(overrides: Partial<FieldSignals> = {}): FieldSignals {
    return {
      origin: 'https://www.upwork.com',
      pathname: '/proposals/12345',
      isTopFrame: true,
      tagName: 'TEXTAREA',
      editorKind: 'textarea',
      domPath: 'body:nth-of-type(1)>form:nth-of-type(1)>textarea:nth-of-type(1)',
      fieldName: 'coverLetter',
      ...overrides,
    };
  }

  it('is stable for the same field', () => {
    expect(fieldKeyFor(signals())).toBe(fieldKeyFor(signals()));
  });

  it('survives a layout change when the field has a real name', () => {
    // The site restructured its markup. Same box, same label, new DOM path.
    expect(fieldKeyFor(signals())).toBe(
      fieldKeyFor(signals({ domPath: 'body:nth-of-type(1)>div:nth-of-type(3)>textarea:nth-of-type(1)' })),
    );
  });

  it('survives a change of numeric id in the URL', () => {
    expect(fieldKeyFor(signals())).toBe(
      fieldKeyFor(signals({ pathname: '/proposals/98765' })),
    );
  });

  it('ignores a generated id, which changes between builds', () => {
    expect(fieldKeyFor(signals({ fieldId: ':r1a:' }))).toBe(
      fieldKeyFor(signals({ fieldId: ':r7z:' })),
    );
  });

  it('separates different fields on the same page', () => {
    expect(fieldKeyFor(signals({ fieldName: 'coverLetter' }))).not.toBe(
      fieldKeyFor(signals({ fieldName: 'clientQuestion' })),
    );
  });

  it('separates the same field name on different sites', () => {
    expect(fieldKeyFor(signals())).not.toBe(
      fieldKeyFor(signals({ origin: 'https://www.fiverr.com' })),
    );
  });

  it('separates different pages of the same site', () => {
    expect(fieldKeyFor(signals({ pathname: '/proposals/1' }))).not.toBe(
      fieldKeyFor(signals({ pathname: '/messages/inbox' })),
    );
  });

  it('falls back to the DOM path when nothing identifies the field', () => {
    const anonymous = signals({ fieldName: undefined, fieldId: ':r1a:' });
    const moved = { ...anonymous, domPath: 'body:nth-of-type(1)>textarea:nth-of-type(2)' };

    expect(fieldKeyFor(anonymous)).not.toBe(fieldKeyFor(moved));
  });

  it('does not collide two anonymous textareas on one page', () => {
    const a = signals({
      fieldName: undefined,
      domPath: 'body:nth-of-type(1)>textarea:nth-of-type(1)',
    });
    const b = signals({
      fieldName: undefined,
      domPath: 'body:nth-of-type(1)>textarea:nth-of-type(2)',
    });
    expect(fieldKeyFor(a)).not.toBe(fieldKeyFor(b));
  });
});
