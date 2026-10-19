/**
 * What units shout when their side wins something (render/barks.ts shows
 * it): crypto and gaming banter. Your side's winners hype; the enemy's taunt
 * you. Short, so a bubble holds them.
 */

export type BarkMoment = 'kill' | 'fight' | 'building' | 'match';

/** Your side winning. */
const HYPE: Readonly<Record<BarkMoment, readonly string[]>> = {
  kill: ['Rekt', 'Ez clap', 'Headshot!', 'Too easy', 'Get rekt', 'Based', 'Combo!', 'Next!', 'Sit down', 'Bullish'],
  fight: ['WAGMI', 'LFG!', 'Epic!', 'GG ez', 'We’re so back', 'Few understand', 'Number go up 📈', 'Diamond hands 💎', 'To the moon 🚀', 'Built different', 'Clutch!', 'Up only', 'Probably nothing', 'This is the way', 'Flawless victory', 'No cap, clean', 'Ser, we won'],
  building: ['Rugged!', 'Liquidated 💀', 'That’s a rug', 'Burned 🔥', 'Down only (for them)', 'Exit liquidity', 'Funds are SAFU (ours)', 'Their TVL: zero'],
  match: ['GG WP', 'WAGMI', 'Generational wealth', 'We made it, frens', 'Retire at 30', 'Victory royale', 'Lambo time 🏎', 'Wen moon? Now.', 'Gm, winners'],
};

/** The enemy winning: at you. */
const TAUNT: Readonly<Record<BarkMoment, readonly string[]>> = {
  kill: ['Rekt', 'Skill issue', 'Git gud', 'Noob', 'Cope', 'Paper hands 🧻', 'Down bad, bro', 'Sit down'],
  fight: ['You are NGMI', 'Down bad, bro', 'Have fun staying poor', 'Skill issue', 'Get liquidated', 'It’s so over (for you)', 'Touch grass', 'L + ratio', 'Should’ve staked', 'Imagine selling the bottom', 'Ser, that was your army', 'Exit liquidity', 'Rekt, ser'],
  building: ['Rugged, ser', 'Your bags: burned 🔥', 'Liquidated 💀', 'NGMI', 'Funds are not SAFU', 'That’s a rug', 'Should’ve diversified'],
  match: ['GG no re', 'NGMI', 'Have fun staying poor', 'Down bad, bro', 'It’s over, ser', 'Back to the trenches', 'Ratio’d', 'Imagine losing'],
};

/** A line for this moment, by whose side won it. */
export function bark(moment: BarkMoment, mineWon: boolean, rnd: () => number = Math.random): string {
  const lines = (mineWon ? HYPE : TAUNT)[moment];
  return lines[Math.floor(rnd() * lines.length)]!;
}
