import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_RPC_HOSTS, PROVINCE_RPC } from '../src/data/rpc.js';

/** A page's CSP directive, as its list of sources. */
function directive(page: string, name: string): string[] {
  const html = readFileSync(resolve(__dirname, '..', page), 'utf8');
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
  const d = csp.split(';').map((s) => s.trim().split(/\s+/)).find((parts) => parts[0] === name);
  return d?.slice(1) ?? [];
}

/** Would a connect-src list let the page reach https://host? (`*.x.com` covers subdomains only.) */
function allows(sources: string[], host: string): boolean {
  return sources.some((s) => {
    const m = /^https:\/\/(.+)$/.exec(s);
    if (!m) return false;
    const h = m[1]!;
    return h === host || (h.startsWith('*.') && host.endsWith(h.slice(1)));
  });
}

describe("the page's security policy", () => {
  const connect = directive('index.html', 'connect-src');

  it('lets the page reach every node the player may pick, and every province node', () => {
    expect(connect.length).toBeGreaterThan(0);
    for (const h of ALLOWED_RPC_HOSTS) expect(allows(connect, h), h).toBe(true);
    for (const url of Object.values(PROVINCE_RPC)) expect(allows(connect, new URL(url).hostname), url).toBe(true);
  });

  it("runs workers (the player's level) from this origin only", () => {
    expect(directive('index.html', 'worker-src')).toEqual(["'self'"]);
  });

  it('allows no WebSockets in a build (the dev server adds them for hot reload)', () => {
    for (const page of ['index.html', 'assets.html']) expect(directive(page, 'connect-src').some((s) => s.startsWith('ws'))).toBe(false);
  });
});
