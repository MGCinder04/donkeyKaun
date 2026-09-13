# Donkey Kaun bot evaluation

This report records the deterministic leagues used to tune the four server-owned
bot personalities. All bots remain fair: they receive their own cards plus public
table information only. They never receive an opponent hand or undealt card.

## Strategy rebuild

- Fixed the rank-normalization bug where a `2` produced `NaN` and collapsed bidding
  toward zero.
- Every revealed card is recorded immediately with player, hand number and led suit.
- Known void suits and exact remaining hand sizes are tracked for every active seat.
- Guaranteed trump sequences, suit length, singleton/void potential, circulation,
  earlier bids, total-bid pressure and cumulative scores affect decisions.
- Ustaad uses deterministic hidden-hand sampling and full-round rollouts for bids and
  card choices. The samples are possibilities consistent with public information,
  not the real hidden cards.
- Shaitaan uses bounded rollouts plus high-bid/top-score targeting.
- Hisaabi prioritizes exact contract completion and conservative card economy.
- Bhola uses the same mathematical certainties but adds limited deterministic error
  among otherwise plausible choices.

## Paired tuning result

The same 50 deal seeds and all 24 seat permutations were run before and after adding
the rollout planner: 1,200 complete games per iteration and 9,600 scored rounds per
personality. This isolates strategy changes from lucky seating or cards.

| Bot | Mean score before | Mean score after | Exact bids before | Exact bids after | Donkey before | Donkey after |
|---|---:|---:|---:|---:|---:|---:|
| Bhola | 77.16 | 75.94 | 42.67% | 41.80% | 32.00% | 37.17% |
| Hisaabi | 81.78 | 79.45 | 49.49% | 47.88% | 21.58% | 30.75% |
| Shaitaan | 83.99 | 89.01 | 45.81% | 48.40% | 23.00% | 22.25% |
| Ustaad | 81.58 | **98.90** | 49.46% | **60.22%** | 25.00% | **12.25%** |

Ustaad gained 21.2% mean score, 10.76 percentage points of exact-bid accuracy,
and cut its donkey rate by 51% relative to its pre-rollout result. The other bots'
post-change results also reflect having to play against the stronger Ustaad.

## Qualification league

After freezing the strategy at commit `a23385a`, the final holdout pass used 40
independent deal seeds that were not used by the fast smoke tests. Four-player tables
use all 24 seat permutations; five- and six-player tables use balanced rotations that
give every personality equal seat and duplicate-seat exposure. It completed 3,200
games and 80,960 scored bot rounds. The seed manifest, complete aggregate and per-seed
metrics, configuration, Node version, frozen strategy commit and seed-clustered
Student-t confidence intervals are checked in at `docs/BOT_QUALIFICATION.json`. Run
`npm run qualify:bots` to regenerate it.

### Frozen four-player holdout — 960 games

| Bot | Mean score | Exact bids | Mean bid error | First place | Donkey |
|---|---:|---:|---:|---:|---:|
| Bhola | 69.88 | 44.62% | 0.721 | 14.48% | 34.38% |
| Hisaabi | 69.50 | 49.13% | 0.652 | 12.08% | 36.04% |
| Shaitaan | 79.28 | 51.77% | 0.607 | 19.27% | 24.06% |
| Ustaad | **103.27** | **58.89%** | **0.538** | **55.73%** | **8.44%** |

Across independent seeds, Ustaad beat the strongest other personality by an average
22.51 points (95% CI 18.10–26.92), improved exact-bid rate by 5.81 percentage points
(95% CI 3.44–8.18), and reduced donkey rate by 11.67 percentage points (95% CI
8.29–15.04). Every interval remains above zero.

### Frozen five-player holdout — 800 games

| Bot | Mean score | Exact bids | Mean bid error | First place | Donkey |
|---|---:|---:|---:|---:|---:|
| Bhola | 66.54 | 49.40% | 0.642 | 10.40% | 30.40% |
| Hisaabi | 67.34 | 58.23% | 0.543 | 6.40% | 26.80% |
| Shaitaan | 76.48 | 60.45% | 0.496 | 15.60% | 19.10% |
| Ustaad | **102.49** | **66.04%** | **0.413** | **49.70%** | **5.60%** |

Ustaad's seed-clustered advantage was +24.96 points (95% CI 21.33–28.58), +4.05
percentage points exact (95% CI 2.14–5.96), and −8.80 percentage points donkey rate
(95% CI 5.58–12.02 reduction).

### Frozen six-player holdout — 1,440 games

| Bot | Mean score | Exact bids | Mean bid error | First place | Donkey |
|---|---:|---:|---:|---:|---:|
| Bhola | 65.29 | 52.75% | 0.578 | 8.38% | 28.75% |
| Hisaabi | 67.39 | 63.92% | 0.457 | 6.81% | 22.82% |
| Shaitaan | 75.39 | 66.95% | 0.419 | 12.96% | 13.84% |
| Ustaad | **95.90** | **68.43%** | **0.366** | **40.05%** | **3.98%** |

Ustaad's seed-clustered advantage was +20.19 points (95% CI 17.17–23.20) and −8.06
percentage points donkey rate (95% CI 6.01–10.10 reduction). Its exact-bid advantage
was +0.84 points with a 95% CI crossing zero; at six seats, its decisive strength is
the higher-value contracts and much lower donkey risk rather than a clearly higher
raw exact percentage than Shaitaan.

This final pass also models all remaining bids in legal order, enforces the dealer's
forbidden total inside simulations, weights hidden-hand possibilities by already
observed bids, reconstructs the original hands those bids were made from, requires a
minimum effective sample size, and prevents simulated opponents from reading one
another's cards.

## Exploratory format matrix

Before the locked holdout pass, broader exploratory leagues covered 5,760 games,
22,912 bot-seat appearances and 158,720 scored bot rounds across every supported table
size and homogeneous self-play. These were used to find defects and tune strategy, so
they demonstrate format coverage but are not the final unbiased strength estimate.

The optional two- and three-player modes were also covered with every ordered
combination of distinct personalities. Ustaad finished first in 72.14% of its duel
appearances and 47.83% of its three-player appearances, with the lowest donkey rate
in both formats. These smaller formats are strategically harsher because the dealer
restriction displaces bids more often, but all games completed safely.

### Mixed four-player tables — 1,536 games

| Bot | Mean score | Exact bids | Mean bid error | First place | Donkey |
|---|---:|---:|---:|---:|---:|
| Bhola | 76.46 | 43.07% | 0.691 | 15.17% | 34.44% |
| Hisaabi | 79.54 | 49.26% | 0.611 | 16.86% | 32.36% |
| Shaitaan | 88.03 | 48.66% | 0.600 | 27.80% | 21.94% |
| Ustaad | **99.80** | **61.41%** | **0.464** | **41.54%** | **13.93%** |

### Mixed five-player tables — 640 games

| Bot | Mean score | Exact bids | Mean bid error | First place | Donkey |
|---|---:|---:|---:|---:|---:|
| Bhola | 73.81 | 48.81% | 0.605 | 11.09% | 32.50% |
| Hisaabi | 77.87 | 58.57% | 0.500 | 10.31% | 28.44% |
| Shaitaan | 87.95 | 58.54% | 0.478 | 19.84% | 16.41% |
| Ustaad | **95.03** | **67.22%** | **0.383** | **30.55%** | **12.42%** |

### Mixed six-player tables — 768 games

| Bot | Mean score | Exact bids | Mean bid error | First place | Donkey |
|---|---:|---:|---:|---:|---:|
| Bhola | 70.35 | 52.59% | 0.557 | 8.72% | 32.55% |
| Hisaabi | 78.07 | 65.24% | 0.419 | 11.39% | 20.77% |
| Shaitaan | 84.67 | 64.73% | 0.401 | 17.06% | 13.54% |
| Ustaad | **94.71** | **72.82%** | **0.309** | **27.60%** | **7.94%** |

### Homogeneous five-player self-play — 256 games

| Table | Mean score | Exact bids | Mean bid error |
|---|---:|---:|---:|
| Five Bholas | 78.05 | 52.11% | 0.564 |
| Five Hisaabis | 79.78 | 59.45% | 0.480 |
| Five Shaitaans | 86.03 | 57.38% | 0.488 |
| Five Ustaads | **92.53** | **65.90%** | **0.390** |

### Homogeneous six-player self-play — 256 games

| Table | Mean score | Exact bids | Mean bid error |
|---|---:|---:|---:|
| Six Bholas | 73.16 | 54.49% | 0.525 |
| Six Hisaabis | 78.20 | 65.49% | 0.405 |
| Six Shaitaans | 85.80 | 65.36% | 0.402 |
| Six Ustaads | **91.98** | **70.54%** | **0.339** |

## Safety and tactical gates

- 0 illegal bids
- 0 illegal card plays
- 0 deadlocks
- 0 non-finite calculations
- Deterministic replay produces identical metrics
- Ace of trump plus any `2` never collapses to a zero bid
- A completed/zero contract does not lead an unbeatable trump while a losing lead exists
- The weakest sufficient winner is used when future contract safety permits it
- The strongest safe loser is discarded after reaching a contract
- Played-card memory updates before hand resolution
- Failing to follow a suit records a permanent public void inference for the round

The fast league and tactical scenarios run in the normal server test suite. Larger
qualification leagues run locally and never consume live Render resources.
