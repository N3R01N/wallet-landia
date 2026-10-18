# Siege of the Ledger: balance report

14000 NPC-vs-NPC matches (normal difficulty, $20,000 a side, sides swapped every other match), 1000 per pairing, 1135 s. Made by `npm run siege:balance`.

| Target | Value | Spec | |
|---|---|---|---|
| median match length | 5 rounds | 5–7 rounds | ✅ |
| matches reaching sudden death | 2.9% | under 5% | ✅ |
| best archetype against another | 69.4% | at most 60% | ❌ |
| 100% stables wins | 0.0% | never | ✅ |
| 100% memecoins wins | 51.8% | 35–50% | ❌ |
| a liquidation, among matches with borrowing | 30.4% | 30–50% | ✅ |

| Pairing | Matches | First wins | Median rounds | Sudden death |
|---|---|---|---|---|
| degen vs whale | 1000 | 46.6% | 5 | 1.2% |
| degen vs stable-maxi | 1000 | 46.9% | 5 | 0.6% |
| degen vs yield-farmer | 1000 | 32.6% | 5 | 0.8% |
| stable-maxi vs whale | 1000 | 36.5% | 5 | 4.0% |
| whale vs yield-farmer | 1000 | 41.9% | 5 | 5.0% |
| stable-maxi vs yield-farmer | 1000 | 30.6% | 6 | 5.9% |
| all-stables vs degen | 1000 | 0.0% | 6 | 30.8% |
| all-memes vs degen | 1000 | 76.4% | 6 | 24.3% |
| all-stables vs whale | 1000 | 0.0% | 8 | 63.2% |
| all-memes vs whale | 1000 | 37.8% | 4 | 0.6% |
| all-stables vs stable-maxi | 1000 | 0.0% | 7 | 46.3% |
| all-memes vs stable-maxi | 1000 | 51.2% | 5 | 0.5% |
| all-stables vs yield-farmer | 1000 | 0.0% | 8 | 78.7% |
| all-memes vs yield-farmer | 1000 | 41.8% | 4 | 0.4% |

Matches with borrowing: 12670.
