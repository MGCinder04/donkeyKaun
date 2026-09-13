# Donkey Kaun

A real-time online version of the family card game **Donkey Kaun**, playable on desktop and mobile from anywhere.

See [`docs/PLAN.md`](docs/PLAN.md) for the full feature list, milestones, and game rules reference.

## Project layout

```
client/   React + Vite + TypeScript frontend
server/   Express + Socket.io backend (API + realtime only)
```

## Local development

```
npm install
npm run dev:server   # terminal 1 — game server on http://localhost:3001
npm run dev:client   # terminal 2 — Vite dev server on http://localhost:5173
```

## Production hosting

Client and server deploy as two separate Render services (see `render.yaml`) — the
client as a free Static Site (never spins down, loads instantly) and the server as a
free Web Service (still spins down after inactivity; the client shows its own loading
screen while it wakes back up, instead of Render's default cold-start page). See
`.env.example` and `client/.env.example` for the env vars each side needs
(`CLIENT_ORIGIN`/`SITE_PASSCODE`/`SESSION_SECRET` on the server, `VITE_API_URL` on the
client).

```
npm run build:server && npm run start --workspace server   # run the API locally as it runs in prod
npm run build:client                                        # produces client/dist to serve statically
```

## Reliable voice chat (optional TURN setup)

Direct WebRTC audio uses Cloudflare's free STUN endpoint without any configuration.
For reliable calls across mobile carriers, VPNs, and restrictive routers, create a
Cloudflare Realtime TURN key and add these **only** to the Render API Web Service:

```text
CLOUDFLARE_TURN_KEY_ID=<the TURN key ID/UID>
CLOUDFLARE_TURN_KEY_API_TOKEN=<the permanent TURN key secret>
TURN_ENABLED=false
TURN_HOURLY_IP_LIMIT=30
TURN_DAILY_CREDENTIAL_LIMIT=120
```

In Cloudflare: open **Realtime** → **TURN**, create a TURN key (for example,
`donkey-kaun-production`), then copy its ID and secret. In Render: open the
`donkey-kaun-api` Web Service → **Environment**, add the two values above, save, and
redeploy. Do not put either real value in `.env.example`, `render.yaml`, client-side
environment variables, or GitHub. Keep `TURN_ENABLED=false` until the production gate
has been checked; changing it to `true` is the explicit paid-service switch.

TURN credentials are available only through an authenticated Socket.IO connection that
is currently bound to a player in a room with another connected player. Each room member
gets a separate credential that expires after 30 minutes and refreshes while the room is
open. A live credential is also revoked when its player leaves, is kicked, changes
lobbies, or the game exits. Fresh credentials are capped per IP and globally per server
process. The client falls back to free STUN-only audio whenever TURN is disabled,
limited, or unavailable.

Cloudflare's budget alerts are informational and do not stop spending. If a guaranteed
zero bill is required, leave `TURN_ENABLED=false`; application safeguards cannot replace
a provider-enforced hard billing cap.

## Production security requirements

Production deliberately fails to start unless `SITE_PASSCODE` is at least 12 characters,
`SESSION_SECRET` is at least 32 characters, and `CLIENT_ORIGIN` is an HTTPS URL. Unlock
tokens are individually randomized, signed, and expire after 180 days. Five failed
passcode attempts block that IP for 30 minutes, with an additional global distributed-
attack limit. All room/game actions are bound to the player's actual socket, packet sizes
and rates are capped, active in-memory rooms are limited, and the static site sends
anti-framing, referrer, permissions, and MIME-sniffing security headers.

Render's free static URL is publicly routable, so an unknown visitor can still download
the lock-screen shell. They cannot open a room, connect a game socket, request TURN
credentials, or see game state without a valid signed unlock token. `noindex` discourages
search engines but is not access control; the server-side passcode gate is the boundary.
