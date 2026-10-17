# Siege of the Ledger: balance report

14000 NPC-vs-NPC matches (normal difficulty, $20,000 a side, sides swapped every other match), 1000 per pairing, 1301 s. Made by `npm run siege:balance`.

| Target | Value | Spec | |
|---|---|---|---|
| median match length | 5 rounds | 5–7 rounds | ✅ |
| matches reaching sudden death | 2.9% | under 5% | ✅ |
| best archetype against another | 90.3% | at most 60% | ❌ |
| 100% stables wins | 0.0% | never | ✅ |
| 100% memecoins wins | 47.4% | 35–50% | ✅ |
| a liquidation, among matches with borrowing | 34.8% | 30–50% | ✅ |

| Pairing | Matches | First wins | Median rounds | Sudden death |
|---|---|---|---|---|
| degen vs whale | 1000 | 25.8% | 4 | 0.7% |
| degen vs stable-maxi | 1000 | 29.9% | 5 | 0.5% |
| degen vs yield-farmer | 1000 | 18.4% | 5 | 1.0% |
| stable-maxi vs whale | 1000 | 9.7% | 4 | 1.3% |
| whale vs yield-farmer | 1000 | 29.6% | 6 | 9.9% |
| stable-maxi vs yield-farmer | 1000 | 10.9% | 6 | 4.3% |
| all-stables vs degen | 1000 | 0.0% | 8 | 55.7% |
| all-memes vs degen | 1000 | 77.4% | 6 | 12.6% |
| all-stables vs whale | 1000 | 0.0% | 7 | 38.8% |
| all-memes vs whale | 1000 | 34.1% | 4 | 0.3% |
| all-stables vs stable-maxi | 1000 | 0.0% | 7 | 44.8% |
| all-memes vs stable-maxi | 1000 | 42.2% | 4 | 0.3% |
| all-stables vs yield-farmer | 1000 | 0.0% | 8 | 92.5% |
| all-memes vs yield-farmer | 1000 | 35.9% | 5 | 0.2% |

Matches with borrowing: 11962.
