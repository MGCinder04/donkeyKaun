# Ustaad confidence-ceiling qualification

Ustaad's extreme bid tail is constrained to the hand's guaranteed top-trump
wins or `ceil(standalone expected hands + 1.25)`, whichever is higher. This is
a regularizer around the existing hidden-information search, not a replacement
model.

The fixed candidate was evaluated on 180 unrelated paired games spanning four-,
five-, and six-player tables. Each baseline/candidate pair received identical
deals, with Ustaad rotated through every seat.

| Metric | Change from previous Ustaad |
| --- | ---: |
| Exact-contract rate | +0.76 percentage points |
| Mean absolute bid error | -0.0181 (-4.6%) |
| First-place rate | +2.78 percentage points |
| Donkey rate | -0.56 percentage points |
| Mean score | -0.04 points |

All 180 pairs completed with zero illegal actions, deadlocks, or non-finite
states. The near-zero score change was accepted because exactness, bid error,
first-place rate, and donkey rate all improved on the independent holdout.
