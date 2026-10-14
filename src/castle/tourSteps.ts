/**
 * The castle's first-visit tour: what is on screen, and the way to your own
 * castle (a Zerion key and a wallet in the Guild tab).
 */

import type { TourStep } from './tour.js';
import type { TabId } from './shellState.js';

export interface TourContext {
  /** Show a tab. */
  go(tab: TabId): void;
  /** What a step points at, by selector (null: a card in the middle). */
  find(selector: string): HTMLElement | null;
  /** The castle on show is a demo (no wallets of the player's yet). */
  demo: boolean;
}

export function tourSteps(ctx: TourContext): TourStep[] {
  return [
    {
      title: 'Welcome to your castle',
      body: [
        ctx.demo ? 'This is a demo castle, made from sample wallets. Add your own in a moment.' : 'Your Ethereum wallets are a castle; the chain is the town in front of it.',
        'Everything here is read from the chain: nothing can move your coins.',
      ],
      before: () => ctx.go('castle'),
    },
    {
      title: 'The castle grows with you',
      body: ['Each wallet is a tower on the walls. The keep grows with what all your wallets are worth together, and each kind of protocol you use adds a wing.'],
      target: () => ctx.find('.castle-view canvas'),
    },
    {
      title: 'The town is the chain',
      body: [
        'Each protocol you use has a building. Tap one to see what you keep there.',
        'The bell in the tower rings for every new block.',
      ],
      before: () => ctx.go('town'),
      target: () => ctx.find('.castle-view canvas'),
    },
    {
      title: 'Couriers are your transactions',
      body: ['The drawbridge lowers, a courier pays the toll (the gas fee) at the border post and walks to the protocol’s door, where someone comes out to take the goods. Tap a courier to see its transaction.'],
      target: () => ctx.find('.castle-view canvas'),
    },
    {
      title: 'The chronicle and the replay',
      body: ['The Chronicle lists your recent transactions. Replay plays your whole history as time going by.'],
      target: () => ctx.find('.chronicle-btn'),
    },
    {
      title: 'Badges and quests',
      body: ['Your level, rank and badges come from all your wallets’ history. Quests there teach good habits, like taking back old approvals.'],
      target: () => ctx.find('.tab[data-tab="badges"]'),
    },
    {
      title: 'Make it yours',
      body: ['Add your free Zerion key and your wallets here. The key stays in this browser.'],
      before: () => ctx.go('guild'),
      target: () => ctx.find('[data-section="key"]'),
    },
  ];
}
