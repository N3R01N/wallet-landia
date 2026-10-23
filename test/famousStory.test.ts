/**
 * A famous castle's story: its file is untrusted (parsed defensively), the
 * messages come from transaction data (decoded, addresses shortened), and
 * with the Poly Network exploiter's snapshot the places, beats and haul add up.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inputText, parseFamousStory, shortenAddresses } from '../src/data/famous.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';
import { buildGuild } from '../src/domain/mappers.js';
import { worldFromGuild } from '../src/castle/world/world.js';
import { haulAt, storyBeats } from '../src/castle/storyTour.js';

const hex = (s: string) => `0x${Buffer.from(s, 'utf8').toString('hex')}`;
const A = '0x71fb9db587f6d47ac8192cd76110e05b8fd2142f';
const H = `0x${'ab'.repeat(32)}`;

describe('a story file', () => {
  it('keeps well-formed places, beats and messages, and drops the rest', () => {
    const s = parseFamousStory({
      labels: [
        { address: A.toUpperCase().replace('0X', '0x'), id: 'poly-multisig', name: 'Multisig', category: 'governance' },
        { address: 'nope', id: 'x', name: 'X', category: 'governance' },
        { address: A, id: 'Bad Id', name: 'X', category: 'governance' },
        { address: A, id: 'y', name: 'Y', category: 'castle' },
      ],
      beats: [
        { hash: H, title: 'The trick', text: 'It happened.', effect: 'hack', place: 'poly-network' },
        { hash: 'not a hash', title: 'x', text: 'y' },
        { hash: H, title: 'No effect', text: 'z', effect: 'explode' },
      ],
      notes: [{ hash: H, text: 'HELLO' }, { hash: H.slice(0, 10), text: 'short hash' }],
      crowd: [{ at: 1, text: 'hi' }, { at: 'x', text: 'no time' }],
    });
    expect([...s.labels]).toEqual([[A, { id: 'story:poly-multisig', name: 'Multisig', category: 'governance' }]]);
    expect(s.beats).toEqual([
      { hash: H, title: 'The trick', text: 'It happened.', effect: 'hack', place: 'story:poly-network' },
      { hash: H, title: 'No effect', text: 'z' },
    ]);
    expect([...s.notes]).toEqual([[H, 'HELLO']]);
    expect(s.crowd).toEqual([{ at: 1, text: 'hi' }]);
    expect(parseFamousStory(null)).toEqual({ labels: new Map(), beats: [], notes: new Map(), crowd: [] });
  });
});

describe('messages in transaction data', () => {
  it('reads words, not contract calls or binary; encrypted ones say so', () => {
    expect(inputText(hex('READY TO RETURN THE FUND!'))).toBe('READY TO RETURN THE FUND!');
    expect(inputText('0x095ea7b3000000000000000000000000bebc44782c7db0a1a60cb6fe97d0b483032ff1c7')).toBeNull();
    expect(inputText('0x')).toBeNull();
    expect(inputText(undefined)).toBeNull();
    expect(inputText(hex('{"iv":"be1f","ciphertext":"d8d6"}'))).toBe('(an encrypted message)');
    expect(inputText(hex('ab'.repeat(40)))).toBe('(an encrypted message)');
  });

  it('shortens addresses so they read but cannot be copied to send money to', () => {
    expect(shortenAddresses('DONATE TO 0xA87fB85A93Ca072Cd4e5F0D4f178Bc831Df8a00B IF YOU SUPPORT')).toBe('DONATE TO 0xA87f…a00B IF YOU SUPPORT');
    expect(inputText(hex(`MULTISIG ${A}`))).toBe('MULTISIG 0x71fb…142f');
  });
});

describe('the Poly Network exploiter’s story', () => {
  const dir = new URL('../public/famous/', import.meta.url);
  const raw = JSON.parse(readFileSync(new URL('0xc8a65fadf0e0ddaf421f28feab69bf6e2e589963.json', dir), 'utf8')) as RawWallet;
  const story = parseFamousStory(JSON.parse(readFileSync(new URL('0xc8a65fadf0e0ddaf421f28feab69bf6e2e589963.story.json', dir), 'utf8')));
  const world = worldFromGuild(buildGuild([raw], { kind: 'count', count: 5000 }, { labels: story.labels }));
  const categories = new Map([...story.labels.values()].map((l) => [l.id, l.category]));

  it('the robbed bridge and the multisigs stand in town, and the couriers go to them', () => {
    const ids = world.protocols.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['story:poly-network', 'story:poly-multisig', 'story:shared-multisig']));
    expect(world.errands.filter((e) => e.protocolId === 'story:poly-network').length).toBeGreaterThanOrEqual(10);
  });

  it('every beat is a transaction in town, in order; every message has its transaction', () => {
    const beats = storyBeats(story.beats, world.errands);
    expect(beats).toHaveLength(story.beats.length);
    expect(beats.map((b) => b.title)[0]).toBe('The first coins');
    const hashes = new Set(world.errands.map((e) => e.hash.toLowerCase()));
    expect([...story.notes.keys()].every((h) => hashes.has(h))).toBe(true);
    expect(story.notes.size).toBeGreaterThan(50);
  });

  it('about $273.6M was taken and about $234.5M given back', () => {
    const { taken, back } = haulAt(world.errands, 'story:poly-network', categories, Infinity);
    expect(taken / 1e6).toBeCloseTo(273.6, 0);
    expect(back / 1e6).toBeCloseTo(234.5, 0);
    expect(haulAt(world.errands, 'story:poly-network', categories, Date.parse('2021-08-10T00:00:00Z'))).toEqual({ taken: 0, back: 0 });
  });

  it('no message keeps a full address', () => {
    const texts = [...story.notes.values(), ...story.crowd.map((c) => c.text)];
    expect(texts.some((t) => /0x[0-9a-f]{40}/i.test(t))).toBe(false);
  });
});
