# Bot search qualification

Date: 2026-09-14

Branch: `codex/bot-diagnostics` (local only)

Frozen control: pre-search policy from commit `1a4f170`

## What changed

- The original bid/card policy remains callable as a frozen control.
- Bid rollouts now use a separate, stronger actor-only model that accounts for
  top-trump runs, suit concentration, round scarcity, prior bids, dealer rules,
  contract pressure, controlled trump leads, safe discards, and void creation.
- Card search samples only hands compatible with public evidence. It never receives
  real opponent hands or undealt cards.
- Hisaabi and Shaitaan use the stronger bid evidence. Ustaad changes its proven bid
  only when the new evidence clears conservative utility and exact-contract margins.
- Bounded hidden-hand search is used in two-card endings. Ustaad accepts a sampled
  override only when it has a clear advantage; complete enumerations are accepted.
- Bhola retains an easy personality but makes fewer arbitrary second-choice errors.

## Paired holdouts

Every pair used the same deterministic deal sequence, seat, bot personality, and
unchanged opponents. Only the evaluated seat switched from the frozen control to
the candidate policy.

| Holdout | Pairs | Mean score | Exact bids | First place | Donkey rate | Failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Balanced four-player | 240 | +8.77 | +5.21 pp | +10.83 pp | -3.75 pp | 0 |
| Mixed 2-6 players | 200 | +7.47 | +4.25 pp | +4.00 pp | -8.00 pp | 0 |
| Six-player focus | 120 | +8.84 | +3.13 pp | +6.67 pp | -4.17 pp | 0 |

`pp` means percentage points. Higher score/exact/first is better; lower donkey rate
is better. The candidate completed all 560 paired games without an illegal move,
deadlock, or non-finite state.

## Live-decision latency

Measured synchronously on this development machine while running full games:

| Table | Decision | p50 | p95 | p99 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: |
| Four players | Bid | varies by personality; expert median 10.60 ms | 48.44 ms | - | 50.79 ms |
| Four players | Card | varies by personality; expert median 0.45 ms | 5.50 ms | - | 8.92 ms |
| Six players | Bid | 8.66 ms | 66.14 ms | 93.21 ms | 109.52 ms |
| Six players | Card | 0.02 ms | 6.70 ms | 18.17 ms | 35.00 ms |

The six-player maximum remained below the 150 ms hard review threshold. These are
machine measurements, not a promise for every hosting CPU; the strategy also has
deterministic node/deal/iteration caps so work cannot grow without a bound.

## Safety and regression checks

- Cards returned by search are independently intersected with both the supplied
  legal set and a freshly derived follow-suit legal set.
- A hidden-hand invariance test swaps two real opponent hands and verifies that the
  bot's public view and decision do not change.
- Tactical tests cover absolute top-trump bid floors, forced dealer alternatives,
  cheapest sufficient winners, strong safe discards, controlled trump draining,
  and prior-bid conservatism.
- The deterministic comparison harness verifies identical round-by-round deal
  fingerprints between both arms and reports illegal, deadlock, and non-finite
  failures separately.

This report is evidence for local review only. It does not merge or deploy the bots.
