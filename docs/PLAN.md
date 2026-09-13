# Donkey Kaun — Project Plan

## 1. Rules reference (source of truth for the game engine)

This is my restatement of the rules as given, written down so we have one place to check
against when something in the engine looks wrong. **Flag anything below that's off.**

**Setup**
- 5 or 6 players, seated in a fixed circle (e.g. a→b→c→d→e→f→a).
- A game is 8 rounds. Round 1 deals 8 cards/player; each round deals one fewer than the
  last, down to 1 card/player in round 8.
- The dealer rotates one seat clockwise every round (round 1: the host deals; round 2:
  the next seat deals; and so on, wrapping around with 5 players).
- The dealer deals starting with the player to their left and finishes on themself.
- Trump suit rotates ♠ → ♥ → ♣ → ♦ → ♠ ... one step per round (so it cycles twice over
  8 rounds).

**Bidding (after cards are dealt, before play)**
- Bidding order starts with the player after the dealer (the same player who leads the
  first hand) and goes around the circle, **ending with the dealer**.
- Each bid is a number of hands a player claims they'll win exactly, in the range
  `0` to `(cards dealt this round) + 1` — the `+1` exists as a "grace" value so a player
  who's mathematically locked into losing can bid the max and openly try to spoil other
  players' hands instead.
- **Dealer restriction:** the dealer's bid may not be the one value that would make the
  sum of all bids equal exactly the number of cards dealt this round. (Standard
  "screw-the-dealer" rule — guarantees at least one player fails their bid.)

**Play**
- The player after the dealer leads the first hand and may lead any suit, including
  trump. Whoever wins a hand leads the next one (also free to choose any suit).
- Players must follow the led suit if able. If unable, they may play trump (which
  contests to win the hand) or discard any other suit (which can never win the hand
  regardless of rank).
- Highest card of the led suit wins the hand, unless trump was played, in which case
  the highest trump played wins.
- Card ranking: A high, then K, Q, J, 10 ... down to 2.

**Scoring (per round)**
- If a player wins **exactly** the number of hands they bid: score = `(bid + 1) * 10 + bid`
  (e.g. bid 0 → 10, bid 1 → 21, bid 2 → 32, bid 3 → 43 ...).
- If a player's actual hands won ≠ their bid (over or under): score = `bid` itself
  (e.g. bid 0 → 0, bid 1 → 1, bid 7 → 7).
- Round scores accumulate across all 8 rounds. After round 8, whoever has the **lowest**
  total is the Donkey.

**End of game — three options**
1. **New game** — scores reset to 0, dealer/cards/trump restart from the top.
2. **Continue** — cumulative scores carry over into a fresh 8-round game; dealing
   resumes at 8 cards/player with the next dealer in rotation (i.e. cards don't keep
   counting down past 1 — they reset to 8 when a new 8-round game starts, whether it's
   a "new game" or a "continue").
3. **Exit** — end the session.

## 2. Feature list

- Landing page → create room or join room (code, shareable link, and QR code).
- Avatar picker: 50+ curated avatars (people + animals), recolorable/customizable, plus
  a display name. Choice remembered per-device (no login) so returning players skip
  setup.
- Lobby: circular seating preview, host-only start button available with 2–6 players
  (the traditional family game remains designed for 5 or 6).
- Server-authoritative game engine implementing the rules above (client never sees
  other players' hands).
- Bidding UI showing each player's bid live as they lock it in, with the dealer's
  restricted value disabled and explained.
- Trick-play UI: cards raised/highlighted when legal to play; illegal cards visibly
  greyed out and pushed down (Hearts-style), never hidden.
- Circular table layout, dealing animation, trick-to-winner animation, live scoreboard,
  current trump + round indicators.
- End-of-round and end-of-game score reveal, with new game / continue / exit choice.
- Voice chat: listen automatically, opt-in microphone, mute all/per player, speaking
  indicators, and a WebRTC mesh with secure TURN fallback.
- Mobile + desktop responsive layouts, tested on both.
- Reconnect handling (phone locks, wifi drops mid-game).

## 3. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind CSS, Framer Motion |
| State | Zustand |
| Backend | Node.js + Express + Socket.io + TypeScript |
| Identity | Browser-local device ID (`localStorage`), no accounts/passwords |
| Voice | WebRTC mesh, signaling over the existing Socket.io connection |
| Hosting | Render Static Site (`donkeykaunloader`) + free API Web Service (`donkeykaun`) |
| Repo | npm workspaces monorepo (`client/`, `server/`) |

## 4. Repo structure

```
client/   React + Vite + TypeScript frontend
server/   Express + Socket.io backend, serves client/dist in production
docs/     This plan + any future design notes
```

## 5. Milestones

Each milestone ends with a checklist below and a demo for live testing before merging
`work` → `main`.

### M0 — Scaffold ✅ (this commit)
- [x] Monorepo structure (`client/`, `server/`, npm workspaces)
- [x] Vite + React + TS client scaffold
- [x] Express + Socket.io + TS server scaffold, serves client build
- [x] `.gitignore` covering `node_modules`, `dist`, `.env*`
- [x] `work` branch created; git workflow documented (see section 6)
- [x] First deploy to Render — "hello world" proving the pipeline end to end (live, passcode-gated)

### M1 — Identity & Rooms ✅
- [x] Landing page
- [x] Avatar picker (74 avatars via DiceBear + curated animal emoji, fully recolorable) + name entry
- [x] Device-remembered identity (localStorage)
- [x] Create room → code + link + QR
- [x] Join room via code/link
- [x] Lobby: circular seating (live), host start-game gating (2–6 players)
- [x] Extras added mid-milestone at your request: edit name/avatar anytime (header badge,
      or click your own seat in the lobby — both sync live to everyone), manual light/dark
      theme toggle

### M2 — Game Engine (server-authoritative, no UI polish yet) ✅
- [x] Deck, dealing rotation, dealer rotation, trump rotation
- [x] Bidding flow incl. dealer restriction rule
- [x] Trick play incl. follow-suit/trump/discard rules, trick winner logic
- [x] Scoring formula, round progression 8 → 1
- [x] End-of-game: new game / continue / exit
- [x] Automated tests for the rules above (12 vitest cases in
      `server/src/game/engine.test.ts`)
- [x] Minimal functional UI wired up to actually play (bidding buttons, legal/illegal
      card highlighting, live scoreboard, game-end screen) — real animation and the
      circular table layout are still M3
- [x] Live-seat continuity: a departed player can securely reclaim the exact same seat,
      cards, bid, hands won and score. The host can keep the seat reserved, remove it and
      safely continue with fewer players, or open it for a new player to inherit. The
      same engine seam is ready for bot takeover in the next milestone.

### M3 — Game UI & Animation ✅
- [x] Circular table layout (desktop + mobile) — ego-centric, you're always at 6 o'clock
- [x] Dealing animation — round-robin, one card per player at a time, real deal order
- [x] Legal/illegal card highlighting (Hearts-style)
- [x] Trick-to-winner animation — last card and sweep both animate (needed a server-side
      fix so the "trick complete" state actually reaches clients before it resolves)
- [x] Live bids, scoreboard, trump/round indicators, plus a scoresheet popup and a
      prominent round-end recap that fades to a compact persistent line
- [x] Reconnect handling — greyed/pulsing avatar + "reconnecting…" at the table,
      verified to clear automatically once the player's socket comes back

### M4 — Voice Chat ✅
- [x] WebRTC mesh signaling over Socket.io (the server validates message shape, room
      membership, and sender identity before relaying encrypted peer negotiation)
- [x] Listen automatically; microphone remains opt-in and requires browser permission
- [x] Independent microphone mute, mute-all, per-player local mute, speaking indicators,
      connection status, and autoplay-recovery control
- [x] Cloudflare STUN by default plus optional Realtime TURN fallback. Permanent TURN
      credentials stay on the API server; browsers receive only short-lived credentials.

### M5 — Polish ✅
- [x] Full mobile responsiveness pass (390px viewport tested; fixed two overlap bugs —
      voice control button vs. lobby seat, scoresheet button vs. profile badge)
- [x] Disconnect/rejoin edge cases (see M2 note above; also: abandoned in-progress rooms
      now get garbage-collected after the grace period instead of leaking forever;
      "reconnecting…" banner added for the local player, not just other seats)
- [x] Sound effects (synthesized Web Audio tones — card play, trick win, your turn, round
      end, game end — plus a mute toggle next to the theme toggle, persisted like theme)
- [x] Larger game-table typography and collision-free round recap layout on mobile and
      desktop; recaps trigger once per actual round rather than on room broadcasts or
      seat administration.
- [x] Desktop microphone speech processing (echo cancellation, noise suppression, mono
      capture, speech-band filtering and gentle compression).

### M6 — Deploy Hardening
- [x] Secrets audit (nothing sensitive in the repo; `.env*` gitignored, `render.yaml`
      keeps real values out via `sync: false`)
- [x] Render production deployment configured as a static frontend plus API Web Service;
      both auto-deploy from `main`
- [x] Load test with 6 concurrent connections
- [x] Final security pass — fixed a real passcode-gate bypass (hardcoded fallback secret
      was derivable from source if `SESSION_SECRET` was ever left unset), an unbounded
      rate-limiter memory leak, and switched room-code generation to a CSPRNG
- [x] Durable room recovery through Upstash Redis (24-hour expiry), including safe
      free-server restarts without exposing hands or raw resume credentials
- [x] Secure same-device refresh/QR takeover with rotating resume credentials, bounded
      socket acknowledgements, authoritative reconnect state, and automatic voice-peer
      rebuilding after membership is restored

### M7 — Bots (next)
- [ ] Bot seat creation and host controls
- [ ] Legal-play engine adapter using the existing replacement-seat seam
- [ ] Bidding strategy and progressively stronger play strategies
- [ ] Solo game against bots and bot takeover for a disconnected player
- [ ] Deterministic bot tests plus difficulty/fairness tuning (bots never inspect cards
      that a human in the same seat could not see)

## 6. Git workflow (for you to run day-to-day)

```
# see what's changed
git status

# stage and commit your own manual edits
git add <files>
git commit -m "message"

# push the work branch to GitHub (first time)
git push -u origin work

# push again after that
git push

# when a milestone is approved and you want it in main:
git checkout main
git pull origin main
git merge work
git push origin main

# then go back to work for the next milestone
git checkout work
```

I'll be committing to `work` as we go; you can `git pull` on `work` any time to see the
latest, or just run it locally per the README.

## 7. Security notes

- Runtime secrets (site passcode, session secret, and optional TURN key) live only in
  Render's API-service environment. `.env` is gitignored and tracked examples stay empty.
- Paid TURN is disabled by default behind an explicit kill switch. Credentials require
  live authenticated room membership, expire after 30 minutes, and have issuance limits.
- Production fails closed when the passcode, session secret, or HTTPS client origin is
  missing or weak; the app does not silently deploy as a public service.
- No accounts/passwords in scope for v1, which removes a whole class of risk.
- Since the repo is public: before every merge to `main`, I'll re-check `git diff` for
  anything that looks like a key, token, or personal data before it goes up.
