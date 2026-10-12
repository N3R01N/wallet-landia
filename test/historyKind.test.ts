import { describe, expect, it } from 'vitest';
import { historyKind } from '../src/ui/guildPanel.js';

describe('a wallet\'s history row shows where its walk back stands', () => {
  const open = { complete: false, capped: false };
  it('complete, whatever the walk is doing', () => {
    expect(historyKind({ complete: true, capped: false }, 'error')).toBe('done');
    expect(historyKind({ complete: true, capped: false }, null)).toBe('done');
  });
  it('capped is partial', () => {
    expect(historyKind({ complete: false, capped: true }, null)).toBe('partial');
  });
  it('running now is walking', () => {
    expect(historyKind(open, null)).toBe('walking');
  });
  it('an error or a refused key needs attention', () => {
    expect(historyKind(open, 'error')).toBe('problem');
    expect(historyKind(open, 'auth')).toBe('problem');
  });
  it('resting for any other reason is waiting', () => {
    for (const p of ['hidden', 'budget', 'done', 'stopped']) expect(historyKind(open, p)).toBe('waiting');
  });
});
