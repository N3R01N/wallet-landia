/**
 * A tiny DOM helper. Text always goes in through textContent: token names, NFT
 * names and dApp names are attacker-controlled strings, and this page will one
 * day hold an API key.
 */

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Only https links from the API become clickable. */
export function safeHref(url: string | null): string | null {
  if (url === null) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
