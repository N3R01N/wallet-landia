/**
 * The client's job is to be boring under stress: page to the end, back off when
 * told to, and give up loudly when retrying cannot possibly help.
 *
 * `fetch` and `sleep` are injected, so these run with no network and no delay.
 */

import { describe, expect, it } from 'vitest';
import { ZerionClient, ZerionError, readRateLimit, retryDelayMs } from '../src/data/zerion/client.js';
import { Pacer } from '../src/data/zerion/pacer.js';
import { PROXY_BASE } from '../src/data/zerion/transport.js';
import { DailyBudget } from '../src/data/zerion/budget.js';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that replays a scripted list of responses and records every call. */
function scriptedFetch(responses: Response[]): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const response = responses[index++];
    if (response === undefined) throw new Error(`unscripted request: ${url}`);
    return Promise.resolve(response);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function page(ids: string[], next?: string) {
  return json({
    links: next === undefined ? { self: 'x' } : { self: 'x', next },
    data: ids.map((id) => ({ id })),
  });
}

/**
 * A clock the client's own sleeps drive forward. Nothing here waits in real
 * time, but elapsed time still behaves — which the pacer depends on.
 */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  delays: number[];
} {
  let current = 1_000_000;
  const delays: number[] = [];
  return {
    now: () => current,
    delays,
    sleep: (ms: number) => {
      delays.push(ms);
      current += ms;
      return Promise.resolve();
    },
  };
}

/**
 * Virtual time for the concurrency tests.
 *
 * `fakeClock` above is fine for one request at a time, but it advances the
 * clock the instant a sleep is *requested*, so several suspended requests all
 * resume seeing the same final timestamp — which would make any burst look
 * perfectly spaced. This one only moves time when nothing else can run, and
 * only as far as the earliest pending wake-up, so concurrent sleepers resume in
 * the order and at the times they actually would.
 */
function virtualClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  run: <T>(work: Promise<T>) => Promise<T>;
} {
  let current = 1_000_000;
  let seq = 0;
  const timers: { at: number; seq: number; wake: () => void }[] = [];

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      timers.push({ at: current + Math.max(0, ms), seq: seq++, wake: resolve });
    });

  /** Let every already-runnable continuation finish before time moves. */
  const drain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  async function run<T>(work: Promise<T>): Promise<T> {
    let settled = false;
    const tracked = work.then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        throw error;
      },
    );
    tracked.catch(() => undefined); // the caller does the asserting

    for (;;) {
      await drain();
      if (settled || timers.length === 0) break;
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = timers.shift()!;
      current = Math.max(current, next.at);
      next.wake();
    }
    return tracked;
  }

  return { now: () => current, sleep, run };
}

const KEY = 'test-key';

/**
 * Most tests are not about pacing, so they run at a pace that never delays.
 * The ones that *are* about pacing set `requestsPerSecond` themselves.
 */
function testClient(
  clock: ReturnType<typeof fakeClock>,
  options: Partial<ConstructorParameters<typeof ZerionClient>[0]> & {
    fetch: typeof globalThis.fetch;
  },
): ZerionClient {
  return new ZerionClient({
    apiKey: KEY,
    transport: 'direct',
    requestsPerSecond: 1000,
    now: clock.now,
    sleep: clock.sleep,
    ...options,
  });
}

describe('auth and URL construction', () => {
  it('sends Basic auth with the trailing colon Zerion requires', async () => {
    const { fetch, calls } = scriptedFetch([json({ data: { id: 'p' } })]);
    const client = testClient(fakeClock(), { fetch });

    await client.getOne('/wallets/0xabc/portfolio', { currency: 'usd' });

    const header = new Headers(calls[0]?.init?.headers).get('authorization');
    expect(header).toBe(`Basic ${Buffer.from(`${KEY}:`).toString('base64')}`);
    expect(calls[0]?.url).toBe('https://api.zerion.io/v1/wallets/0xabc/portfolio?currency=usd');
  });

  it('leaves JSON:API brackets readable in the query string', async () => {
    const { fetch, calls } = scriptedFetch([page([])]);
    const client = testClient(fakeClock(), { fetch });

    await client.getPage('/wallets/0xabc/positions/', { 'filter[positions]': 'only_simple' });

    expect(calls[0]?.url).toContain('filter[positions]=only_simple');
  });
});

describe('pagination', () => {
  it('follows links.next to the end', async () => {
    const { fetch, calls } = scriptedFetch([
      page(['a', 'b'], 'https://api.zerion.io/v1/wallets/0xabc/transactions/?page[after]=2'),
      page(['c', 'd'], 'https://api.zerion.io/v1/wallets/0xabc/transactions/?page[after]=4'),
      page(['e']),
    ]);
    const client = testClient(fakeClock(), { fetch });

    const all = await client.getAll<{ id: string }>('/wallets/0xabc/transactions/');

    expect(all.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(calls).toHaveLength(3);
  });

  it('stops at the page cap so a bad filter cannot spin forever', async () => {
    const endless = () => page(['x'], 'https://api.zerion.io/v1/next');
    const { fetch, calls } = scriptedFetch([endless(), endless(), endless(), endless()]);
    const client = testClient(fakeClock(), { fetch });

    const all = await client.getAll<{ id: string }>('/wallets/0xabc/transactions/', {}, {
      maxPages: 2,
    });

    expect(all).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it('rewrites absolute next-URLs onto the proxy, which is the whole point of the proxy', async () => {
    const { fetch, calls } = scriptedFetch([
      page(['a'], 'https://api.zerion.io/v1/wallets/0xabc/transactions/?page[after]=2'),
      page(['b']),
    ]);
    const client = testClient(fakeClock(), { fetch, transport: 'proxy' });

    await client.getAll('/wallets/0xabc/transactions/');

    expect(calls[0]?.url.startsWith(PROXY_BASE)).toBe(true);
    expect(calls[1]?.url).toBe(`${PROXY_BASE}/wallets/0xabc/transactions/?page[after]=2`);
  });

  it('leaves next-URLs alone on the direct transport', async () => {
    const { fetch, calls } = scriptedFetch([
      page(['a'], 'https://api.zerion.io/v1/wallets/0xabc/transactions/?page[after]=2'),
      page(['b']),
    ]);
    const client = testClient(fakeClock(), { fetch });

    await client.getAll('/wallets/0xabc/transactions/');

    expect(calls[1]?.url).toBe('https://api.zerion.io/v1/wallets/0xabc/transactions/?page[after]=2');
  });

  it('stops paginating once the caller aborts', async () => {
    const controller = new AbortController();
    const { fetch, calls } = scriptedFetch([
      page(['a'], 'https://api.zerion.io/v1/next'),
      page(['b'], 'https://api.zerion.io/v1/next'),
    ]);
    const client = testClient(fakeClock(), {
      fetch: ((url: string, init?: RequestInit) => {
        controller.abort();
        return fetch(url, init);
      }) as unknown as typeof globalThis.fetch,
    });

    const all = await client.getAll<{ id: string }>('/wallets/0xabc/transactions/', {}, {
      signal: controller.signal,
    });

    expect(all.map((item) => item.id)).toEqual(['a']);
    expect(calls).toHaveLength(1);
  });
});

describe('rate limiting', () => {
  const limited = (headers: Record<string, string>) =>
    json({ errors: [{ title: 'Too Many Requests' }] }, { status: 429, headers });

  it('waits the interval Zerion names, then succeeds', async () => {
    const { fetch } = scriptedFetch([
      limited({
        'RateLimit-Org-Second-Reset': '1',
        'RateLimit-Org-Day-Remaining': '900',
        'RateLimit-Org-Month-Remaining': '20000',
      }),
      json({ data: { id: 'p' } }),
    ]);
    const clock = fakeClock();
    const client = testClient(clock, { fetch });
    const { delays } = clock;

    await expect(client.getOne('/wallets/0xabc/portfolio')).resolves.toEqual({ id: 'p' });
    expect(delays).toEqual([1050]);
  });

  it('backs off exponentially when no reset header is given', async () => {
    const { fetch } = scriptedFetch([
      limited({ 'RateLimit-Org-Day-Remaining': '900' }),
      limited({ 'RateLimit-Org-Day-Remaining': '900' }),
      json({ data: { id: 'p' } }),
    ]);
    const clock = fakeClock();
    const client = testClient(clock, { fetch });
    const { delays } = clock;

    await client.getOne('/wallets/0xabc/portfolio');

    expect(delays).toEqual([250, 500]);
  });

  it('gives up as rate-limit once the retries are spent', async () => {
    const { fetch, calls } = scriptedFetch([
      limited({ 'RateLimit-Org-Day-Remaining': '900' }),
      limited({ 'RateLimit-Org-Day-Remaining': '900' }),
      limited({ 'RateLimit-Org-Day-Remaining': '900' }),
    ]);
    const client = testClient(fakeClock(), { fetch, maxRetries: 2 });

    const error = await client.getOne('/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ZerionError);
    expect((error as ZerionError).kind).toBe('rate-limit');
    expect((error as ZerionError).transient).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('does not retry an exhausted day budget — retrying burns requests against a wall', async () => {
    const { fetch, calls } = scriptedFetch([
      limited({ 'RateLimit-Org-Day-Remaining': '0', 'RateLimit-Org-Second-Reset': '1' }),
    ]);
    const clock = fakeClock();
    const client = testClient(clock, { fetch });
    const { delays } = clock;

    const error = await client.getOne('/x').catch((caught: unknown) => caught);
    expect((error as ZerionError).kind).toBe('quota');
    expect((error as ZerionError).transient).toBe(false);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('treats an exhausted month budget the same way', async () => {
    const { fetch } = scriptedFetch([limited({ 'RateLimit-Org-Month-Remaining': '0' })]);
    const client = testClient(fakeClock(), { fetch });

    const error = await client.getOne('/x').catch((caught: unknown) => caught);
    expect((error as ZerionError).kind).toBe('quota');
    expect((error as ZerionError).message).toContain('monthly');
  });

  it('exposes the last rate-limit snapshot for the HUD', async () => {
    const { fetch } = scriptedFetch([
      json({ data: {} }, { headers: { 'RateLimit-Org-Day-Remaining': '842', 'RateLimit-Org-Tier': 'free' } }),
    ]);
    const client = testClient(fakeClock(), { fetch });

    await client.getOne('/x');

    expect(client.rateLimit?.dayRemaining).toBe(842);
    expect(client.rateLimit?.tier).toBe('free');
  });

  it('caps a hostile reset value rather than freezing the app', () => {
    expect(
      retryDelayMs(
        {
          secondLimit: 1,
          secondRemaining: 0,
          secondReset: 600,
          dayRemaining: 1,
          monthRemaining: 1,
          tier: null,
        },
        0,
      ),
    ).toBe(5000);
  });

  it('reads missing and malformed headers as absent, not as zero', () => {
    const limits = readRateLimit(new Headers({ 'RateLimit-Org-Day-Remaining': 'soon' }));
    expect(limits.dayRemaining).toBeNull();
    expect(limits.secondReset).toBeNull();
  });

  it('reads the per-second limit, which is what the pacer aims at', () => {
    const limits = readRateLimit(new Headers({ 'RateLimit-Org-Second-Limit': '5' }));
    expect(limits.secondLimit).toBe(5);
  });
});

/**
 * The regression that motivated the pacer: four snapshot calls in one
 * `Promise.all` against a one-per-second plan, all throttled, all backing off
 * by the same interval, all firing again together. Retrying a herd reproduces
 * the herd.
 */
describe('parallel requests on a slow plan', () => {
  /** A fetch that 429s whenever two requests start within the same second. */
  function limitedFetch(perSecond: number, now: () => number) {
    const starts: number[] = [];
    const calls: { url: string; at: number; throttled: boolean }[] = [];
    const fetch = ((url: string) => {
      const at = now();
      const inWindow = starts.filter((t) => at - t < 1000).length;
      starts.push(at);
      const throttled = inWindow >= perSecond;
      calls.push({ url, at, throttled });
      if (throttled) {
        return Promise.resolve(
          json(
            { errors: [{ title: 'Too many requests' }] },
            {
              status: 429,
              headers: {
                'RateLimit-Org-Second-Limit': String(perSecond),
                'RateLimit-Org-Second-Reset': '1',
                'RateLimit-Org-Day-Remaining': '900',
              },
            },
          ),
        );
      }
      return Promise.resolve(
        json(
          { data: { id: url } },
          { headers: { 'RateLimit-Org-Second-Limit': String(perSecond) } },
        ),
      );
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls };
  }

  function pacedClient(
    clock: ReturnType<typeof virtualClock>,
    fetch: typeof globalThis.fetch,
    requestsPerSecond?: number,
  ): ZerionClient {
    const options: ConstructorParameters<typeof ZerionClient>[0] = {
      apiKey: KEY,
      transport: 'direct',
      fetch,
      now: clock.now,
      sleep: clock.sleep,
    };
    if (requestsPerSecond !== undefined) options.requestsPerSecond = requestsPerSecond;
    return new ZerionClient(options);
  }

  it('completes four concurrent requests on a one-per-second plan', async () => {
    const clock = virtualClock();
    const { fetch, calls } = limitedFetch(1, clock.now);
    const client = pacedClient(clock, fetch);

    // This is exactly the shape of fetchWalletSnapshot.
    const all = await clock.run(
      Promise.all([
        client.getOne('/portfolio'),
        client.getOne('/positions-simple'),
        client.getOne('/positions-complex'),
        client.getOne('/transactions'),
      ]),
    );

    expect(all).toHaveLength(4);
    // Before the pacer this was four requests at t=0, three of them 429.
    expect(calls.filter((call) => call.throttled)).toHaveLength(0);
    expect(calls).toHaveLength(4);
  });

  it('spaces the requests it sends rather than bursting', async () => {
    const clock = virtualClock();
    const { fetch, calls } = limitedFetch(1, clock.now);
    const client = pacedClient(clock, fetch);

    await clock.run(
      Promise.all([client.getOne('/a'), client.getOne('/b'), client.getOne('/c')]),
    );

    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(1000);
    }
  });

  it('speeds up once the plan reports a generous limit', async () => {
    const clock = virtualClock();
    const { fetch, calls } = limitedFetch(20, clock.now);
    const client = pacedClient(clock, fetch);

    // The first request pays for the pessimistic default; the rest learn from it.
    await clock.run(client.getOne('/warmup'));
    await clock.run(
      Promise.all([client.getOne('/a'), client.getOne('/b'), client.getOne('/c')]),
    );

    expect(client.requestGapMs).toBeLessThan(100);
    expect(calls.filter((call) => call.throttled)).toHaveLength(0);
  });

  it('recovers when a burst gets through and is throttled anyway', async () => {
    const clock = virtualClock();
    const { fetch, calls } = limitedFetch(1, clock.now);
    // Told to go fast against a plan that allows one per second, so the first
    // requests genuinely burst and genuinely 429.
    const client = pacedClient(clock, fetch, 50);

    await clock.run(
      Promise.all([client.getOne('/a'), client.getOne('/b'), client.getOne('/c')]),
    );

    // Some were throttled — but the penalty applies to the whole queue, so
    // every one of them eventually lands rather than retrying in lockstep.
    expect(calls.filter((call) => call.throttled).length).toBeGreaterThan(0);
    expect(calls.filter((call) => !call.throttled)).toHaveLength(3);
  });
});

describe('error classification', () => {
  const cases: [number, string][] = [
    [400, 'bad-request'],
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not-found'],
    [500, 'server'],
  ];

  for (const [status, kind] of cases) {
    it(`reads ${status} as ${kind}`, async () => {
      const { fetch } = scriptedFetch([
        json({ errors: [{ title: 'Nope', detail: 'because' }] }, { status }),
      ]);
      const client = testClient(fakeClock(), { fetch });

      const error = (await client.getOne('/x').catch((caught: unknown) => caught)) as ZerionError;
      expect(error.kind).toBe(kind);
      expect(error.message).toBe('Nope: because');
      expect(error.status).toBe(status);
    });
  }

  it('falls back to the status text when the body is not JSON', async () => {
    const { fetch } = scriptedFetch([new Response('<html>gateway</html>', { status: 502 })]);
    const client = testClient(fakeClock(), { fetch });

    const error = (await client.getOne('/x').catch((caught: unknown) => caught)) as ZerionError;
    expect(error.kind).toBe('server');
    expect(error.message).toBeTruthy();
  });

  it('reports a fetch that never completed as a network error, which is what CORS looks like', async () => {
    const client = testClient(fakeClock(), {
      fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof globalThis.fetch,
    });

    const error = (await client.getOne('/x').catch((caught: unknown) => caught)) as ZerionError;
    expect(error.kind).toBe('network');
    expect(error.transient).toBe(true);
    expect(error.message).toContain('CORS');
  });

  it('lets an abort propagate instead of dressing it up as a network failure', async () => {
    const client = testClient(fakeClock(), {
      fetch: (() => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        return Promise.reject(abort);
      }) as unknown as typeof globalThis.fetch,
    });

    const error = (await client.getOne('/x').catch((caught: unknown) => caught)) as Error;
    expect(error).not.toBeInstanceOf(ZerionError);
    expect(error.name).toBe('AbortError');
  });
});

/**
 * The pacer's penalty, in isolation.
 *
 * The client tests above prove a burst eventually lands. These prove *how*:
 * that a 429 reaches requests which have already claimed their slot and are
 * sitting in the queue, not just the ones yet to arrive. That distinction is
 * the whole reason `penalize` exists — on a cold load all four snapshot calls
 * claim their slots in the same tick, so a penalty that only moved the claim
 * pointer would restrain none of them.
 */
describe('Pacer: a 429 holds back the whole queue', () => {
  function harness() {
    let current = 0;
    let seq = 0;
    const timers: { at: number; seq: number; wake: () => void }[] = [];
    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        timers.push({ at: current + Math.max(0, ms), seq: seq++, wake: resolve });
      });
    const drain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
    async function settle(): Promise<void> {
      for (let guard = 0; guard < 1000; guard++) {
        await drain();
        if (timers.length === 0) return;
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = timers.shift()!;
        current = Math.max(current, next.at);
        next.wake();
      }
    }
    return { now: () => current, sleep, settle };
  }

  it('delays requests that had already claimed their slot', async () => {
    const clock = harness();
    const pacer = new Pacer({ requestsPerSecond: 1000, now: clock.now, sleep: clock.sleep });

    const starts: number[] = [];
    // Three requests claim their slots in one tick, exactly as `Promise.all`
    // does on a cold load. The first is free to go at once — it is the one
    // that will come back 429 — and the other two are left waiting their turn.
    const queue = Promise.all(
      [0, 1, 2].map(async () => {
        await pacer.acquire();
        starts.push(clock.now());
      }),
    );

    pacer.penalize(5_000);
    await clock.settle();
    await queue;

    expect(starts).toHaveLength(3);
    // The two still in the queue waited the penalty out. Before this, moving
    // only the claim pointer left them to fire on their original schedule and
    // collect a 429 apiece — the lockstep retry the pacer exists to prevent.
    const held = starts.filter((at) => at > 0);
    expect(held).toHaveLength(2);
    for (const start of held) expect(start).toBeGreaterThanOrEqual(5_000);
  });

  it('still lets the queue drain once the penalty expires', async () => {
    const clock = harness();
    const pacer = new Pacer({ requestsPerSecond: 1000, now: clock.now, sleep: clock.sleep });

    const queue = Promise.all([pacer.acquire(), pacer.acquire()]);
    pacer.penalize(1_000);
    await clock.settle();

    await expect(queue).resolves.toHaveLength(2);
    expect(clock.now()).toBeGreaterThanOrEqual(1_000);
  });

  it('takes the longest of several penalties, not the last', async () => {
    const clock = harness();
    const pacer = new Pacer({ requestsPerSecond: 1000, now: clock.now, sleep: clock.sleep });

    // Two responses land in the same moment, one asking for a much longer wait
    // than the other. A shorter penalty must never shorten the hold.
    pacer.penalize(9_000);
    pacer.penalize(1_000);

    const started = pacer.acquire().then(() => clock.now());
    await clock.settle();
    await expect(started).resolves.toBeGreaterThanOrEqual(9_000);
  });

  it('does not hold anything back when nothing was penalised', async () => {
    const clock = harness();
    const pacer = new Pacer({ requestsPerSecond: 1000, now: clock.now, sleep: clock.sleep });
    await pacer.acquire();
    expect(clock.now()).toBe(0);
  });
});

describe('responses that do not match the documented shape', () => {
  it('stops paginating on a page with no links object at all', async () => {
    // `ZerionList.links` is a claim about someone else's server, not a
    // guarantee. Trusting it threw a raw TypeError out of the middle of a load,
    // past every bit of error classification the client does.
    const clock = fakeClock();
    const client = testClient(clock, {
      fetch: scriptedFetch([json({ data: [{ id: 'a' }] })]).fetch,
    });

    await expect(client.getAll('/things')).resolves.toEqual([{ id: 'a' }]);
  });

  it('stops paginating on an empty page with no links', async () => {
    const clock = fakeClock();
    const client = testClient(clock, { fetch: scriptedFetch([json({ data: [] })]).fetch });
    await expect(client.getAll('/things')).resolves.toEqual([]);
  });
});

/**
 * The daily budget, where the client meets it.
 *
 * The counting rule is "a response means a request was billed" — a 400 and a
 * 429 cost exactly what a 200 costs, and a retry costs again. The refusal rule
 * is that the last request is the last one: past the limit the client must not
 * spend a request to be told it has none.
 */
describe('spending the daily budget', () => {
  const budgetAt = (limit: number): DailyBudget =>
    new DailyBudget({ storage: null, now: () => Date.parse('2026-08-09T12:00:00Z'), limit });

  it('counts one per request, including every page of a paginated haul', async () => {
    const clock = fakeClock();
    const budget = budgetAt(300);
    const client = testClient(clock, {
      budget,
      fetch: scriptedFetch([
        json({ data: [{ id: 'a' }], links: { next: 'https://api.zerion.io/v1/things?page=2' } }),
        json({ data: [{ id: 'b' }] }),
      ]).fetch,
    });

    await client.getAll('/things');
    expect(budget.used).toBe(2);
  });

  it('counts a failed request too — the server was asked either way', async () => {
    const clock = fakeClock();
    const budget = budgetAt(300);
    const client = testClient(clock, {
      budget,
      fetch: scriptedFetch([json({ errors: [{ title: 'Bad' }] }, { status: 400 })]).fetch,
    });

    await expect(client.getOne('/things/1')).rejects.toThrow(ZerionError);
    expect(budget.used).toBe(1);
  });

  it('counts every retry of a rate-limited request', async () => {
    const clock = fakeClock();
    const budget = budgetAt(300);
    const client = testClient(clock, {
      budget,
      maxRetries: 2,
      fetch: scriptedFetch([
        json({}, { status: 429 }),
        json({}, { status: 429 }),
        json({ data: { id: 'a' } }),
      ]).fetch,
    });

    await client.getOne('/things/1');
    // Two refusals and the one that worked: three requests, three spent.
    expect(budget.used).toBe(3);
  });

  it('does not count a request that never completed', async () => {
    const clock = fakeClock();
    const budget = budgetAt(300);
    const failing = (() => Promise.reject(new TypeError('Failed to fetch'))) as
      unknown as typeof globalThis.fetch;
    const client = testClient(clock, { budget, fetch: failing });

    await expect(client.getOne('/things/1')).rejects.toMatchObject({ kind: 'network' });
    expect(budget.used).toBe(0);
  });

  it('refuses to send once the budget is spent, rather than spending one to find out', async () => {
    const clock = fakeClock();
    const budget = budgetAt(1);
    const { fetch, calls } = scriptedFetch([json({ data: { id: 'a' } })]);
    const client = testClient(clock, { budget, fetch });

    await client.getOne('/things/1');
    expect(calls).toHaveLength(1);

    await expect(client.getOne('/things/2')).rejects.toMatchObject({ kind: 'quota' });
    // The point: no second call was made.
    expect(calls).toHaveLength(1);
  });

  it('says what is spent and when it comes back', async () => {
    const clock = fakeClock();
    const budget = budgetAt(1);
    const client = testClient(clock, {
      budget,
      now: () => Date.parse('2026-08-09T12:00:00Z'),
      fetch: scriptedFetch([json({ data: { id: 'a' } })]).fetch,
    });

    await client.getOne('/things/1');
    await expect(client.getOne('/things/2')).rejects.toThrow(/midnight UTC, in 12 hours/);
  });

  it('adopts the API’s own day count when it is lower than ours', async () => {
    const clock = fakeClock();
    const budget = budgetAt(300);
    const client = testClient(clock, {
      budget,
      fetch: scriptedFetch([
        json({ data: { id: 'a' } }, { headers: { 'RateLimit-Org-Day-Remaining': '12' } }),
      ]).fetch,
    });

    await client.getOne('/things/1');
    expect(budget.remaining).toBe(12);
  });

  it('stops retrying a 429 the moment the reconciled budget is empty', async () => {
    const clock = fakeClock();
    const budget = budgetAt(300);
    const { fetch, calls } = scriptedFetch([
      json({}, { status: 429, headers: { 'RateLimit-Org-Day-Remaining': '0' } }),
      json({ data: { id: 'a' } }),
    ]);
    const client = testClient(clock, { budget, maxRetries: 3, fetch });

    await expect(client.getOne('/things/1')).rejects.toMatchObject({ kind: 'quota' });
    expect(calls).toHaveLength(1);
    expect(budget.exhausted).toBe(true);
  });

  it('is unmetered when no budget is given', async () => {
    const clock = fakeClock();
    const client = testClient(clock, {
      fetch: scriptedFetch([json({ data: { id: 'a' } }), json({ data: { id: 'b' } })]).fetch,
    });
    await expect(client.getOne('/a')).resolves.toBeDefined();
    await expect(client.getOne('/b')).resolves.toBeDefined();
  });
});
