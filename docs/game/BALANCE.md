# Siege of the Ledger: balance report

14000 NPC-vs-NPC matches (normal difficulty, $20,000 a side, sides swapped every other match), 1000 per pairing, 1190 s. Made by `npm run siege:balance`.

| Target | Value | Spec | |
|---|---|---|---|
| median match length | 5 rounds | 5–7 rounds | ✅ |
| matches reaching sudden death | 5.4% | under 5% | ❌ |
| best archetype against another | 100.0% | at most 60% | ❌ |
| 100% stables wins | 0.0% | never | ✅ |
| 100% memecoins wins | 50.2% | 35–50% | ❌ |
| a liquidation, among matches with borrowing | 31.4% | 30–50% | ✅ |

| Pairing | Matches | First wins | Median rounds | Sudden death |
|---|---|---|---|---|
| degen vs whale | 1000 | 16.4% | 4 | 0.4% |
| degen vs stable-maxi | 1000 | 74.9% | 6 | 17.4% |
| degen vs yield-farmer | 1000 | 12.6% | 5 | 0.3% |
| stable-maxi vs whale | 1000 | 0.5% | 5 | 4.3% |
| whale vs yield-farmer | 1000 | 28.6% | 5 | 2.2% |
| stable-maxi vs yield-farmer | 1000 | 0.0% | 6 | 7.9% |
| all-stables vs degen | 1000 | 0.0% | 6 | 9.4% |
| all-memes vs degen | 1000 | 76.2% | 6 | 17.2% |
| all-stables vs whale | 1000 | 0.0% | 6 | 11.6% |
| all-memes vs whale | 1000 | 22.0% | 3 | 0.0% |
| all-stables vs stable-maxi | 1000 | 0.0% | 8 | 75.4% |
| all-memes vs stable-maxi | 1000 | 75.9% | 5 | 12.9% |
| all-stables vs yield-farmer | 1000 | 0.0% | 7 | 35.2% |
| all-memes vs yield-farmer | 1000 | 26.9% | 5 | 0.0% |

Matches with borrowing: 13297.
