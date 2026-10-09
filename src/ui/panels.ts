/**
 * The drill-down panels: a hero's Character Sheet (their home) and a
 * building's interior. Approximate values live in the world; exact ones here.
 */

import { CATEGORY_LABEL } from '../domain/catalog.js';
import { buildingName, districtName, heroArt, itemArt } from '../assets/art.js';
import { CLASS_LABEL, type Goods, type Guild, type Hero, type HeroClass, type Item, type Journey, type Target, type Verb } from '../domain/model.js';
import { verbText } from '../domain/mappers.js';
import { ALL_MEDALS, teachingQuests, titleOptions, type Earned } from '../domain/feats.js';
import { TIER_COLORS, TIER_NAMES, approxUsd, exactUsd, formatQty } from '../domain/tiers.js';
import { MOUNT_NAMES } from '../render/characters.js';
import { bornCrest, crestColors, hashString, TINCTURES } from '../util/rng.js';
import type { Placed } from '../world/layout.js';
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
  onJourney: (j: Journey) => void;
  onReplay: (j: Journey) => void;
  beat: BlockBeat | null;
  /** A hero's medals (earned now, or remembered). */
  medalsOf: (address: string) => Map<string, Earned>;
  /** The title a hero wears. */
  titleOf: (address: string) => string;
  /** Pick a title (null: back to the one the town chooses). */
  setTitle: (address: string, title: string | null) => void;
  /** Pick a crest colour (null: the one the hero was born with). */
  setCrest: (address: string, color: string | null) => void;
  /** Rename a hero (null or empty: back to the name the town gave them). */
  setName: (address: string, name: string | null) => void;
  /** The name the town gave a hero. */
  bornName: (address: string) => string;
  /** A portrait in the chosen theme's look (an image URL), if it has one. */
  portraitOf?: (address: string, cls: HeroClass) => string | null;
}

/** A hero's name with a ✎ to rename them in place (Enter saves, Escape cancels, empty restores). */
export function heroNameEditor(hero: Hero, ctx: Pick<PanelContext, 'setName' | 'bornName'>): HTMLElement {
  const title = el('h2', { class: 'hero-name' }, hero.name);
  const edit = el('button', { class: 'rename', title: 'Rename this hero', 'aria-label': 'Rename this hero' }, '✎');
  const wrap = el('div', { class: 'name-row' }, title, edit);
  edit.onclick = () => {
    const input = el('input', { type: 'text', value: hero.name, maxlength: '40', 'aria-label': 'Hero name', placeholder: ctx.bornName(hero.address) });
    const save = (): void => ctx.setName(hero.address, input.value);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') wrap.replaceChildren(title, edit);
    };
    const ok = el('button', { class: 'btn small' }, 'Save');
    ok.onclick = save;
    wrap.replaceChildren(input, ok);
    input.focus();
    input.select();
  };
  return wrap;
}

function chip(text: string, color: string): HTMLElement {
  const c = el('span', { class: 'chip' }, text);
  c.style.borderColor = color;
  c.style.color = color;
  return c;
}

/** A hero's portrait: the theme's rigged character when there is one, else the pixel-art sprite. */
export function portrait(hero: Hero, cls: HeroClass, themed?: ((address: string, cls: HeroClass) => string | null) | undefined): HTMLElement {
  let url: string | null = null;
  try {
    url = themed?.(hero.address, cls) ?? null;
  } catch (error) {
    console.warn('portrait', error);
  }
  if (url !== null) {
    const img = el('img', { class: 'portrait themed', alt: `Portrait of ${hero.name}` });
    img.src = url;
    return img;
  }
  return pixelPortrait(hero, cls);
}

function pixelPortrait(hero: Hero, cls: HeroClass): HTMLCanvasElement {
  const h = hashString(hero.address);
  const s = heroArt({ address: hero.address, cls, tier: hero.tier, crest: crestColors(hero.address)[0], skin: h % 4, hair: (h >> 3) % 6 }, 0);
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
  const icon = itemArt(item === null ? 'pouch' : item.category);
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
    if (item.category === 'nft') slot.classList.add('nft');
    if (item.iconUrl !== null && safeHref(item.iconUrl) !== null) {
      // the token's own logo (or the NFT's picture) is the big thing; the category icon sits in the corner
      const img = el('img', { class: 'slot-logo', alt: '', referrerpolicy: 'no-referrer' });
      img.src = item.iconUrl;
      img.onerror = () => {
        img.remove();
        slot.classList.remove('has-logo');
      };
      slot.classList.add('has-logo');
      canvas.before(img);
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

function journeyRow(j: Journey, guild: Guild, onOpen?: (j: Journey) => void): HTMLElement {
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
  if (onOpen) {
    row.onclick = () => onOpen(j);
    row.classList.add('clickable');
    row.title = 'Open the quest replay';
  }
  return row;
}

/** The medal case: every medal, earned ones bright, the rest showing how to earn them. */
function medalCase(medals: Map<string, Earned>): HTMLElement {
  return el(
    'div',
    { class: 'medals' },
    ...ALL_MEDALS.map((m) => {
      const e = medals.get(m.id);
      const when = e === undefined ? '' : e.at === null ? 'Earned for what this hero holds.' : `Earned ${new Date(e.at).toLocaleDateString('en-GB')}.`;
      const badge = el('div', { class: `medal${e ? ' earned' : ''}`, 'data-medal': m.id }, el('span', { class: 'medal-icon' }, m.icon), el('span', { class: 'medal-name' }, m.name));
      badge.title = e ? `${m.name}: ${when}\nTitle: ${m.title}\n\n${m.lesson}` : `${m.name} (not yet)\n${m.hint}`;
      return badge;
    }),
  );
}

function questCard(q: ReturnType<typeof teachingQuests>[number]): HTMLElement {
  return el(
    'div',
    { class: `tquest${q.done ? ' done' : ''}`, 'data-quest': q.id },
    el('div', { class: 'tquest-head' }, el('span', { class: 'tquest-icon' }, q.icon), el('strong', {}, q.name), q.done ? chip('done', '#9dff8a') : chip('open', '#ffd166')),
    el('p', { class: 'tquest-story' }, q.story),
    el('p', { class: 'muted' }, q.lesson),
    el('p', {}, q.progress),
    q.link && safeHref(q.link.href) ? el('a', { href: q.link.href, target: '_blank', rel: 'noopener noreferrer' }, q.link.label) : null,
  );
}

/** Swatches for the crest: the colour on banners, shields, caravans and the guild's flag. */
function crestPicker(hero: Hero, ctx: PanelContext): HTMLElement {
  const current = crestColors(hero.address)[0];
  const swatch = (color: string, label: string, pick: string | null): HTMLElement => {
    const b = el('button', { class: `swatch${color === current ? ' on' : ''}`, title: label, 'aria-label': `Crest: ${label}` });
    b.style.background = color;
    b.onclick = () => ctx.setCrest(hero.address, pick);
    return b;
  };
  return el('div', { class: 'swatches' }, swatch(bornCrest(hero.address)[0], 'As born', null), ...TINCTURES.map((t) => swatch(t.color, t.name, t.color)));
}

export function heroPanel(hero: Hero, ctx: PanelContext): HTMLElement {
  const cls = ctx.classOf(hero.address);
  const medals = ctx.medalsOf(hero.address);
  const title = ctx.titleOf(hero.address);
  const titleSelect = el('select', { 'aria-label': 'Hero title' });
  for (const t of titleOptions(cls, medals.keys())) {
    const opt = el('option', { value: t }, t);
    if (t === title) opt.selected = true;
    titleSelect.append(opt);
  }
  titleSelect.onchange = () => ctx.setTitle(hero.address, titleSelect.value);
  const quests = teachingQuests(hero, ctx.guild);
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
        el('div', { class: 'stash-head' }, el('strong', {}, p?.name ?? s.protocolId), el('span', { class: 'muted' }, ` · ${p ? buildingName(p.building) : ''}`), chip(approxUsd(s.netUsd), TIER_COLORS[s.tier] ?? '#888')),
        ...s.entries.map((e) =>
          el('div', { class: `stash-row${e.kind === 'loan' ? ' debt' : ''}` }, el('span', {}, `${e.kind === 'loan' ? 'IOU' : e.kind} · ${formatQty(e.quantity)} ${e.symbol}`), el('span', {}, exactUsd(e.usd))),
        ),
      );
    }),
  );

  return el(
    'div',
    { class: 'panel-body' },
    el('div', { class: 'sheet-head' }, portrait(hero, cls, ctx.portraitOf), el('div', {}, heroNameEditor(hero, ctx), el('div', { class: 'hero-title' }, title), el('div', { class: 'muted mono' }, shortAddr(hero.address)), el('div', { class: 'muted' }, hero.label))),
    el('div', { class: 'stat-row' }, el('span', {}, 'Net worth'), el('strong', {}, exactUsd(hero.netWorth)), chip(TIER_NAMES[hero.tier], TIER_COLORS[hero.tier] ?? '#888')),
    el('div', { class: 'stat-row' }, el('span', {}, 'Mount'), el('strong', {}, MOUNT_NAMES[hero.tier])),
    el('div', { class: 'stat-row' }, el('span', {}, 'Class'), select),
    el('div', { class: 'stat-row' }, el('span', {}, 'Title'), titleSelect),
    el('div', { class: 'stat-row' }, el('span', {}, 'Crest'), crestPicker(hero, ctx)),
    el('div', { class: 'stat-row' }, el('span', {}, 'Journeys in window'), el('strong', {}, String(journeys.length)), el('span', { class: 'muted' }, `tolls paid ${exactUsd(tolls)}`)),
    el('h3', {}, 'Treasure'),
    big.length + small.length > 0 ? grid : el('p', { class: 'muted' }, 'An empty chest.'),
    hero.nfts.length > 0 ? el('h3', {}, 'Gallery') : null,
    hero.nfts.length > 0 ? el('div', { class: 'grid' }, ...hero.nfts.slice(0, 24).map((n) => itemSlot(n))) : null,
    el('h3', {}, 'Stashes abroad'),
    hero.stashes.length > 0 ? stashes : el('p', { class: 'muted' }, 'Nothing stored in any building.'),
    hero.spamCount > 0 ? el('p', { class: 'muted' }, `🗑 ${hero.spamCount} pieces of cursed junk lie in the midden by the fence (spam tokens, hidden).`) : null,
    el('h3', {}, `Medals (${medals.size} of ${ALL_MEDALS.length})`),
    medalCase(medals),
    quests.length > 0 ? el('h3', {}, `Teaching quests (${quests.filter((q) => q.done).length} of ${quests.length} done)`) : null,
    quests.length > 0 ? el('div', { class: 'tquests' }, ...quests.map(questCard)) : null,
    el('h3', {}, 'Quest log'),
    el('div', { class: 'log' }, ...journeys.slice(-30).reverse().map((j) => journeyRow(j, ctx.guild, ctx.onJourney))),
  );
}

export function buildingPanel(b: Placed, ctx: PanelContext): HTMLElement {
  if (b.kind === 'home' && b.heroAddress !== undefined) {
    const hero = ctx.guild.heroes.find((h) => h.address === b.heroAddress);
    if (hero) return heroPanel(hero, ctx);
  }
  const protocol = b.protocolId !== undefined ? ctx.guild.protocols.get(b.protocolId) : undefined;
  const district = b.district === 'gate' ? buildingName('gate') : districtName(b.district);

  if (protocol === undefined) {
    const title = buildingName(b.kind === 'tower' ? 'tower' : b.kind === 'guildhall' ? 'guildhall' : 'gate');
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
          const row = el('div', { class: 'stat-row clickable' }, el('span', {}, `${h.name}, ${ctx.titleOf(h.address)}`), el('span', { class: 'muted' }, `🏅 ${ctx.medalsOf(h.address).size}`), chip(approxUsd(h.netWorth), TIER_COLORS[h.tier] ?? '#888'));
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
    el('div', { class: 'sheet-head' }, logo, el('div', {}, el('h2', {}, protocol.name), el('div', { class: 'muted' }, `${buildingName(protocol.building)} · ${CATEGORY_LABEL[protocol.category]}`), el('div', { class: 'muted' }, district))),
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
    el('div', { class: 'log' }, ...visits.slice(-20).reverse().map((j) => journeyRow(j, ctx.guild, ctx.onJourney))),
  );
}

export function questLogRow(j: Journey, guild: Guild, onOpen: (j: Journey) => void): HTMLElement {
  return journeyRow(j, guild, onOpen);
}

// --- Quest Replay (one transaction, step by step) ---------------------------

const EXPLORERS: Record<string, string> = {
  ethereum: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
};

/** One line for newcomers: what this kind of journey means on-chain. */
const VERB_EXPLAIN: Partial<Record<Verb, string>> = {
  send: 'Sent tokens to another address.',
  receive: 'Tokens arrived from another address.',
  swap: 'Traded one token for another at an exchange.',
  addLiquidity: 'Added a pair of tokens to a liquidity pool, earning a share of trading fees.',
  removeLiquidity: 'Took tokens back out of a liquidity pool.',
  stake: 'Locked tokens to help secure a network (or a protocol) in exchange for rewards.',
  unstake: 'Asked for staked tokens back.',
  supply: 'Deposited tokens into a lending protocol, where they can earn interest and serve as collateral.',
  withdraw: 'Took deposited tokens back out of a protocol.',
  borrow: 'Borrowed against collateral. The debt must be repaid, or the collateral can be liquidated.',
  repay: 'Paid back (part of) a loan.',
  liquidated: 'The loan became too risky, so someone else repaid it and took collateral as a reward.',
  claim: 'Collected rewards that had built up.',
  approve: 'Allowed a contract to move one of your tokens. Unlimited approvals stay open until revoked.',
  revoke: 'Took back a contract’s permission to move your tokens.',
  wrap: 'Turned ETH into WETH, the token form of ETH that contracts can handle.',
  unwrap: 'Turned WETH back into plain ETH.',
  mint: 'Created new tokens or NFTs.',
  burn: 'Destroyed tokens or NFTs.',
  buyNft: 'Bought an NFT at a marketplace.',
  sellNft: 'Sold an NFT at a marketplace.',
  bid: 'Placed a bid or listing; nothing moves until someone takes it.',
  bridge: 'Moved assets between chains through a bridge.',
  delegate: 'Gave someone else your voting power.',
  deploy: 'Put a new smart contract on the chain.',
  airdrop: 'Received free tokens from a project.',
  deposit: 'Put tokens into a protocol.',
  lend: 'Lent funds to a borrower through a lending protocol; they repay with interest.',
  loanRepaid: 'A borrower repaid a loan you made, with interest.',
  unknown: 'A contract call the town could not decode. The explorer link shows exactly what happened.',
};

function goodsList(list: Goods[], sign: '−' | '+'): HTMLElement[] {
  return list.map((g) => {
    const cls = `goods ${sign === '−' ? 'out' : 'in'}`;
    if (!g.isNft) return el('div', { class: cls }, el('span', {}, `${sign} ${formatQty(g.quantity)} ${g.symbol}`), el('span', {}, exactUsd(g.usd)));
    // an NFT: its picture, its own name, and the collection it belongs to
    const pic = g.image !== undefined && safeHref(g.image) !== null ? el('img', { class: 'nft-thumb', alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : null;
    if (pic && g.image) {
      pic.src = g.image;
      pic.onerror = () => pic.remove();
    }
    const many = g.quantity > 1 ? ` ×${formatQty(g.quantity)}` : '';
    return el(
      'div',
      { class: `${cls} nft` },
      el('span', { class: 'nft-goods' }, el('span', { class: 'sign' }, sign), pic, el('span', {}, el('strong', {}, `${g.name ?? g.symbol}${many}`), g.name !== undefined && g.name !== g.symbol ? el('div', { class: 'muted small' }, g.symbol) : null)),
      el('span', {}, exactUsd(g.usd)),
    );
  });
}

function placeName(target: Target, ctx: PanelContext): string {
  switch (target.kind) {
    case 'building': {
      const p = ctx.guild.protocols.get(target.protocolId);
      return p ? `${p.name} (${buildingName(p.building)} · ${CATEGORY_LABEL[p.category]})` : target.protocolId;
    }
    case 'home':
      return `${ctx.guild.heroes.find((h) => h.address === target.address)?.name ?? shortAddr(target.address)}'s home`;
    case 'gate':
      return 'the Town Gate (someone outside the guild)';
  }
}

export function questPanel(j: Journey, ctx: PanelContext): HTMLElement {
  const hero = ctx.guild.heroes.find((h) => h.address === j.hero);
  const status = j.status === 'failed' ? chip('Failed', '#ff8a8a') : j.status === 'pending' ? chip('Pending', '#ffd166') : chip('Confirmed', '#9dff8a');
  const replay = el('button', { class: 'btn' }, '▶ Replay this quest');
  replay.onclick = () => ctx.onReplay(j);
  const explorer = EXPLORERS[j.chainId];
  const link = explorer && /^0x[0-9a-fA-F]{64}$/.test(j.hash) ? el('a', { href: `${explorer}${j.hash}`, target: '_blank', rel: 'noopener noreferrer' }, 'View on the explorer ↗') : null;
  const heroLink = el('a', { href: '#' }, hero?.name ?? shortAddr(j.hero));
  heroLink.onclick = (e) => {
    e.preventDefault();
    ctx.onSelectHero(j.hero);
  };

  const steps: HTMLElement[] = [];
  if (j.initiated) {
    if (j.feeUsd !== null && j.feeUsd > 0) {
      steps.push(
        el(
          'li',
          {},
          el('strong', {}, 'Chronicle Tower: pay the toll'),
          el('div', { class: 'muted' }, 'Every transaction pays a gas fee to the network.'),
          el('div', { class: 'goods out' }, el('span', {}, `− ${j.feeNative !== null ? `${formatQty(j.feeNative)} ETH` : 'gas'}`), el('span', {}, exactUsd(j.feeUsd))),
        ),
      );
    }
    for (const step of j.steps) {
      steps.push(
        el(
          'li',
          {},
          el('strong', {}, `${verbText(step.verb)} at ${placeName(step.target, ctx)}`),
          ...goodsList(step.give, '−'),
          ...goodsList(step.get, '+'),
          step.give.length + step.get.length === 0 ? el('div', { class: 'muted' }, 'Nothing changed hands.') : null,
        ),
      );
    }
    steps.push(el('li', {}, el('strong', {}, 'Home again')));
  } else {
    const first = j.steps[0];
    steps.push(el('li', {}, el('strong', {}, `From ${first ? placeName(first.target, ctx) : 'outside'}`)));
    steps.push(
      el('li', {}, el('strong', {}, `${verbText(j.verb)}: arrives at ${hero?.name ?? 'the hero'}'s home`), ...goodsList(j.steps.flatMap((s) => s.give), '−'), ...goodsList(j.steps.flatMap((s) => s.get), '+')),
    );
  }

  return el(
    'div',
    { class: 'panel-body' },
    el('h2', {}, `Quest: ${verbText(j.verb)}`),
    el('div', { class: 'stat-row' }, el('span', {}, new Date(j.time).toLocaleString('en-GB')), status),
    el('p', {}, el('strong', {}, j.label)),
    el('p', { class: 'muted' }, VERB_EXPLAIN[j.verb] ?? ''),
    el('div', { class: 'stat-row' }, el('span', {}, 'Hero'), heroLink),
    j.counterparty !== null ? el('div', { class: 'stat-row' }, el('span', {}, 'Other party'), el('span', { class: 'mono' }, ctx.guild.heroes.find((h) => h.address === j.counterparty)?.name ?? shortAddr(j.counterparty))) : null,
    j.method !== null ? el('div', { class: 'stat-row' }, el('span', {}, 'Contract method'), el('span', { class: 'mono' }, j.method)) : null,
    j.block !== null ? el('div', { class: 'stat-row' }, el('span', {}, 'Page of the Chronicle (block)'), el('span', { class: 'mono' }, `#${j.block.toLocaleString('en-US')}`)) : null,
    el('div', { class: 'form-row' }, replay, link),
    el('h3', {}, j.steps.length > 1 ? `Expedition: ${j.steps.length} stops` : 'The journey'),
    el('ol', { class: 'quest-steps' }, ...steps),
  );
}
