# Donkey Kaun

A real-time online version of the family card game **Donkey Kaun**, playable on desktop and mobile from anywhere.

See [`docs/PLAN.md`](docs/PLAN.md) for the full feature list, milestones, and game rules reference.

## Project layout

```
client/   React + Vite + TypeScript frontend
server/   Express + Socket.io backend (also serves the built client in production)
```

## Local development

```
npm install
npm run dev:server   # terminal 1 — game server on http://localhost:3001
npm run dev:client   # terminal 2 — Vite dev server on http://localhost:5173
```

## Production build

```
npm run build   # builds client, then server
npm start        # runs the built server, which also serves the built client
```
