import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/zerion.js';

const ask = (): Promise<Response> => handler(new Request('https://town.example/api/zerion?path=v1/wallets/0xabc/positions/', { headers: { authorization: 'Basic abc=' } }));

afterEach(() => vi.unstubAllGlobals());

describe('the Zerion edge proxy', () => {
  it('answers 502 when Zerion cannot be reached', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network down')));
    expect((await ask()).status).toBe(502);
  });

  it('answers 504 when Zerion is too slow', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('slow', 'TimeoutError')));
    expect((await ask()).status).toBe(504);
  });

  it('passes the answer back, with only the headers the app reads', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } })));
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
