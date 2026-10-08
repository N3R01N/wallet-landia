/** Boot: load fixtures (captured, or the synthetic demo) and start the town. */

import { loadFixtures } from './data/fixtures.js';
import { App } from './ui/app.js';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app is missing from index.html');

const set = await loadFixtures();
const app = new App(set.wallets, set.kind);
root.replaceChildren(app.element);
app.start();
