/**
 * Vercel Routing Middleware: zenigard.cc's front page is the landing page
 * (landing.html); everywhere else, app.zenigard.cc included, `/` is the app
 * (index.html). A vercel.json rewrite cannot do this: a file that exists
 * (index.html for `/`) is served before rewrites are looked at. Runs on `/`
 * only (docs/LANDING.md).
 */

export const config = { matcher: '/' };

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  if (url.hostname === 'zenigard.cc') {
    return new Response(null, { headers: { 'x-middleware-rewrite': new URL('/landing.html', url).toString() } });
  }
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}
