import { describe, expect, it } from 'vitest';
import { lentLoans, loansIn, readGondiTx, type Receipt } from '../src/data/gondi.js';
import lend from './fixtures-chain/gondi-0x02f69f2e.json';
import repay from './fixtures-chain/gondi-0x6889c785.json';

const ME = '0x8ebfe0a1b5989c87f3c34bec8c160cf9e80b2a78';
const POOLS = new Set(['0xf41b389e0c1950dc0b16c9498eae77131cc08a56']);

describe('Gondi loans from the chain', () => {
  it('reads a loan from its event: the collateral, the borrower, the principal, the lenders', () => {
    const tx = readGondiTx(lend as Receipt, POOLS);
    expect(tx.loans).toHaveLength(1);
    expect(tx.loans[0]).toMatchObject({
      collection: '0xd3f9551e9bc926cc180ac8d3e27364f4081df624',
      tokenId: '30',
      borrower: '0x50cd286b00bda2243eff0148d46ea817e54c5411',
      principal: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      amount: '5100000000000000000',
    });
    expect(tx.loans[0]!.lenders).toContain(ME);
    expect(tx.released).toEqual([]);
  });

  it('a repayment releases the collateral from the escrow to the borrower', () => {
    const tx = readGondiTx(repay as Receipt, POOLS);
    expect(tx.loans).toEqual([]);
    expect(tx.released).toEqual([{ collection: '0x4440732b0d85e2a77dcb2caedfd940154241249a', tokenId: '548', from: POOLS.values().next().value, to: expect.stringMatching(/^0x3fed9e5b/) }]);
  });

  it('a loan runs from the guild lending until the NFT leaves the escrow or someone else refinances it', () => {
    const c = '0x00000000000000000000000000000000000c0113';
    const loan = (lenders: string[]) => ({ collection: c, tokenId: '7', borrower: '0xb0', principal: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', amount: '1', lenders });
    const loans = lentLoans(ME, [
      { hash: '0x1', loans: [loan([ME])], released: [] },
      { hash: '0x2', loans: [loan(['0xother'])], released: [] }, // refinanced away
      { hash: '0x3', loans: [loan([ME])], released: [] }, // lent again
      { hash: '0x4', loans: [], released: [{ collection: c, tokenId: '7', from: '0xpool', to: ME }] }, // foreclosed: ours now
      { hash: '0x5', loans: [loan([ME])], released: [] }, // and once more, still running
    ]);
    expect(loans.map((l) => [l.startedBy, l.end?.how ?? 'running'])).toEqual([
      ['0x1', 'refinanced'],
      ['0x3', 'foreclosed'],
      ['0x5', 'running'],
    ]);
  });

  it('finds no loan in data that has no loan head', () => {
    expect(loansIn('0x' + '0'.repeat(64 * 6))).toEqual([]);
  });
});

describe('an NFT’s look from the chain', async () => {
  const { abiString, fetchable } = await import('../src/data/nftLook.js');
  it('decodes an ABI string', () => {
    const hex = '0x' + (32).toString(16).padStart(64, '0') + (5).toString(16).padStart(64, '0') + Buffer.from('Punks').toString('hex').padEnd(64, '0');
    expect(abiString(hex)).toBe('Punks');
    expect(abiString('0x')).toBeNull();
  });
  it('fetches IPFS and Arweave through gateways, keeps https and data:, drops the rest', () => {
    expect(fetchable('ipfs://Qm123/1.json')).toBe('https://ipfs.filebase.io/ipfs/Qm123/1.json');
    expect(fetchable('ipfs://ipfs/Qm123')).toBe('https://ipfs.filebase.io/ipfs/Qm123');
    expect(fetchable('ar://abc')).toBe('https://arweave.net/abc');
    expect(fetchable('data:image/svg+xml;base64,AA==')).toBe('data:image/svg+xml;base64,AA==');
    expect(fetchable('http://insecure')).toBeNull();
    expect(fetchable('QmQz2Z3Ah37SrykJXbupghFu2xTYVTUmwdPMGvfGdAJBZ7')).toBe('https://ipfs.filebase.io/ipfs/QmQz2Z3Ah37SrykJXbupghFu2xTYVTUmwdPMGvfGdAJBZ7');
    expect(fetchable('https://ipfs.io/ipfs/QmX/1.png')).toBe('https://ipfs.filebase.io/ipfs/QmX/1.png');
  });
});

describe('a punk’s picture', async () => {
  const { punkPicture } = await import('../src/data/nftLook.js');
  it('draws the on-chain SVG big and crisp on the punks’ blue', () => {
    const out = punkPicture('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="1" height="1" fill="#000"/></svg>')!;
    const svg = atob(out.slice(out.indexOf(',') + 1));
    expect(svg).toContain('width="240"');
    expect(svg).toContain('crispEdges');
    expect(svg).toContain('fill="#638596"');
    expect(punkPicture(null)).toBeNull();
  });
});

describe('an NFT drawn in text (Autoglyphs)', async () => {
  const { textPicture } = await import('../src/data/nftLook.js');
  it('draws its marks in ink on paper, the dots left blank', () => {
    const out = textPicture('data:text/plain;charset=utf-8,' + ['X./.', './X.', '.\\..', '|..O'].join('%0A'))!;
    const svg = atob(out.slice(out.indexOf(',') + 1));
    expect((svg.match(/<text /g) ?? []).length).toBe(7);
    expect(svg).toContain('>O</text>');
    expect(textPicture('data:application/json,{}')).toBeNull();
  });
});
