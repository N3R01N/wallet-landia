/**
 * The drill-down panels: a hero's Character Sheet (their home) and a
 * building's interior. Approximate values live in the world; exact ones here.
 */

import { BUILDING_NAMES, CATEGORY_LABEL } from '../domain/catalog.js';
import { CLASS_LABEL, type Guild, type Hero, type HeroClass, type Item, type Journey } from '../domain/model.js';
import { TIER_COLORS, TIER_NAMES, approxUsd, exactUsd, formatQty } from '../domain/tiers.js';
import { heroSprite, MOUNT_NAMES } from '../render/characters.js';
import { itemIcon } from '../render/icons.js';
import { crestColors, hashString } from '../util/rng.js';
import { DISTRICT_NAMES, type Placed } from '../world/layout.js';
import type { BlockBeat } from '../data/rpc.js';
import { el, fmtDate, safeHref, shortAddr } from './dom.js';

const EXPLAIN: Record<string, string> = {
  bazaar: 'A Bazaar is a decentralised exchange (DEX). Heroes barter one token for another at its stalls, or pour pairs of tokens into its fountain (a liquidity pool) to earn a share of the trading fees.',
  broker: "A Broker's Office is a swap aggregator: a broker runs between several bazaars to find you the best price.",
  bank: 'A Counting House is a lending protocol. Deposit assets as collateral in its vault and you may borrow against them — but if the scale tips too far, the bailiffs come (liquidation).',
  temple: 'The Temple is a staking protocol. Offer ETH and receive blessed gold (a liquid staking token) that slowly grows as the monks — validators — secure the chain.',
  barracks: 'The Paladin Barracks is a restaking protocol: blessed gold sworn to extra oaths for extra rewards, and extra risk.',
  alchemist: "The Alchemist's Tower is a yield vault: hand over assets and the alchemist brews them through strategies to earn more.",
  auction: 'The Auction House is an NFT marketplace: paintings, medals and deeds change hands here.',
  harbour: 'The Harbour is a bridge: ships carry assets to other realms (other chains).',
  council: 'The Council Hall is governance: holders of seals (governance tokens) vote on how protocols are run.',
  names: 'The Hall of Names issues names (like ENS) — a readable title for an address.',
  packing: 'The Packing House wraps ETH into WETH: the same gold, crated so contracts can handle it.',
  forge: 'The Forge mints new things: tokens or NFTs are created here.',
  herald: "The Herald's Cart hands out airdrops: free tokens for those the protocols wish to reward.",
  tent: 'A Mysterious Tent: a contract the town does not recognise. Not necessarily bad — but be careful what you hand over here.',
  tower: 'The Chronicle Tower is the Ethereum blockchain itself. Every ~12 seconds the scribes seal a new page (a block) recording every transaction, and the bell tolls. Every journey that changes anything pays a toll (gas fee) here.',
  guildhall: 'Your Guild Hall: all your heroes (wallets) together.',
  gate: 'The Town Gate: travellers from outside your guild come and go here. A signpost will one day lead to the towns you follow.',
};

export interface PanelContext {
  guild: Guild;
  classOf: (address: string) => HeroClass;
  setClass: (address: string, cls: HeroClass | null) => void;
  onSelectHero: (address: string) => void;
  beat: BlockBeat | null;
}

function chip(text: string, color: string): HTMLElement {
  const c = el('span', { class: 'chip' }, text);
  c.style.borderColor = color;
  c.style.color = color;
  return c;
}

function portrait(hero: Hero, cls: HeroClass): HTMLCanvasElement {
  const h = hashString(hero.address);
  const s = heroSprite({ address: hero.address, cls, tier: hero.tier, crest: crestColors(hero.address)[0], skin: h % 4, hair: (h >> 3) % 6 }, 0);
  const canvas = el('canvas', { class: 'portrait' });
  const scale = 4;
  canvas.width = s.canvas.width * scale;
  canvas.height = s.canvas.height * scale;
  const c = canvas.getContext('2d');
  if (c) {
    c.imageSmoothingEnabled = false;
    c.drawImage(s.canvas, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

function itemSlot(item: Item | null, opts: { pouch?: { count: number; usd: number } } = {}): HTMLElement {
  const slot = el('div', { class: 'slot' });
  const icon = itemIcon(item === null ? 'pouch' : item.category);
  const canvas = el('canvas', { class: 'slot-icon' });
  canvas.width = 32;
  canvas.height = 32;
  const c = canvas.getContext('2d');
  if (c) {
    c.imageSmoothingEnabled = false;
    c.drawImage(icon.canvas, 0, 0, 32, 32);
  }
  slot.append(canvas);
  if (item !== null) {
    slot.style.borderColor = TIER_COLORS[item.tier] ?? '#888';
    if (item.iconUrl !== null && safeHref(item.iconUrl) !== null) {
      const img = el('img', { class: 'slot-logo', alt: '', referrerpolicy: 'no-referrer' });
      img.src = item.iconUrl;
      img.onerror = () => img.remove();
      slot.append(img);
    }
    slot.append(el('span', { class: 'slot-qty' }, item.category === 'nft' ? '' : formatQty(item.quantity)));
    slot.title = `${item.name} (${item.symbol})\n${formatQty(item.quantity)} · ${exactUsd(item.usd)}\n${TIER_NAMES[item.tier]} · ${item.category}`;
    slot.append(el('span', { class: 'slot-name' }, item.category === 'nft' ? item.symbol : item.symbol));
  } else if (opts.pouch) {
    slot.title = `A pouch of odds and ends: ${opts.pouch.count} tiny holdings worth ${exactUsd(opts.pouch.usd)} together`;
    slot.append(el('span', { class: 'slot-qty' }, `×${opts.pouch.count}`));
    slot.append(el('span', { class: 'slot-name' }, 'odds & ends'));
  }
  return slot;
}

function journeyRow(j: Journey, guild: Guild, onHero?: (a: string) => void): HTMLElement {
  const hero = guild.heroes.find((h) => h.address === j.hero);
  const row = el(
    'div',
    { class: `log-row${j.status === 'failed' ? ' failed' : ''}` },
    el('span', { class: 'log-time' }, fmtDate(j.time)),
    el('span', { class: 'log-hero' }, hero?.name ?? shortAddr(j.hero)),
    el('span', { class: 'log-label' }, j.label),
  );
  const dot = el('span', { class: 'log-dot' });
  dot.style.background = TIER_COLORS[j.tier] ?? '#888';
  row.prepend(dot);
  if (onHero) row.onclick = () => onHero(j.hero);
  if (j.hash !== '') row.title = `tx ${j.hash}`;
  return row;
}

export function heroPanel(hero: Hero, ctx: PanelContext): HTMLElement {
  const cls = ctx.classOf(hero.address);
  const select = el('select', { 'aria-label': 'Hero class' });
  for (const c of Object.keys(CLASS_LABEL) as HeroClass[]) {
    const label = c === hero.suggestedClass ? `${CLASS_LABEL[c]} (suggested)` : CLASS_LABEL[c];
    const opt = el('option', { value: c }, label);
    if (c === cls) opt.selected = true;
    select.append(opt);
  }
  select.onchange = () => {
    const v = select.value as HeroClass;
    ctx.setClass(hero.address, v === hero.suggestedClass ? null : v);
  };

  const big = hero.items.filter((i) => (i.usd ?? 0) >= 1);
  const small = hero.items.filter((i) => (i.usd ?? 0) < 1);
  const grid = el('div', { class: 'grid' }, ...big.map((i) => itemSlot(i)));
  if (small.length > 0) grid.append(itemSlot(null, { pouch: { count: small.length, usd: small.reduce((s, i) => s + (i.usd ?? 0), 0) } }));

  const journeys = ctx.guild.journeys.filter((j) => j.hero === hero.address || j.counterpartyHero === hero.address);
  const tolls = journeys.filter((j) => j.hero === hero.address && j.initiated).reduce((s, j) => s + (j.feeUsd ?? 0), 0);

  const stashes = el(
    'div',
    { class: 'stashes' },
    ...hero.stashes.map((s) => {
      const p = ctx.guild.protocols.get(s.protocolId);
      return el(
        'div',
        { class: 'stash' },
        el('div', { class: 'stash-head' }, el('strong', {}, p?.name ?? s.protocolId), el('span', { class: 'muted' }, ` · ${p ? BUILDING_NAMES[p.building] : ''}`), chip(approxUsd(s.netUsd), TIER_COLORS[s.tier] ?? '#888')),
        ...s.entries.map((e) =>
          el('div', { class: `stash-row${e.kind === 'loan' ? ' debt' : ''}` }, el('span', {}, `${e.kind === 'loan' ? 'IOU' : e.kind} · ${formatQty(e.quantity)} ${e.symbol}`), el('span', {}, exactUsd(e.usd))),
        ),
      );
    }),
  );

  return el(
    'div',
    { class: 'panel-body' },
    el('div', { class: 'sheet-head' }, portrait(hero, cls), el('div', {}, el('h2', {}, hero.name), el('div', { class: 'muted mono' }, shortAddr(hero.address)), el('div', { class: 'muted' }, hero.label))),
    el('div', { class: 'stat-row' }, el('span', {}, 'Net worth'), el('strong', {}, exactUsd(hero.netWorth)), chip(TIER_NAMES[hero.tier], TIER_COLORS[hero.tier] ?? '#888')),
    el('div', { class: 'stat-row' }, el('span', {}, 'Mount'), el('strong', {}, MOUNT_NAMES[hero.tier])),
    el('div', { class: 'stat-row' }, el('span', {}, 'Class'), select),
    el('div', { class: 'stat-row' }, el('span', {}, 'Journeys in window'), el('strong', {}, String(journeys.length)), el('span', { class: 'muted' }, `tolls paid ${exactUsd(tolls)}`)),
    el('h3', {}, 'Treasure'),
    big.length + small.length > 0 ? grid : el('p', { class: 'muted' }, 'An empty chest.'),
    hero.nfts.length > 0 ? el('h3', {}, 'Gallery') : null,
    hero.nfts.length > 0 ? el('div', { class: 'grid' }, ...hero.nfts.slice(0, 24).map((n) => itemSlot(n))) : null,
    el('h3', {}, 'Stashes abroad'),
    hero.stashes.length > 0 ? stashes : el('p', { class: 'muted' }, 'Nothing stored in any building.'),
    hero.spamCount > 0 ? el('p', { class: 'muted' }, `🗑 ${hero.spamCount} pieces of cursed junk lie in the midden by the fence (spam tokens, hidden).`) : null,
    el('h3', {}, 'Quest log'),
    el('div', { class: 'log' }, ...journeys.slice(-30).reverse().map((j) => journeyRow(j, ctx.guild))),
  );
}

export function buildingPanel(b: Placed, ctx: PanelContext): HTMLElement {
  if (b.kind === 'home' && b.heroAddress !== undefined) {
    const hero = ctx.guild.heroes.find((h) => h.address === b.heroAddress);
    if (hero) return heroPanel(hero, ctx);
  }
  const protocol = b.protocolId !== undefined ? ctx.guild.protocols.get(b.protocolId) : undefined;
  const district = b.district === 'gate' ? 'Town Gate' : DISTRICT_NAMES[b.district];

  if (protocol === undefined) {
    const title = b.kind === 'tower' ? 'The Chronicle Tower' : b.kind === 'guildhall' ? 'Guild Hall' : 'Town Gate';
    const body = el('div', { class: 'panel-body' }, el('h2', {}, title), el('div', { class: 'muted' }, district), el('p', {}, EXPLAIN[b.kind] ?? ''));
    if (b.kind === 'tower') {
      const beat = ctx.beat;
      body.append(
        beat === null
          ? el('p', { class: 'muted' }, 'Listening for the bell…')
          : el(
              'div',
              {},
              el('div', { class: 'stat-row' }, el('span', {}, 'Latest page (block)'), el('strong', {}, `#${beat.number.toLocaleString('en-US')}`)),
              el('div', { class: 'stat-row' }, el('span', {}, 'Entries on it (transactions)'), el('strong', {}, String(beat.txCount))),
              el('div', { class: 'stat-row' }, el('span', {}, 'Crowd at the gate (block fullness)'), el('strong', {}, `${Math.round(beat.busy * 100)}%`)),
              el('div', { class: 'stat-row' }, el('span', {}, 'Base toll (base fee)'), el('strong', {}, beat.baseFeeGwei === null ? '?' : `${beat.baseFeeGwei.toFixed(2)} gwei`)),
            ),
      );
    }
    if (b.kind === 'guildhall') {
      const total = ctx.guild.heroes.reduce((s, h) => s + h.netWorth, 0);
      body.append(
        el('div', { class: 'stat-row' }, el('span', {}, 'Guild treasury'), el('strong', {}, exactUsd(total))),
        ...ctx.guild.heroes.map((h) => {
          const row = el('div', { class: 'stat-row clickable' }, el('span', {}, h.name), chip(approxUsd(h.netWorth), TIER_COLORS[h.tier] ?? '#888'));
          row.onclick = () => ctx.onSelectHero(h.address);
          return row;
        }),
      );
    }
    return body;
  }

  const href = safeHref(protocol.url);
  const logo = protocol.iconUrl !== null && safeHref(protocol.iconUrl) !== null ? el('img', { class: 'logo', alt: '', referrerpolicy: 'no-referrer' }) : null;
  if (logo && protocol.iconUrl) {
    logo.src = protocol.iconUrl;
    logo.onerror = () => logo.remove();
  }

  const stashes = ctx.guild.heroes.flatMap((h) => h.stashes.filter((s) => s.protocolId === protocol.id).map((s) => ({ h, s })));
  const visits = ctx.guild.journeys.filter((j) => j.steps.some((st) => st.target.kind === 'building' && st.target.protocolId === protocol.id));

  return el(
    'div',
    { class: 'panel-body' },
    el('div', { class: 'sheet-head' }, logo, el('div', {}, el('h2', {}, protocol.name), el('div', { class: 'muted' }, `${BUILDING_NAMES[protocol.building]} · ${CATEGORY_LABEL[protocol.category]}`), el('div', { class: 'muted' }, district))),
    el('p', {}, EXPLAIN[protocol.building] ?? ''),
    href ? el('p', {}, el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, 'Visit the real thing ↗')) : null,
    el('h3', {}, 'Your stashes here'),
    stashes.length === 0
      ? el('p', { class: 'muted' }, 'None of your heroes keeps anything here right now.')
      : el(
          'div',
          { class: 'stashes' },
          ...stashes.map(({ h, s }) =>
            el(
              'div',
              { class: 'stash' },
              el('div', { class: 'stash-head' }, el('strong', {}, h.name), chip(approxUsd(s.netUsd), TIER_COLORS[s.tier] ?? '#888'), s.hasRewards ? chip('rewards ready!', '#ffd166') : null, s.hasDebt ? chip('owes', '#ff8a8a') : null),
              ...s.entries.map((e) => el('div', { class: `stash-row${e.kind === 'loan' ? ' debt' : ''}` }, el('span', {}, `${e.kind === 'loan' ? 'IOU' : e.kind} · ${formatQty(e.quantity)} ${e.symbol}`), el('span', {}, exactUsd(e.usd)))),
            ),
          ),
        ),
    el('h3', {}, `Visits in this window (${visits.length})`),
    el('div', { class: 'log' }, ...visits.slice(-20).reverse().map((j) => journeyRow(j, ctx.guild, ctx.onSelectHero))),
  );
}

export function questLogRow(j: Journey, guild: Guild, onHero: (a: string) => void): HTMLElement {
  return journeyRow(j, guild, onHero);
}
