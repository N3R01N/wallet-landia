import { describe, expect, it } from 'vitest';
import { biggestErrand, courierLook } from '../src/castle/world/rare.js';
import { isNight } from '../src/castle/world/sky.js';
import type { Errand } from '../src/castle/world/world.js';

let n = 0;
function errand(o: Partial<Errand>): Errand {
  n++;
  return {
    key: `ethereum:0x${n}`, protocolId: null, direction: 'out', failed: false, hash: `0x${n}`, chainId: 'ethereum', verb: 'send', valueUsd: 10, feeUsd: 1,
    wallet: '0xa', steps: [], method: null, block: 1, tier: 1, time: n, label: '', ...o,
  };
}

describe('rare moments', () => {
  it('the biggest errand moved the most; failed ones moved nothing; the latest wins a tie', () => {
    const small = errand({ valueUsd: 50 });
    const big = errand({ valueUsd: 9000 });
    const failed = errand({ valueUsd: 1e6, failed: true });
    const tie = errand({ valueUsd: 9000 });
    expect(biggestErrand([small, big, failed])).toBe(big);
    expect(biggestErrand([small, big, failed, tie])).toBe(tie);
    expect(biggestErrand([errand({ valueUsd: 0 }), failed])).toBeNull();
    expect(biggestErrand([])).toBeNull();
  });

  it('night is from half past seven in the evening to half past six in the morning', () => {
    expect(isNight(23)).toBe(true);
    expect(isNight(2)).toBe(true);
    expect(isNight(20)).toBe(true);
    expect(isNight(6)).toBe(true);
    expect(isNight(7)).toBe(false);
    expect(isNight(12)).toBe(false);
    expect(isNight(19)).toBe(false);
    expect(isNight(26)).toBe(true); // 2 at night, the day after
  });

  it('gold for the biggest, a ghost for a failed one at night, else as usual', () => {
    const big = errand({ valueUsd: 9000 });
    const failed = errand({ failed: true });
    expect(courierLook(big, { biggest: big.key, night: true })).toBe('gold');
    expect(courierLook(failed, { biggest: big.key, night: true })).toBe('ghost');
    expect(courierLook(failed, { biggest: big.key, night: false })).toBeNull();
    expect(courierLook(errand({}), { biggest: big.key, night: true })).toBeNull();
  });
});
