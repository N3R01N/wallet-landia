/** The app's address from the landing page: its own subdomain on the real site, else this site's front page (dev, previews). */
export function appBase(hostname: string): string {
  return hostname === 'zenigard.cc' || hostname === 'www.zenigard.cc' ? 'https://app.zenigard.cc/' : '/';
}
