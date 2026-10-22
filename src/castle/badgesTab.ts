/**
 * The Badges tab: the player (all their wallets together) — level, rank and
 * how far to the next level — and every badge, earned ones with their tier
 * (bronze, silver, gold), the rest greyed with how to earn them. The profile
 * comes from src/domain/player.ts (worked out by the PlayerController); the
 * pictures are the theme's badge and rank art. Tapping a badge opens its sheet.
 */

import { el, fmtDate, safeHref, shortAddr } from '../util/dom.js';
import { ALL_MEDALS, defaultTitle, titleOptions, type Medal, type TeachingQuest } from '../domain/feats.js';
import { BADGE_TIER_NAMES, type PlayerBadge, type PlayerProfile } from '../domain/player.js';
import { assetPath } from './assets/manifest.js';
import { themeFileUrl, type CastleTheme } from './assets/theme.js';
import type { SheetState } from './shellState.js';
import type { CastleBadge } from './world/castleBadges.js';
import { secretsProgress, type SecretId } from './world/secrets.js';

export const BADGE_SHEET = 'badge:';

/** The theme's picture for a medal or a rank (an `<img>`: SVG never goes into the page itself). */
function art(theme: CastleTheme | null, name: string, alt: string, size: number): HTMLElement {
  if (!theme) return el('span', { class: 'art-missing', style: `width:${size}px;height:${size}px` });
  return el('img', { src: themeFileUrl(theme, assetPath({ name, kind: 'art' })), alt, width: String(size), height: String(size), loading: 'lazy' });
}

/** A teaching quest for one of the player's wallets. */
export interface WalletQuest {
  wallet: string;
  /** The wallet's name (ENS or short address). */
  walletName: string;
  quest: TeachingQuest;
}

/** The player's teaching quests: open ones first, each with what it teaches and where to act; done ones counted. */
function questsSection(quests: readonly WalletQuest[]): HTMLElement {
  const open = quests.filter((q) => !q.quest.done);
  const done = quests.length - open.length;
  const out = el('section', { class: 'quests', 'aria-label': 'Quests' }, el('h2', {}, `Quests for your wallets · ${open.length} open`));
  if (open.length === 0) out.append(el('p', { class: 'muted' }, 'Nothing to do: every quest is done. Well kept.'));
  for (const { walletName, quest } of open) {
    const href = quest.link ? safeHref(quest.link.href) : null;
    out.append(
      el(
        'article',
        { class: 'quest', 'data-quest': quest.id },
        el('h3', {}, `${quest.icon} ${quest.name}`, el('span', { class: 'muted quest-wallet' }, ` · ${walletName}`)),
        el('p', {}, quest.story),
        el('p', { class: 'muted' }, quest.lesson),
        el('p', { class: 'quest-progress' }, quest.progress),
        href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'quest-link' }, `${quest.link!.label} ↗`) : null,
      ),
    );
  }
  if (done > 0) out.append(el('p', { class: 'muted' }, `${done} done.`));
  return out;
}

/** The title the player wears: their pick when a badge still unlocks it, else the default for their badges. */
export function playerTitle(profile: PlayerProfile | null, picked: string): string {
  const medals = [...(profile?.badges.keys() ?? [])];
  return picked && titleOptions('adventurer', medals).includes(picked) ? picked : defaultTitle('adventurer', medals);
}

export interface TitleChoice {
  picked: string;
  onPick(title: string): void;
}

export function badgesTab(
  profile: PlayerProfile | null,
  theme: CastleTheme | null,
  open: (sheet: SheetState) => void,
  castle: readonly CastleBadge[] = [],
  title?: TitleChoice,
  quests: readonly WalletQuest[] = [],
  secrets: Partial<Record<SecretId, number>> = {},
): HTMLElement {
  const page = el('section', { class: 'tab-page badges-tab', 'data-tab-page': 'badges' }, el('h1', {}, 'Badges'));
  if (!profile) {
    page.append(el('p', { class: 'muted' }, 'Working out your level from all your wallets’ history…'), secretsSection(secrets));
    return page;
  }
  page.append(playerCard(profile, theme, title));
  if (castle.length) {
    const done = castle.filter((b) => b.progress >= 1).length;
    page.append(el('h2', {}, `Your castle · ${done} of ${castle.length}`));
    page.append(el('div', { class: 'badge-grid' }, ...castle.map((b) => castleCard(b, theme, open))));
  }
  if (quests.length) page.append(questsSection(quests));
  const earned = ALL_MEDALS.filter((m) => profile.badges.has(m.id));
  const locked = ALL_MEDALS.filter((m) => !profile.badges.has(m.id));
  page.append(el('h2', {}, `Earned · ${earned.length} of ${ALL_MEDALS.length}`));
  page.append(el('div', { class: 'badge-grid' }, ...earned.map((m) => badgeCard(m, profile.badges.get(m.id) ?? null, theme, open))));
  if (locked.length) {
    page.append(el('h2', {}, 'Still to earn'));
    page.append(el('div', { class: 'badge-grid' }, ...locked.map((m) => badgeCard(m, null, theme, open))));
  }
  page.append(secretsSection(secrets));
  return page;
}

/** The town's secrets: how many are found, and the found ones with how (the rest stay secret). */
function secretsSection(found: Partial<Record<SecretId, number>>): HTMLElement {
  const p = secretsProgress(found);
  const out = el('section', { class: 'secrets', 'aria-label': 'Secrets' }, el('h2', {}, `Secrets found · ${p.found.length} of ${p.total}`));
  if (p.found.length === 0) out.append(el('p', { class: 'muted' }, 'The town keeps a few secrets. Look closely, and tap about.'));
  else out.append(el('ul', { class: 'secret-list' }, ...p.found.map((s) => el('li', { 'data-secret': s.id }, el('strong', {}, s.name), el('span', { class: 'muted' }, ` · ${s.hint}`)))));
  return out;
}

function playerCard(p: PlayerProfile, theme: CastleTheme | null, title?: TitleChoice): HTMLElement {
  const into = p.xp - p.levelXp;
  const span = Math.max(1, p.nextXp - p.levelXp);
  const share = Math.min(1, Math.max(0, into / span));
  const bar = el('div', {
    class: 'xp-bar',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': String(span),
    'aria-valuenow': String(Math.max(0, into)),
    'aria-label': `Level ${p.level}: ${Math.round(share * 100)}% of the way to level ${p.level + 1}`,
  });
  bar.style.setProperty('--progress', share.toFixed(3));
  const s = p.stats;
  return el(
    'div',
    { class: 'player-card' },
    art(theme, `rank.${p.rank.toLowerCase()}`, `${p.rank} shield`, 72),
    el(
      'div',
      { class: 'player-text' },
      el('h2', {}, `Level ${p.level} · ${p.rank}`),
      title ? titlePicker(p, title) : null,
      bar,
      el('p', { class: 'muted' }, `${Math.max(0, span - into).toLocaleString('en-US')} XP to level ${p.level + 1}`),
      el(
        'p',
        { class: 'muted stats' },
        `${s.wallets} wallet${s.wallets === 1 ? '' : 's'} · ${s.signed} signed · ${s.received} received · ${s.protocols} protocols · ${s.activeMonths} active months`,
      ),
    ),
  );
}

function badgeCard(m: Medal, badge: PlayerBadge | null, theme: CastleTheme | null, open: (sheet: SheetState) => void): HTMLElement {
  const tierName = badge && !badge.single ? BADGE_TIER_NAMES[badge.tier] : '';
  const card = el(
    'button',
    { class: `badge-card${badge ? ' earned' : ' locked'}${tierName ? ` tier-${tierName}` : ''}`, type: 'button', 'data-badge': m.id },
    art(theme, `badge.${m.id}`, m.name, 56),
    el('span', { class: 'badge-name' }, m.name),
    el('span', { class: 'badge-tier muted' }, badge ? (tierName ? `${tierName} · ×${badge.count}` : 'earned') : 'locked'),
  );
  card.addEventListener('click', () => open({ id: BADGE_SHEET + m.id, title: m.name }));
  return card;
}

function castleCard(b: CastleBadge, theme: CastleTheme | null, open: (sheet: SheetState) => void): HTMLElement {
  const earned = b.progress >= 1;
  const bar = el('span', { class: 'mini-bar', 'aria-hidden': 'true' });
  bar.style.setProperty('--progress', b.progress.toFixed(3));
  const card = el(
    'button',
    { class: `badge-card castle-badge${earned ? ' earned tier-gold' : ' locked'}`, type: 'button', 'data-badge': b.id },
    art(theme, `badge.${b.id}`, b.name, 56),
    el('span', { class: 'badge-name' }, b.name),
    earned ? el('span', { class: 'badge-tier muted' }, 'earned') : bar,
  );
  card.addEventListener('click', () => open({ id: BADGE_SHEET + b.id, title: b.name }));
  return card;
}

/** A castle badge's sheet: what it means, how to earn it, where the guild stands. */
export function castleBadgeSheet(b: CastleBadge, theme: CastleTheme | null): HTMLElement {
  return el(
    'div',
    { class: 'sheet-content badge-sheet' },
    art(theme, `badge.${b.id}`, b.name, 96),
    el('p', {}, b.lesson),
    el('p', { class: 'muted' }, b.progress >= 1 ? `Earned: ${b.status}.` : `To earn it: ${b.hint} Now: ${b.status}.`),
  );
}

/** A badge's sheet: what it teaches, how to earn it (or the next tier), and how it was earned. */
export function badgeSheet(id: string, profile: PlayerProfile | null, theme: CastleTheme | null): HTMLElement {
  const m = ALL_MEDALS.find((x) => x.id === id);
  if (!m) return el('p', {}, 'Unknown badge.');
  const b = profile?.badges.get(id) ?? null;
  const out = el('div', { class: 'sheet-content badge-sheet' }, art(theme, `badge.${m.id}`, m.name, 96), el('p', {}, m.lesson));
  if (!b) {
    out.append(el('p', { class: 'muted' }, `To earn it: ${m.hint}`));
    return out;
  }
  out.append(el('p', { class: 'muted' }, `Unlocks the title “${m.title}”.`));
  const rows = b.tiers.map((t, i) =>
    el(
      'li',
      {},
      `${b.single ? 'Earned' : BADGE_TIER_NAMES[i + 1]}: ${t.at === null ? 'held now' : fmtDate(t.at)} · ${shortAddr(t.wallet)}`,
    ),
  );
  out.append(el('ul', { class: 'provenance' }, ...rows));
  return out;
}

/** The titles the player's badges unlock, to wear one (shown under the level). */
function titlePicker(p: PlayerProfile, choice: TitleChoice): HTMLElement {
  const options = titleOptions('adventurer', p.badges.keys());
  const current = playerTitle(p, choice.picked);
  const select = el('select', { class: 'title-select', 'aria-label': 'Your title' });
  for (const t of options) {
    const o = el('option', { value: t }, t);
    if (t === current) o.selected = true;
    select.append(o);
  }
  select.addEventListener('change', () => choice.onPick(select.value));
  return el('label', { class: 'title-row muted' }, 'Title ', select);
}
