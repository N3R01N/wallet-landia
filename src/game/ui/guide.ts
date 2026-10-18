/**
 * The guide: how a match goes, every unit (what it does, where it comes
 * from, its numbers, what it beats), what each kind of holding does and the
 * trade that gets it, the battlefield and the market. Opens from the panel's
 * "? Guide" button, or at a unit from any unit name marked `data-guide-unit`.
 * The words are in data/guide.ts.
 */

import type { Loaded } from '../../castle/assets/models.js';
import { el } from '../../util/dom.js';
import { UNIT_TYPES } from '../core/catalog.js';
import { ABILITY_NAME, BUILDING_BUFF, BUILDING_NAME, HOME_FN, type BuildingKind } from '../core/depth.js';
import { EVENTS } from '../core/market.js';
import type { EventId, Role } from '../core/types.js';
import {
  CAPTURE_TEXT,
  CATEGORY_TEXT,
  EVENT_TEXT,
  GAS_TEXT,
  HOLDINGS,
  HOW_TO_PLAY,
  LOAN_TEXT,
  REGIME_TEXT,
  RELIC_TEXT,
  ROLE_TEXT,
  ROLES,
  SIDE_ABILITY_TEXT,
  UNIT_ABILITY_TEXT,
  categoryExamples,
  counters,
  unitSources,
  unitsByRole,
} from '../data/guide.js';
import { unitPortraits } from '../render/unitPortraits.js';

export type GuideTab = 'play' | 'units' | 'holdings' | 'battle' | 'market';

const TABS: { id: GuideTab; label: string }[] = [
  { id: 'play', label: 'How to play' },
  { id: 'units', label: 'Units' },
  { id: 'holdings', label: 'Your holdings' },
  { id: 'battle', label: 'Battle' },
  { id: 'market', label: 'Market' },
];

/** The stats shown as bars, each against the largest of any unit. */
const STATS: { key: 'hp' | 'atk' | 'range' | 'speed' | 'siege'; label: string }[] = [
  { key: 'hp', label: 'HP' },
  { key: 'atk', label: 'Attack' },
  { key: 'range', label: 'Range' },
  { key: 'speed', label: 'Speed' },
  { key: 'siege', label: 'Siege' },
];

const HOME_LABEL: Record<string, string> = { lending: 'lending', dex: 'a pool', staking: 'staking', vault: 'a vault' };

export interface GuideOptions {
  /** The theme's models, for the unit portraits (none: the role's icon). */
  load?: () => ((name: string) => Promise<Loaded | null>) | null;
}

export class Guide {
  readonly element = el('dialog', { class: 'siege-guide', 'aria-label': 'Guide' });
  readonly #opts: GuideOptions;
  #tab: GuideTab = 'play';
  #role: Role | null = null;
  readonly #body = el('div', { class: 'siege-guide-body' });
  readonly #tabs = el('div', { class: 'siege-guide-tabs', role: 'tablist' });

  constructor(opts: GuideOptions = {}) {
    this.#opts = opts;
    const close = el('button', { class: 'btn siege-guide-close', type: 'button', 'aria-label': 'Close the guide' }, '✕');
    close.addEventListener('click', () => this.element.close());
    // a click on the backdrop closes it too
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
    this.element.append(el('div', { class: 'siege-guide-head' }, el('h2', {}, '📖 Guide'), close), this.#tabs, this.#body);
  }

  get open(): boolean {
    return this.element.open;
  }

  /** Opens at a tab; at a unit, its card is shown and marked. */
  show(tab: GuideTab = this.#tab, unit?: string): void {
    this.#tab = tab;
    if (unit) this.#role = null;
    if (!this.element.isConnected) document.body.append(this.element);
    this.render();
    if (!this.element.open) this.element.showModal();
    if (unit) {
      const card = this.#body.querySelector<HTMLElement>(`[data-unit="${CSS.escape(unit)}"]`);
      if (card) {
        card.classList.add('siege-guide-marked');
        card.scrollIntoView({ block: 'center' });
      }
    } else this.#body.scrollTop = 0;
  }

  close(): void {
    this.element.close();
  }

  render(): void {
    this.#tabs.replaceChildren(
      ...TABS.map((t) => {
        const b = el('button', { class: 'siege-guide-tab', type: 'button', role: 'tab', 'aria-selected': String(t.id === this.#tab), 'data-tab': t.id }, t.label);
        b.addEventListener('click', () => this.show(t.id));
        return b;
      }),
    );
    const content = { play: () => this.#play(), units: () => this.#units(), holdings: () => this.#holdings(), battle: () => this.#battle(), market: () => this.#market() }[this.#tab]();
    this.#body.replaceChildren(...content);
  }

  #play(): HTMLElement[] {
    const go = el('button', { class: 'btn', type: 'button' }, 'See the units →');
    go.addEventListener('click', () => this.show('units'));
    return [...HOW_TO_PLAY.map((s) => el('section', { class: 'siege-guide-step' }, el('h3', {}, s.title), el('p', {}, s.text))), go];
  }

  #units(): HTMLElement[] {
    const chips = el(
      'div',
      { class: 'siege-guide-chips', role: 'group', 'aria-label': 'Show units of a role' },
      ...[null, ...ROLES].map((r) => {
        const b = el('button', { class: 'siege-guide-chip', type: 'button', 'aria-pressed': String(this.#role === r) }, r ? `${ROLE_TEXT[r].icon} ${ROLE_TEXT[r].name}` : 'All');
        b.addEventListener('click', () => {
          this.#role = r;
          this.render();
        });
        return b;
      }),
    );
    const ids = unitsByRole().filter((id) => this.#role === null || UNIT_TYPES[id]!.role === this.#role);
    const load = this.#opts.load?.();
    const pictures = load ? unitPortraits(ids, load) : null;
    const max = Object.fromEntries(STATS.map((s) => [s.key, Math.max(...Object.values(UNIT_TYPES).map((u) => u[s.key]))])) as Record<string, number>;
    const cards = ids.map((id) => {
      const u = UNIT_TYPES[id]!;
      const role = ROLE_TEXT[u.role];
      const c = counters(u.role);
      const src = unitSources(id);
      const from = [
        ...src.tokens,
        ...src.categories.map((cat) => {
          const ex = categoryExamples(cat);
          return `${CATEGORY_TEXT[cat]}${ex.length ? ` (${ex.join(', ')})` : ''}`;
        }),
      ];
      const ability = u.ability ? UNIT_ABILITY_TEXT[u.ability] : undefined;
      const portrait = el('div', { class: 'siege-guide-portrait', 'aria-hidden': 'true' }, el('span', {}, role.icon));
      void pictures?.get(id)?.then((url) => {
        if (url) portrait.replaceChildren(el('img', { src: url, alt: '' }));
      });
      return el(
        'article',
        { class: 'siege-guide-unit', 'data-unit': id },
        portrait,
        el(
          'div',
          { class: 'siege-guide-unit-main' },
          el('h3', {}, u.name, ' ', el('span', { class: `siege-guide-role siege-guide-role-${u.role}` }, `${role.icon} ${role.name}`)),
          el('p', { class: 'siege-guide-from' }, el('strong', {}, 'From: '), from.length ? from.join(' · ') : '—'),
          el(
            'div',
            { class: 'siege-guide-stats' },
            ...STATS.map((s) =>
              el(
                'div',
                { class: 'siege-guide-stat' },
                el('span', {}, s.label),
                Object.assign(el('span', { class: 'siege-guide-bar', role: 'img', 'aria-label': `${s.label} ${u[s.key]}` }), { style: `--v: ${u[s.key] / (max[s.key] || 1)}` }),
                el('span', { class: 'num' }, String(u[s.key])),
              ),
            ),
          ),
          ability ? el('p', {}, el('strong', {}, `${ability.name}. `), ability.text) : null,
          el(
            'p',
            { class: 'siege-guide-counter' },
            c.beats ? `Strong against ${ROLE_TEXT[c.beats].name}. ` : '',
            c.beatenBy ? `Weak against ${ROLE_TEXT[c.beatenBy].name}. ` : '',
            `Each costs ${u.costMult}× a unit’s worth of its token.`,
          ),
          el('a', { class: 'siege-guide-watch', href: `siege-gallery.html#unit.${id}`, target: '_blank', rel: 'noopener' }, 'Watch it move ↗'),
        ),
      );
    });
    return [
      el('p', {}, 'Every token you hold (not a stablecoin) fields squads of one unit type. How many: its dollar value ÷ the unit’s cost. Tokens the game doesn’t know fight as their category’s unit.'),
      chips,
      el('div', { class: 'siege-guide-units' }, ...cards),
    ];
  }

  #holdings(): HTMLElement[] {
    return [
      el('h3', {}, 'What you hold, and what it does'),
      el(
        'div',
        { class: 'siege-guide-list' },
        ...HOLDINGS.map((h) => el('section', {}, el('h4', {}, h.what), el('p', {}, h.does), el('p', { class: 'siege-guide-how' }, el('strong', {}, 'How: '), h.how))),
      ),
      el('h3', {}, 'Abilities from protocols'),
      el('p', {}, 'They work on their own in battle. A curated protocol gives the named one; others of the same kind give the same ability under a plain name.'),
      el(
        'div',
        { class: 'siege-guide-list' },
        ...(Object.keys(SIDE_ABILITY_TEXT) as (keyof typeof SIDE_ABILITY_TEXT)[]).map((a) =>
          el('section', {}, el('h4', {}, ABILITY_NAME[a]), el('p', {}, SIDE_ABILITY_TEXT[a].text), el('p', { class: 'siege-guide-how' }, el('strong', {}, 'From: '), SIDE_ABILITY_TEXT[a].from)),
        ),
      ),
      el('h3', {}, 'Relics (NFTs)'),
      el('ul', { class: 'siege-guide-relics' }, ...RELIC_TEXT.map((r) => el('li', {}, el('strong', {}, r.name), `: ${r.text}`))),
    ];
  }

  #battle(): HTMLElement[] {
    return [
      el('h3', {}, 'Who beats whom'),
      el(
        'div',
        { class: 'siege-guide-triangle', role: 'img', 'aria-label': 'Melee beats Cavalry, Cavalry beats Ranged, Ranged beats Melee' },
        ...(['melee', 'cavalry', 'ranged', 'melee'] as const).flatMap((r, i) => [
          i > 0 ? el('span', { class: 'siege-guide-arrow' }, '→') : null,
          el('span', { class: 'siege-guide-role-big' }, `${ROLE_TEXT[r].icon} ${ROLE_TEXT[r].name}`),
        ]).filter((x): x is HTMLElement => x !== null),
      ),
      el('p', {}, 'Each beats the next: it hits that role 50% harder. Area attacks hit Swarms 50% harder.'),
      el('div', { class: 'siege-guide-list' }, ...ROLES.map((r) => el('section', {}, el('h4', {}, `${ROLE_TEXT[r].icon} ${ROLE_TEXT[r].name}`), el('p', {}, ROLE_TEXT[r].text)))),
      el('h3', {}, 'Buildings'),
      el('p', {}, CAPTURE_TEXT),
      el(
        'table',
        { class: 'siege-guide-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Building'), el('th', {}, 'Bonus'), el('th', {}, 'Home advantage'))),
        el(
          'tbody',
          {},
          ...(Object.keys(BUILDING_NAME) as BuildingKind[]).map((k) => {
            const fn = HOME_FN[k];
            return el('tr', {}, el('td', {}, BUILDING_NAME[k]), el('td', {}, BUILDING_BUFF[k]), el('td', {}, fn ? `with ${HOME_LABEL[fn] ?? fn}` : 'nobody'));
          }),
        ),
      ),
      el('h3', {}, 'The siege'),
      el('p', {}, 'The units that survive a battle march on the enemy gate. The walls (stablecoins) shoot first, felling the most fragile attackers; the rest hit the keep with their Siege value, Siege units hardest. Siege damage grows every round.'),
    ];
  }

  #market(): HTMLElement[] {
    return [
      el('h3', {}, 'Markets'),
      el('ul', {}, ...REGIME_TEXT.map((r) => el('li', {}, el('strong', {}, r.name), `: ${r.text}`))),
      el('h3', {}, 'Events'),
      el('p', {}, 'At most one a week. The rumor in the Trade phase hints at what comes next.'),
      el('dl', { class: 'siege-guide-events' }, ...(Object.keys(EVENT_TEXT) as EventId[]).flatMap((id) => [el('dt', {}, EVENTS[id].name), el('dd', {}, EVENT_TEXT[id])])),
      el('h3', {}, 'Loans'),
      el('p', {}, LOAN_TEXT),
      el('h3', {}, 'Costs'),
      el('p', {}, GAS_TEXT),
    ];
  }
}
