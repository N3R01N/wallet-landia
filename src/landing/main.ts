/**
 * The landing page (landing.html, served as zenigard.cc's front page). Its
 * links go to the app: app.zenigard.cc on the real site, this same site's
 * front page anywhere else (dev, previews). "Build my castle" opens the app at
 * `#start`, where the app asks for the key and a wallet itself: nothing
 * typed here, nothing carried over.
 */

import { inject } from '@vercel/analytics';
import { appBase } from './appBase.js';

const APP = appBase(location.hostname);

// an old link to a castle (zenigard.cc/#famous=…, #visit=…) belongs to the app now
if (/^#(famous|visit)=/.test(location.hash)) location.replace(APP + location.hash);

for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-app-link]')) a.href = APP + (a.dataset.appLink ?? '');

// Vercel Web Analytics on the deployed site: the page path only, never a query or a hash.
if (import.meta.env.PROD) {
  inject({ mode: 'production', beforeSend: (event) => ({ ...event, url: event.url.split(/[?#]/)[0] ?? event.url }) });
}
