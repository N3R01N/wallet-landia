/**
 * Every number of Siege of the Ledger's rules (spec: "All numbers live in
 * config/balance.ts, units.json, relics.json and events.json"). Systems read
 * them from here; nothing is hard-coded in the core. Tuned in M7.
 */

/** Bumped whenever a rule or number changes: a replay names the version it was played on. */
export const CONFIG_VERSION = 'siege-1';

export type PriceClass = 'btc' | 'eth' | 'largecap' | 'defi' | 'meme' | 'stable' | 'gold' | 'nft';
export type Regime = 'bull' | 'crab' | 'bear';

export const BALANCE = {
  match: {
    rounds: 7,
    /** Sudden death: one more round with siege damage ×3 and no trade phase. */
    suddenDeathSiegeMult: 3,
    /** UNIT_VALUE = the larger starting army value ÷ this. */
    unitsAtStart: 120,
    /** Default match cap and blank-build budget, in dollars. */
    matchCap: 1_000_000,
    startingBudget: 10_000,
    /** Positions under this × UNIT_VALUE make no units. */
    dustUnits: 0.25,
    /** The side with the better portfolio % change in the Market phase gets this much more ATK. */
    momentumAtk: 0.1,
    /** Above this many units a side's squads merge into ×N stacks. */
    renderCap: 300,
  },

  keep: {
    baseHp: 100,
    /** Max HP per UNIT_VALUE of stables. */
    hpPerStableUnit: 2,
    /** Damage states (fraction of max HP): cracked, breached, burning. 0 is collapsed. */
    damageStates: [0.75, 0.5, 0.25] as const,
    /**
     * Keep damage per point of Siege. Not in the spec: a stand-in until the
     * M7 balance pass, so a match runs 5–7 rounds instead of one.
     */
    siegeScale: 0.22,
    /** Siege-role units deal this many times their Siege value to the keep. */
    siegeRoleMult: 1.5,
    /**
     * Not in the spec (M7 balance): siege damage grows each round by this share
     * (round 7 hits 1 + 6 × this), so defensive matches end before sudden death.
     */
    siegeRoundGrowth: 0.35,
  },

  market: {
    daysPerRound: 7,
    /** A regime stays with this probability each round; otherwise it moves to one of the others. */
    regimeStay: 0.7,
    /** Daily drift and spread of the shared market move, per regime. */
    regimes: {
      bull: { mu: 0.01, sigma: 0.02 },
      crab: { mu: 0, sigma: 0.015 },
      bear: { mu: -0.01, sigma: 0.025 },
    } satisfies Record<Regime, { mu: number; sigma: number }>,
    startRegime: 'crab' as Regime,
    /** Per price class: beta to the market and own daily volatility. */
    classes: {
      btc: { beta: 0.8, sigma: 0.025 },
      eth: { beta: 1.0, sigma: 0.035 },
      largecap: { beta: 1.3, sigma: 0.05 },
      defi: { beta: 1.2, sigma: 0.06 },
      meme: { beta: 1.8, sigma: 0.12 },
      stable: { beta: 0, sigma: 0 },
      gold: { beta: 0.1, sigma: 0.01 },
      nft: { beta: 0.9, sigma: 0.04 },
    } satisfies Record<PriceClass, { beta: number; sigma: number }>,
    /** LSTs follow their base asset with this much daily noise. */
    lstNoise: 0.002,
    /** Memecoins' fat tails: a daily chance of a jump of ± this size. */
    memeJumpChance: 0.03,
    memeJump: 0.25,
  },

  events: {
    /** Chance that a Market phase has an event. */
    chance: 0.4,
    /** Chance that the rumor in the Trade phase before tells the truth. */
    rumorAccuracy: 0.7,
  },

  ledger: {
    /** Gas per action, in UNIT_VALUEs (paid in ETH, else stables). */
    gasUnits: 0.1,
    swapFee: 0.003,
    /** Slippage per 10 × UNIT_VALUE of trade size. */
    slippagePer10Units: 0.005,
    maxSlippage: 0.5,
    ltv: 0.7,
    liquidationThreshold: 0.8,
    liquidationPenalty: 0.1,
    /** Share of the debt repaid at each liquidation step. */
    liquidationRepay: 0.5,
    /** Per round, paid into the position at the start of each Market phase. */
    debtGrowth: 0.02,
    supplyYield: 0.015,
    restakeYield: 0.03,
    lpFee: 0.01,
    /** Rounds an unstake takes. */
    unstakeRounds: 1,
    /** HF below this turns the gauge amber. */
    hfWarning: 1.2,
  },

  npc: {
    /** An NPC's starting value against the player's (spec: "Difficulty"). */
    valueMult: { easy: 0.7, normal: 1, hard: 1.25 },
  },

  battle: {
    /** Logic ticks per second, and the longest battle. */
    tickHz: 20,
    maxSeconds: 45,
    /** Counter triangle bonus, and the area bonus against Swarm. */
    counterBonus: 0.5,
    swarmAreaBonus: 0.5,
    /** Siege units deal this much damage to units. */
    siegeVsUnits: 0.5,
  },
} as const;

export type Balance = typeof BALANCE;
