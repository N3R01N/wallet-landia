# Siege of the Ledger: balance report

14000 NPC-vs-NPC matches (normal difficulty, $20,000 a side, sides swapped every other match), 1000 per pairing, 1079 s. Made by `npm run siege:balance`.

| Target | Value | Spec | |
|---|---|---|---|
| median match length | 5 rounds | 5–7 rounds | ✅ |
| matches reaching sudden death | 7.7% | under 5% | ❌ |
| best archetype against another | 100.0% | at most 60% | ❌ |
| 100% stables wins | 0.0% | never | ✅ |
| 100% memecoins wins | 43.7% | 35–50% | ✅ |
| a liquidation, among matches with borrowing | 31.1% | 30–50% | ✅ |

| Pairing | Matches | First wins | Median rounds | Sudden death |
|---|---|---|---|---|
| degen vs whale | 1000 | 12.8% | 3 | 0.1% |
| degen vs stable-maxi | 1000 | 53.8% | 6 | 22.2% |
| degen vs yield-farmer | 1000 | 9.7% | 4 | 0.1% |
| stable-maxi vs whale | 1000 | 1.1% | 5 | 5.2% |
| whale vs yield-farmer | 1000 | 32.4% | 5 | 2.1% |
| stable-maxi vs yield-farmer | 1000 | 0.1% | 6 | 16.7% |
| all-stables vs degen | 1000 | 0.0% | 8 | 53.3% |
| all-memes vs degen | 1000 | 74.3% | 5 | 7.6% |
| all-stables vs whale | 1000 | 0.0% | 6 | 18.8% |
| all-memes vs whale | 1000 | 18.8% | 3 | 0.0% |
| all-stables vs stable-maxi | 1000 | 0.0% | 8 | 92.2% |
| all-memes vs stable-maxi | 1000 | 60.6% | 6 | 15.3% |
| all-stables vs yield-farmer | 1000 | 0.0% | 8 | 61.8% |
| all-memes vs yield-farmer | 1000 | 21.2% | 4 | 0.0% |

Matches with borrowing: 13266.
