# Siege of the Ledger: balance report

14000 NPC-vs-NPC matches (normal difficulty, $20,000 a side, sides swapped every other match), 1000 per pairing, 1616 s. Made by `npm run siege:balance`.

| Target | Value | Spec | |
|---|---|---|---|
| median match length | 5 rounds | 5–7 rounds | ✅ |
| matches reaching sudden death | 1.8% | under 5% | ✅ |
| best archetype against another | 70.5% | at most 60% | ❌ |
| 100% stables wins | 0.0% | never | ✅ |
| 100% memecoins wins | 55.4% | 35–50% | ❌ |
| a liquidation, among matches with borrowing | 33.3% | 30–50% | ✅ |

| Pairing | Matches | First wins | Median rounds | Sudden death |
|---|---|---|---|---|
| degen vs whale | 1000 | 33.0% | 4 | 1.4% |
| degen vs stable-maxi | 1000 | 39.3% | 5 | 0.3% |
| degen vs yield-farmer | 1000 | 29.5% | 5 | 0.7% |
| stable-maxi vs whale | 1000 | 33.6% | 4 | 2.4% |
| whale vs yield-farmer | 1000 | 55.4% | 5 | 3.2% |
| stable-maxi vs yield-farmer | 1000 | 33.4% | 5 | 2.9% |
| all-stables vs degen | 1000 | 0.0% | 7 | 37.9% |
| all-memes vs degen | 1000 | 77.6% | 5 | 15.0% |
| all-stables vs whale | 1000 | 0.0% | 7 | 36.6% |
| all-memes vs whale | 1000 | 37.5% | 4 | 0.3% |
| all-stables vs stable-maxi | 1000 | 0.0% | 7 | 36.0% |
| all-memes vs stable-maxi | 1000 | 55.8% | 4 | 0.3% |
| all-stables vs yield-farmer | 1000 | 0.0% | 8 | 78.8% |
| all-memes vs yield-farmer | 1000 | 50.8% | 5 | 0.3% |

Matches with borrowing: 12658.
