import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreInto } from './restore';

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * A faithful miniature of React's input value tracking.
 *
 * Lifted in structure from ReactDOM's inputValueTracking: React installs a
 * getter/setter pair on the ELEMENT INSTANCE, shadowing the prototype's, and
 * keeps a private record of the last value it knows about. When an `input`
 * event arrives it compares that record against the field's current value, and
 * treats them being equal as "nothing changed" — so onChange never fires.
 *
 * Reproducing it here rather than pulling in React keeps the test fast and, more
 * usefully, makes the mechanism visible: the bug is four lines long and this is
 * the four lines.
 */
function makeReactLikeInput(): {
  el: HTMLTextAreaElement;
  changes: string[];
} {
  const el = document.createElement('textarea');
  document.body.appendChild(el);

  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el) as object,
    'value',
  );
  if (!descriptor?.get || !descriptor?.set) throw new Error('no value descriptor to shadow');

  let knownValue = String(el.value);
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() {
      return descriptor.get!.call(this);
    },
    set(next: string) {
      knownValue = String(next);
      descriptor.set!.call(this, next);
    },
  });

  // React's onChange, in essence.
  const changes: string[] = [];
  el.addEventListener('input', () => {
    const current = descriptor.get!.call(el) as string;
    if (knownValue === current) return; // React drops the event here
    knownValue = current;
    changes.push(current);
  });

  return { el, changes };
}

describe('restoreInto — plain fields', () => {
  it('sets the value of a textarea', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const el = document.getElementById('t') as HTMLTextAreaElement;

    const result = restoreInto(el, 'textarea', 'my recovered draft');

    expect(result).toMatchObject({ ok: true, method: 'native-setter' });
    expect(el.value).toBe('my recovered draft');
  });

  it('sets the value of a text input', () => {
    document.body.innerHTML = '<input id="i" type="text">';
    const el = document.getElementById('i') as HTMLInputElement;

    expect(restoreInto(el, 'input', 'a recovered title')).toMatchObject({ ok: true });
    expect(el.value).toBe('a recovered title');
  });

  it('replaces existing text rather than appending', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const el = document.getElementById('t') as HTMLTextAreaElement;
    el.value = 'something already here';

    restoreInto(el, 'textarea', 'the restored draft');
    expect(el.value).toBe('the restored draft');
  });

  it('fires an input event so the page notices', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const el = document.getElementById('t') as HTMLTextAreaElement;
    const seen = vi.fn();
    el.addEventListener('input', seen);

    restoreInto(el, 'textarea', 'text that the page should see');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('fires a change event too, for sites that only listen for that', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const el = document.getElementById('t') as HTMLTextAreaElement;
    const seen = vi.fn();
    el.addEventListener('change', seen);

    restoreInto(el, 'textarea', 'text that the page should see');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('leaves the caret at the end, where typing should continue', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const el = document.getElementById('t') as HTMLTextAreaElement;

    const text = 'a restored draft';
    restoreInto(el, 'textarea', text);
    expect(el.selectionStart).toBe(text.length);
  });

  it('bubbles the event, so a delegated listener on document sees it', () => {
    document.body.innerHTML = '<form><textarea id="t"></textarea></form>';
    const el = document.getElementById('t') as HTMLTextAreaElement;
    const seen = vi.fn();
    document.addEventListener('input', seen);

    restoreInto(el, 'textarea', 'text the page should see');
    document.removeEventListener('input', seen);

    expect(seen).toHaveBeenCalled();
  });
});

describe('restoreInto — a React-controlled input', () => {
  // The reason restore.ts reaches for the prototype's setter. Without this the
  // box shows the right text and the app submits the old value.
  it('the naive approach silently fails to notify the framework', () => {
    const { el, changes } = makeReactLikeInput();

    // What you would write first: assign, then fire an event.
    el.value = 'restored the naive way';
    el.dispatchEvent(new Event('input', { bubbles: true }));

    expect(el.value).toBe('restored the naive way'); // looks fine
    expect(changes).toEqual([]); // and the app never heard about it
  });

  it('restoreInto does notify the framework', () => {
    const { el, changes } = makeReactLikeInput();

    const result = restoreInto(el, 'textarea', 'restored properly');

    expect(result).toMatchObject({ ok: true, method: 'native-setter' });
    expect(el.value).toBe('restored properly');
    expect(changes).toEqual(['restored properly']);
  });

  it('works a second time, on a field the framework has since re-rendered', () => {
    const { el, changes } = makeReactLikeInput();

    restoreInto(el, 'textarea', 'first restore attempt');
    restoreInto(el, 'textarea', 'second restore attempt');

    expect(changes).toEqual(['first restore attempt', 'second restore attempt']);
  });
});

describe('restoreInto — contenteditable', () => {
  it('puts the text into the editor', () => {
    document.body.innerHTML = '<div id="e" contenteditable="true"></div>';
    const el = document.getElementById('e') as HTMLElement;

    const result = restoreInto(el, 'contenteditable', 'a restored rich draft');

    expect(result.ok).toBe(true);
    expect(el.textContent).toBe('a restored rich draft');
  });

  it('replaces what is already there', () => {
    document.body.innerHTML = '<div id="e" contenteditable="true">old content</div>';
    const el = document.getElementById('e') as HTMLElement;

    restoreInto(el, 'contenteditable', 'the new content');
    expect(el.textContent).toBe('the new content');
  });

  it('fires an input event', () => {
    document.body.innerHTML = '<div id="e" contenteditable="true"></div>';
    const el = document.getElementById('e') as HTMLElement;
    const seen = vi.fn();
    el.addEventListener('input', seen);

    restoreInto(el, 'contenteditable', 'a restored rich draft');
    expect(seen).toHaveBeenCalled();
  });

  it('says so when it had to fall back to something unreliable', () => {
    // No execCommand in this environment, so the fallback runs — and the result
    // has to admit it, because a rich editor will discard that write.
    // The execCommand path itself is covered by scripts/smoke.mjs in a real
    // browser, which is the only place it exists.
    document.body.innerHTML = '<div id="e" contenteditable="true"></div>';
    const el = document.getElementById('e') as HTMLElement;

    const result = restoreInto(el, 'contenteditable', 'a restored rich draft');

    if (result.method === 'text-content') {
      expect(result.note).toMatch(/discard/);
    } else {
      expect(result.method).toBe('exec-command');
    }
  });
});

describe('restoreInto — awkward input', () => {
  it('restores an empty string without throwing', () => {
    document.body.innerHTML = '<textarea id="t">something</textarea>';
    const el = document.getElementById('t') as HTMLTextAreaElement;
    el.value = 'something';

    expect(restoreInto(el, 'textarea', '')).toMatchObject({ ok: true });
    expect(el.value).toBe('');
  });

  it('preserves newlines', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const el = document.getElementById('t') as HTMLTextAreaElement;

    restoreInto(el, 'textarea', 'line one\nline two\n\nline four');
    expect(el.value).toBe('line one\nline two\n\nline four');
  });

  it('handles a long draft', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const el = document.getElementById('t') as HTMLTextAreaElement;
    const long = 'x'.repeat(100_000);

    expect(restoreInto(el, 'textarea', long)).toMatchObject({ ok: true });
    expect(el.value).toHaveLength(100_000);
  });
});
