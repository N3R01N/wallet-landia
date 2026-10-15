import { describe, expect, it } from 'vitest';
import { DESKTOP_MIN_WIDTH, closeSheet, initialShell, isTab, layoutFor, openSheet, selectTab } from '../src/castle/shellState.js';

describe('castle shell state', () => {
  it('starts on the castle with no sheet', () => {
    expect(initialShell()).toEqual({ tab: 'castle', sheet: null });
    expect(initialShell('guild').tab).toBe('guild');
  });

  it('opening a sheet keeps the tab; switching tabs closes it', () => {
    const open = openSheet(initialShell('guild'), { id: 'building:dex', title: 'Market' });
    expect(open.tab).toBe('guild');
    expect(open.sheet?.id).toBe('building:dex');
    expect(selectTab(open, 'badges')).toEqual({ tab: 'badges', sheet: null });
  });

  it('selecting the current tab changes nothing (keeps an open sheet)', () => {
    const open = openSheet(initialShell('guild'), { id: 'building:dex', title: 'Market' });
    expect(selectTab(open, 'guild')).toBe(open);
  });

  it('closing with no sheet returns the same state', () => {
    const s = initialShell();
    expect(closeSheet(s)).toBe(s);
    expect(closeSheet(openSheet(s, { id: 'x', title: 'X' }))).toEqual(s);
  });

  it('phones below the desktop width, desktops from it up', () => {
    expect(layoutFor(390)).toBe('phone');
    expect(layoutFor(DESKTOP_MIN_WIDTH - 1)).toBe('phone');
    expect(layoutFor(DESKTOP_MIN_WIDTH)).toBe('desktop');
    expect(layoutFor(1920)).toBe('desktop');
  });

  it('recognises tab ids only', () => {
    expect(isTab('castle')).toBe(true);
    expect(isTab('realms')).toBe(false);
    // the town is part of the castle's scene now, not a tab of its own
    expect(isTab('town')).toBe(false);
  });
});

describe('the castle’s stylesheets', () => {
  // a missing brace swallows every rule after it without an error (it happened once: the build-mode bar lost its styles)
  it.each(['src/castle/shell.css', 'src/castle/assets.css'])('%s has balanced braces', async (file) => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    for (const ch of css) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});
