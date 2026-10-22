import { describe, expect, it } from 'vitest';
import { SIGNATURE_PROTOCOLS } from '../src/castle/assets/manifest.js';
import { CATEGORY_LORE, LORE_SHARE, PROTOCOL_LORE, Storyteller, loreFor, pickLore } from '../src/castle/world/lore.js';

describe('the townsfolk’s lore', () => {
  it('every signature protocol and every kind of building has two or three short lines', () => {
    const all = [...Object.keys(SIGNATURE_PROTOCOLS).map((id) => PROTOCOL_LORE[id]), ...['lending', 'dex', 'staking', 'nft', 'governance', 'bridge', 'other'].map((c) => CATEGORY_LORE[c])];
    for (const [i, lines] of all.entries()) {
      expect(lines, `lore ${i}`).toBeDefined();
      expect(lines!.length).toBeGreaterThanOrEqual(2);
      expect(lines!.length).toBeLessThanOrEqual(3);
      // a bubble holds it
      for (const l of lines!) expect(l.length, l).toBeLessThanOrEqual(70);
    }
    expect(Object.keys(PROTOCOL_LORE).sort()).toEqual(Object.keys(SIGNATURE_PROTOCOLS).sort());
  });

  it('a protocol’s person knows its family’s lore, else its kind of building’s', () => {
    expect(loreFor('aave-v3', 'lending')).toBe(PROTOCOL_LORE.aave);
    expect(loreFor('cow-protocol', 'dex')).toBe(PROTOCOL_LORE.cow);
    expect(loreFor('some-new-dex', 'dex')).toBe(CATEGORY_LORE.dex);
    expect(loreFor(null, 'mystery')).toEqual([]);
  });

  it('never picks the last line again when there is another', () => {
    const lines = ['a', 'b', 'c'];
    expect(pickLore(lines, 0, null)).toBe('a');
    expect(pickLore(lines, 0, 'a')).toBe('b');
    expect(pickLore(lines, 0.99, 'c')).toBe('b');
    expect(pickLore(['only'], 0.5, 'only')).toBe('only');
    expect(pickLore([], 0.5, null)).toBeNull();
  });

  it('one tapped line in four is lore, never the same twice running; untapped talk is chatter', () => {
    const teller = new Storyteller();
    const who = { trade: 'lending', protocolId: 'aave-v3' };
    const chatter = () => 'gm';
    expect(teller.say(who, false, chatter, 0)).toBe('gm');
    expect(teller.say(who, true, chatter, LORE_SHARE)).toBe('gm');
    expect(teller.say({ trade: 'lending' }, true, chatter, 0)).toBe('gm'); // no building of their own
    const first = teller.say(who, true, chatter, 0, 0);
    expect(PROTOCOL_LORE.aave).toContain(first);
    // the same roll again: another line, and never one line twice running
    let last = first;
    for (let k = 0; k < 20; k++) {
      const next = teller.say(who, true, chatter, 0, (k % 3) / 3);
      expect(next).not.toBe(last);
      last = next;
    }
  });
});
