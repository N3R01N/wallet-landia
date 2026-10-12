/** The first-visit tour's steps: what each points at, and what it says. */

import { el } from './dom.js';
import type { TourStep } from './tour.js';

export interface TourRefs {
  stage: HTMLElement;
  views: HTMLElement;
  guildBtn: HTMLElement;
  buildBtn: HTMLElement;
  legend: HTMLElement;
  /** Open the Guild panel, unless it already is (the last steps point into it). */
  showGuild: () => void;
}

export function tourSteps(refs: TourRefs): TourStep[] {
  const q = (sel: string): (() => HTMLElement | null) => () => document.querySelector<HTMLElement>(sel);
  const link = el('a', { href: 'https://dashboard.zerion.io', target: '_blank', rel: 'noopener noreferrer' }, 'dashboard.zerion.io ↗');
  return [
    {
      title: 'Welcome to Wallet-landia',
      body: [
        'Your Ethereum wallets as a little RPG town: every wallet a hero, every app a building, every transaction a quest.',
        el('p', {}, el('strong', {}, 'What you see now is a demo town. '), 'Its heroes are demo wallets, not yours. In a minute you can add your own, and they move in instead.'),
      ],
    },
    {
      title: 'The town',
      body: [
        'Each hero is a wallet. Their mount (a donkey up to a griffin) and their home grow with what the wallet holds.',
        'Each building is a protocol the wallets used: exchanges are bazaars, lending is a counting house, staking is the temple. Heroes walk there to replay their transactions; until you build one, they set off for it through the town gate.',
        'The Chronicle Tower in the square is the blockchain itself: its bell rings for every block, the line at its door shows how busy the chain is, the board shows the gas fee, and the fire on top burns green when it is cheap and red when it is dear.',
        'Click any hero or building to look inside.',
      ],
      target: () => refs.stage,
    },
    {
      title: 'Build your town',
      body: [
        'Your town starts as the square. Open 🔨 Build (or press B) to put up your heroes\' homes and every building their history unlocked: pick one, then click where it should stand. Roads lay themselves.',
        'R turns a building, M or a drag moves it, Del stores it, Ctrl+Z undoes. Your land grows with your level, and you can share your town (or just its design) with friends.',
      ],
      target: () => refs.buildBtn,
    },
    {
      title: 'The quest log',
      body: ['Every transaction becomes a quest. The newest appear here as the town replays them; click one to see exactly what happened, and replay it on its own.'],
      target: q('.questlog'),
    },
    {
      title: 'The value scale',
      body: ['One colour scale for everything worth money: item frames, mounts, homes and caravans, from Dust (under $10) to Mythic (over $1M). Click its title to fold it away.'],
      target: () => refs.legend,
    },
    {
      title: 'The timeline',
      body: ['The town replays the wallets\' recent history. Pause, change the speed, or drag to jump; at the end it goes live and plays new transactions as they happen.'],
      target: q('footer.timeline'),
    },
    {
      title: 'Views and looks',
      body: ['Switch between top-down, isometric and 3D here. Under 🎨 Looks you can pick a world theme for the 3D town: medieval, highland, modern or sci-fi.'],
      target: () => refs.views,
    },
    {
      title: 'Make it yours',
      body: ['Your own wallets are set up in the ⚙ Guild panel. Click Next to open it.'],
      target: () => refs.guildBtn,
    },
    {
      title: '1. A Zerion key',
      body: [el('p', {}, 'The town reads wallets through Zerion. Get a free API key at ', link, ', paste it here and click Save. It is kept only in this browser.')],
      before: refs.showGuild,
      target: q('.inspector input[aria-label="Zerion API key"]'),
    },
    {
      title: '2. Your wallets',
      body: ['Add a wallet address (0x…) or an ENS name (name.eth) and click Add, or Connect wallet. Each one becomes a hero; the demo heroes leave as soon as your first wallet has loaded.'],
      before: refs.showGuild,
      target: q('.inspector input[aria-label="0x… or name.eth"]'),
    },
    {
      title: 'Off you go',
      body: ['That is all. You can show this tour again any time with the ? button at the top.'],
    },
  ];
}
