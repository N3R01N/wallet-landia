/** Boot: the app shows fixtures or demo at once, then goes live if a key and wallets are set. */

import { App } from './ui/app.js';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app is missing from index.html');

const app = new App();
root.replaceChildren(app.element);
app.start();
