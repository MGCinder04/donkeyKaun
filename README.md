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
