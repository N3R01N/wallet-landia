/**
 * The Badges tab: the player (all their wallets together) — level, rank and
 * how far to the next level — and every badge, earned ones with their tier
 * (bronze, silver, gold), the rest greyed with how to earn them. The profile
 * comes from src/domain/player.ts (worked out by the PlayerController); the
 * pictures are the theme's badge and rank art. Tapping a badge opens its sheet.
 */

import { el, fmtDate, shortAddr } from '../ui/dom.js';
import { ALL_MEDALS, type Medal } from '../domain/feats.js';
import { BADGE_TIER_NAMES, type PlayerBadge, type PlayerProfile } from '../domain/player.js';
import { assetPath } from './assets/manifest.js';
import { themeFileUrl, type CastleTheme } from './assets/theme.js';
import type { SheetState } from './shellState.js';
import type { CastleBadge } from './world/castleBadges.js';

export const BADGE_SHEET = 'badge:';

/** The theme's picture for a medal or a rank (an `<img>`: SVG never goes into the page itself). */
function art(theme: CastleTheme | null, name: string, alt: string, size: number): HTMLElement {
  if (!theme) return el('span', { class: 'art-missing', style: `width:${size}px;height:${size}px` });
  return el('img', { src: themeFileUrl(theme, assetPath({ name, kind: 'art' })), alt, width: String(size), height: String(size), loading: 'lazy' });
}

export function badgesTab(profile: PlayerProfile | null, theme: CastleTheme | null, open: (sheet: SheetState) => void, castle: readonly CastleBadge[] = []): HTMLElement {
  const page = el('section', { class: 'tab-page badges-tab', 'data-tab-page': 'badges' }, el('h1', {}, 'Badges'));
  if (!profile) {
    page.append(el('p', { class: 'muted' }, 'Working out your level from all your wallets’ history…'));
    return page;
  }
  page.append(playerCard(profile, theme));
  if (castle.length) {
    const done = castle.filter((b) => b.progress >= 1).length;
    page.append(el('h2', {}, `Your castle · ${done} of ${castle.length}`));
    page.append(el('div', { class: 'badge-grid' }, ...castle.map((b) => castleCard(b, theme, open))));
  }
  const earned = ALL_MEDALS.filter((m) => profile.badges.has(m.id));
  const locked = ALL_MEDALS.filter((m) => !profile.badges.has(m.id));
  page.append(el('h2', {}, `Earned · ${earned.length} of ${ALL_MEDALS.length}`));
  page.append(el('div', { class: 'badge-grid' }, ...earned.map((m) => badgeCard(m, profile.badges.get(m.id) ?? null, theme, open))));
  if (locked.length) {
    page.append(el('h2', {}, 'Still to earn'));
    page.append(el('div', { class: 'badge-grid' }, ...locked.map((m) => badgeCard(m, null, theme, open))));
  }
  return page;
}

function playerCard(p: PlayerProfile, theme: CastleTheme | null): HTMLElement {
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
