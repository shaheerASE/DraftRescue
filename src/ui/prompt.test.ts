import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRestorePrompt, UI_MARKER, type RestorePrompt } from './prompt';

/**
 * Structure and behaviour only. Positioning needs real layout — getBoundingClientRect
 * returns zeros here — so where the pill lands, and whether it follows the field
 * on scroll, is checked in a real browser by scripts/smoke-prompt.mjs.
 */

let prompt: RestorePrompt;

const DRAFT = 'the draft this pill is offering back';

function field(html = '<textarea id="f"></textarea>'): Element {
  document.body.innerHTML = html;
  return document.getElementById('f')!;
}

function pill(): HTMLButtonElement | null {
  return prompt.shadowRoot()?.querySelector('button.pill') ?? null;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.querySelectorAll(`[${UI_MARKER}]`).forEach((el) => el.remove());
  prompt = createRestorePrompt();
});

afterEach(() => {
  prompt.destroy();
});

describe('createRestorePrompt — structure', () => {
  it('mounts nothing until it is shown', () => {
    expect(document.querySelector(`[${UI_MARKER}]`)).toBeNull();
  });

  it('mounts a host carrying the marker our capture gate looks for', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    // Without this attribute, shouldCapture would treat our own UI as a page
    // field and we would capture ourselves.
    expect(document.querySelector(`[${UI_MARKER}]`)).not.toBeNull();
  });

  it('uses an OPEN shadow root, so it can be inspected and tested', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    const host = document.querySelector(`[${UI_MARKER}]`) as HTMLElement;

    // A closed root would make this null, and every styling bug in here would
    // have to be debugged blind.
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot).toBe(prompt.shadowRoot());
  });

  it('carries its own styles inside the shadow root', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    const style = prompt.shadowRoot()?.querySelector('style');
    expect(style?.textContent).toContain('.pill');
    // Font and colour inherit through a shadow boundary even though selectors
    // do not, so they have to be stated outright.
    expect(style?.textContent).toContain('font:');
    expect(style?.textContent).toContain('color:');
  });

  it('renders a real button, not a clickable div', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    expect(pill()?.tagName).toBe('BUTTON');
    expect(pill()?.type).toBe('button');
  });
});

describe('createRestorePrompt — the label', () => {
  it('says how old the draft is', () => {
    prompt.show(field(), Date.now() - 2 * 60 * 1000, DRAFT, () => {});
    expect(pill()?.textContent).toContain('Restore draft');
    expect(pill()?.textContent).toContain('2m ago');
  });

  it('gives screen readers a full sentence, not just the visible text', () => {
    prompt.show(field(), Date.now() - 5 * 60 * 1000, DRAFT, () => {});
    expect(pill()?.getAttribute('aria-label')).toBe('Restore the draft saved 5m ago');
  });

  it('hides the decorative icon from assistive technology', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    expect(prompt.shadowRoot()?.querySelector('.icon')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('shows what it will restore, not just when it was saved', () => {
    // Without this the pill asks for a click on an unknown quantity, and the
    // first thought on seeing the result is "did it pick the wrong draft?".
    const text = 'Dear hiring manager, I am writing about';
    prompt.show(field(), Date.now(), text, () => {});
    const title = pill()?.title ?? '';
    expect(title).toContain('Dear hiring manager');
    expect(title).toContain(`${text.length} characters`);
  });

  it('truncates a long preview rather than filling the screen', () => {
    prompt.show(field(), Date.now(), 'x'.repeat(500), () => {});
    expect((pill()?.title ?? '').length).toBeLessThan(300);
  });

  it('collapses newlines in the preview so the tooltip stays compact', () => {
    prompt.show(field(), Date.now(), 'line one\n\n\nline two', () => {});
    expect(pill()?.title).toContain('line one line two');
  });

  it('updates the label when offered for a different field', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    expect(pill()?.textContent).toContain('just now');

    prompt.show(field('<textarea id="f"></textarea>'), Date.now() - 3 * 3600 * 1000, DRAFT, () => {});
    expect(pill()?.textContent).toContain('3h ago');
  });
});

describe('createRestorePrompt — activation', () => {
  it('does NOT restore on its own', () => {
    // Never auto-restore. Showing the offer must not change the page.
    const onActivate = vi.fn();
    prompt.show(field(), Date.now(), DRAFT, onActivate);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('restores when clicked', () => {
    const onActivate = vi.fn();
    prompt.show(field(), Date.now(), DRAFT, onActivate);

    pill()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('cancels mousedown, so clicking does not blur the field', () => {
    // If the field lost focus, a rich editor would lose its selection and
    // execCommand would have nowhere to insert.
    prompt.show(field(), Date.now(), DRAFT, () => {});

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    pill()?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('hides itself after being clicked', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    pill()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(prompt.anchor()).toBeNull();
  });

  it('does not fire twice if clicked again after hiding', () => {
    const onActivate = vi.fn();
    prompt.show(field(), Date.now(), DRAFT, onActivate);

    pill()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    pill()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('does not let the click reach the page underneath', () => {
    const onPageClick = vi.fn();
    document.addEventListener('click', onPageClick);
    prompt.show(field(), Date.now(), DRAFT, () => {});

    pill()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.removeEventListener('click', onPageClick);

    expect(onPageClick).not.toHaveBeenCalled();
  });
});

describe('createRestorePrompt — lifecycle', () => {
  it('reports which field it is offering for', () => {
    const el = field();
    prompt.show(el, Date.now(), DRAFT, () => {});
    expect(prompt.anchor()).toBe(el);
  });

  it('forgets the field when hidden', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    prompt.hide();
    expect(prompt.anchor()).toBeNull();
  });

  it('survives hide being called when nothing is showing', () => {
    expect(() => prompt.hide()).not.toThrow();
  });

  it('removes itself from the page on destroy', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    prompt.destroy();
    expect(document.querySelector(`[${UI_MARKER}]`)).toBeNull();
  });

  it('survives destroy being called twice', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    prompt.destroy();
    expect(() => prompt.destroy()).not.toThrow();
  });

  it('reuses one host across several fields rather than piling them up', () => {
    prompt.show(field(), Date.now(), DRAFT, () => {});
    prompt.show(field(), Date.now(), DRAFT, () => {});
    prompt.show(field(), Date.now(), DRAFT, () => {});
    expect(document.querySelectorAll(`[${UI_MARKER}]`)).toHaveLength(1);
  });
});
