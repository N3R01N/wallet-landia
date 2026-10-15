# Gondi loans: the collateral comes home (2026-10-15)

From the user: for Gondi loans, find what NFT the loan is for, bring it back to the castle in a frame that says it's collateral, and send it back to Gondi when the loan is repaid (or lost).

## What the data has

- Zerion shows only the lender's side: WETH out to Gondi's pool (lending), WETH back (repaid or refinanced). There is no NFT in it.
- The receipt has the rest:
  - **A loan event** from the pool (emitted or refinanced) carries the loan: borrower, collateral token id and collection, principal token and amount, then the lenders' addresses. `data/gondi.ts` `loansIn` finds it by shape (an address, an id, an address, a known principal token), so a new Gondi version with the same loan layout still reads.
  - **Repaid:** the NFT leaves the pool's escrow to the borrower (an ERC-721 Transfer from the pool).
  - **Foreclosed:** the NFT goes to the lender.
  - **Refinanced away:** a loan event for the same NFT no longer lists the wallet as a lender.
- `lentLoans` turns a wallet's Gondi transactions into loans: started by, and ended by (or still running).
- Receipts are read in batches of 8 from the player's RPC node and kept in localStorage (they never change).

## The picture

- `data/nftLook.ts`: the collection's `name()` and the token's `tokenURI` → metadata → image.
  - Metadata is read from IPFS (Filebase's gateway: it lets the page read it; ipfs.io no longer serves plain requests; bare content ids and other gateways' links are sent there too) and Arweave only. A collection's own server is outside the page's connect-src.
  - **Autoglyphs** (the art is text in the token URI) are drawn as ink marks on paper.
  - Pictures on frames go through the image proxy (up to 8 MB) and are drawn down to 512 px; the gallery shows them as plain images.
  - **Wrapped CryptoPunks:** the picture comes from the punks' on-chain SVG (CryptoPunksData `punkImageSvg`), drawn at 240 px with crisp edges on the punks' blue.
  - With no picture, the frame shows the stylised painting.

## In the game

- **Lending errand:** the courier gets the collateral at Gondi (a frame with a padlock, labelled "🔒 Collateral: …"), carries it home and hands it into the wallet's hall, like any NFT bought or minted.
- **Ending errand:** the courier carries the frame from the hall to Gondi, held up before it. An incoming repayment plays as a trip out: no toll (the borrower paid it). It hands the frame over and brings the repayment home.
- **Running loans:** the collateral is kept in the lending wallet's hall. Its sheet's gallery shows it with a padlock, before the wallet's own NFTs (the old town's gallery).
- **Tapping a collateral tile** opens its sheet: the collection and token, the amount lent, the borrower, the wallet, since when, what happens next, a link to it on OpenSea, and all the collateral held.

## Limits

- Only loans that start within the loaded history are known. A loan begun earlier and still running has no frame.
- Metadata on a collection's own server (not IPFS or Arweave) isn't read, so its frame shows the painting.
