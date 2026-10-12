import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';
import { landFor, planFromLayout, rememberProtocols, suggestedLayout, type Known } from '../src/world/townLayout.js';
import { applyDesign, decodeShare, encodeShare, makeShare, parseShareText, shareInHash, shareText, visitLayout, type ShareInput } from '../src/world/townShare.js';

const demoDir = resolve(__dirname, '../fixtures/demo');
const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);
const g0 = buildGuild(demo);
const known: Known = {};
const guild = rememberProtocols(g0, known).guild;
const layout = suggestedLayout(guild);
const wallets = [...guild.heroes].map((h) => h.address).sort();
const [pub, priv] = [wallets[0]!, wallets.slice(1)];

const input = (over: Partial<ShareInput> = {}): ShareInput => ({
  mode: 'town',
  realm: 'ethereum',
  land: { w: 32, h: 24 },
  theme: 'medieval',
  layout,
  guild,
  known,
  publicWallets: [pub],
  names: { [pub]: 'Sir Share~a|lot;' },
  classes: { [pub]: 'merchant' },
  titles: { [pub]: 'the Barterer' },
  crests: { [pub]: ['#3366cc', '#e6e4de'] },
  ...over,
});

describe('sharing a town', () => {
  it('round trips through a short link', async () => {
    const s = makeShare(input());
    const payload = await encodeShare(s);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload.length).toBeLessThan(shareText(s).length);
    expect(await decodeShare(payload)).toEqual(s);
    expect(shareInHash(`#town=${payload}`)).toEqual({ mode: 'town', payload });
    expect(shareInHash('#something')).toBeNull();
  });

  it('never carries a private wallet: its home is a shuttered estate, and what only it brought is left out', async () => {
    const s = makeShare(input());
    const text = shareText(s);
    for (const a of priv) expect(text).not.toContain(a.slice(2));
    expect(s.heroes.map((h) => h.address)).toEqual([pub]);
    expect(s.buildings.filter((b) => b.ref === 's')).toHaveLength(priv.length);
    // every protocol building shared was brought by the public wallet
    for (const b of s.buildings.filter((x) => x.kind !== 'home')) expect(known[b.ref]?.by).toContain(pub);
    const onlyPrivate = Object.entries(known).filter(([, k]) => !(k.by ?? []).includes(pub)).map(([id]) => id);
    expect(onlyPrivate.length).toBeGreaterThan(0);
    for (const id of onlyPrivate) expect(s.buildings.some((b) => b.ref === id)).toBe(false);
  });

  it('with every wallet private, a town shares no one and no building: only shuttered estates', () => {
    const s = makeShare(input({ publicWallets: [] }));
    expect(s.heroes).toEqual([]);
    expect(s.buildings.every((b) => b.ref === 's')).toBe(true);
  });

  it('a design names no one: its homes are numbered, and it holds the whole town (tied to no wallet)', () => {
    const s = makeShare(input({ mode: 'design', publicWallets: [] }));
    expect(s.buildings.length).toBe(layout.placed.length);
    expect(s.heroes).toEqual([]);
    expect(s.buildings.filter((b) => b.kind === 'home').map((b) => b.ref)).toEqual(wallets.map((_, i) => `h${i}`));
    for (const a of wallets) expect(shareText(s)).not.toContain(a.slice(2));
  });

  it('refuses what is not a town link, in plain words', async () => {
    expect(() => parseShareText('nope')).toThrow(/not a Wallet-landia town/);
    expect(() => parseShareText('wl1|t|ethereum|32x24||uni~bank~99.1.0|')).toThrow(/off the map/);
    expect(() => parseShareText('wl1|t|ethereum|32x24||uni~castle~1.1.0|')).toThrow(/unknown building/);
    expect(() => parseShareText('wl1|t|ethereum|32x24||h0~home~1.1.0|')).toThrow(/without its hero/);
    expect(() => parseShareText('wl1|d|ethereum|32x24|||0xabc~x~~~')).toThrow(/names no one/);
    expect(() => parseShareText('wl1|t|ethereum|32x24|||0xABC~x~~~')).toThrow(/address/);
    await expect(decodeShare('!!!')).rejects.toThrow(/damaged/);
  });
});

describe('using a shared design, visiting a shared town', () => {
  it('a design lays itself onto your town: what you may build takes its place, homes go to your homes in turn', () => {
    const design = makeShare(input({ mode: 'design', publicWallets: wallets }));
    const { layout: mine, placed, of } = applyDesign(design, guild);
    expect(placed).toBe(of);
    expect(planFromLayout(guild, mine).buildings.length - 3).toBe(placed);
    // someone with none of these protocols gets only the homes
    const stranger = { ...guild, protocols: new Map() };
    expect(applyDesign(design, stranger).placed).toBe(guild.heroes.length);
  });

  it('a shared town stands as shared, its private estates shuttered (homes with no hero)', () => {
    const s = makeShare(input());
    const { layout: l, extra } = visitLayout(s);
    const plan = planFromLayout(guild, l, extra);
    expect(plan.buildings.length - 3).toBe(s.buildings.length);
    const estates = plan.buildings.filter((b) => b.id.startsWith('estate:'));
    expect(estates).toHaveLength(priv.length);
    for (const e of estates) expect(e.heroAddress).toBeUndefined();
    expect(plan.homes.get(pub)?.kind).toBe('home');
  });

  it('fits the usual land', () => {
    expect(landFor(13).x1 - landFor(13).x0).toBe(32);
  });
});
