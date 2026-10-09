/** Boot: the app shows fixtures or demo at once, then goes live if a key and wallets are set. */

import { inject } from '@vercel/analytics';
import { App } from './ui/app.js';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app is missing from index.html');

const app = new App();
root.replaceChildren(app.element);
app.start();

// Keep the town's files on the device (public/sw.js): a returning player
// downloads nothing that has not changed. Production only: in development
// the dev server's files change constantly.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e: unknown) => console.warn('service worker', e));
  });
}

// Vercel Web Analytics: cookie-less page views, on the deployed site only (the
// script and its reports are same-origin there, /_vercel/insights/, so the
// page's security policy needs no change). Query strings are dropped: only the
// page path is counted.
if (import.meta.env.PROD) {
  inject({
    mode: 'production',
    beforeSend: (event) => ({ ...event, url: event.url.split('?')[0] ?? event.url }),
  });
}
