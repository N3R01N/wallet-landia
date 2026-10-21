/**
 * An NFT's picture: its preview, and its full-size picture to fall back on
 * (a host may fail to make a preview of SVG art, as for XCOPY's "INTRODUCING:
 * KILL YOUR CUSTOMER", whose preview answers 400).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const XCOPY = JSON.parse(readFileSync('public/famous/0x39cc9c86e67baf2129b80fe3414c397492ea8026.json', 'utf8')) as RawWallet;
const HASH = '0x72e6b0a637332304406683d1887971587f2034e9b1d8ecd01cc99bd1c131199e';

describe('an NFT sent', () => {
  it('goes with its preview and its full-size picture', () => {
    const guild = buildGuild([XCOPY], { kind: 'count', count: 1000 });
    const journey = guild.journeys.find((j) => j.hash.endsWith(HASH));
    expect(journey).toBeDefined();
    const nft = journey!.steps.flatMap((s) => s.give).find((g) => g.isNft);
    expect(nft?.name).toBe('INTRODUCING: KILL YOUR CUSTOMER');
    expect(nft?.image).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(nft?.imageFull).toMatch(/^https:\/\/nft2-cdn\.alchemy\.com\//);
  });
});
