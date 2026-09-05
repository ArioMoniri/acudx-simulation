# AcuDx multiplayer relay

A tiny local WebSocket **message bus** that gives AcuDx rooms real cross-device
sync. It is deliberately dumb and cheap:

- **No LLM, no clinical logic, no game reducer.** All room logic stays in the
  browser (`web/src/components/room/roomStore.ts`).
- The relay only **caches the latest room snapshot per channel** and **forwards
  it to the other members** of that channel (last-write-wins).
- Only dependency: [`ws`](https://www.npmjs.com/package/ws).

## Run it

```bash
cd multiplayer
npm install
npm start
```

You should see:

```
[acudx-relay] listening on ws://0.0.0.0:8899 (message bus only — no LLM, no state machine)
```

- **Port:** `8899` by default. Override with `PORT`, e.g. `PORT=9000 npm start`.
- **Host:** binds `0.0.0.0` so other devices on your LAN can reach it. Override
  with `HOST` if you want to restrict it (e.g. `HOST=127.0.0.1`).

The web app connects automatically — no relay running just means rooms stay
single-device (the app degrades gracefully and never breaks).

## Connect a second device (same Wi‑Fi / LAN)

1. Find this machine's LAN IP (e.g. `192.168.1.42`):
   - macOS: `ipconfig getifaddr en0`
   - Linux: `hostname -I`
2. Start the web app so it is reachable on the LAN (Vite: `npm --prefix web run dev -- --host`).
3. On the **second device**, open the app, then point its client at this relay.
   The client resolves the relay URL in this order:
   1. `VITE_MULTIPLAYER_URL` (build-time env)
   2. `localStorage["acudx-mp-url"]` (runtime override)
   3. `ws://<current-hostname>:8899` (default)

   The simplest runtime override — run this in the second device's browser
   console, then reload:

   ```js
   localStorage.setItem("acudx-mp-url", "ws://192.168.1.42:8899");
   ```

   (When both devices browse to the app via the host's LAN IP, the default
   `ws://<current-hostname>:8899` already resolves to the relay, so no override
   is needed.)

## How a room syncs

1. Device A creates a room → it connects to the relay on a **channel = the
   room's join code** and pushes the room snapshot (including a freshly
   generated, unique patient case).
2. Device A shares the **join code** shown in the room.
3. Device B enters the code in **Join by code** → it subscribes to the same
   channel, receives the cached snapshot instantly, and materializes the room.
4. From then on, any mutation on either device (take a seat, grant the floor,
   post a turn, close a loop…) rebroadcasts the resulting snapshot, and the
   other device replaces its local room state with it.

## Protocol (JSON)

`room` is the channel key (the room's join code).

| Direction        | Message                          | Meaning                              |
| ---------------- | -------------------------------- | ------------------------------------ |
| client → server  | `{ t:"join", room }`             | subscribe + get cached snapshot back |
| client → server  | `{ t:"snapshot", room, data }`   | cache + fan-out to the other members |
| client → server  | `{ t:"leave", room }`            | unsubscribe                          |
| server → client  | `{ t:"snapshot", room, data }`   | a cached / forwarded snapshot        |
| server → client  | `{ t:"presence", room, count }`  | number of members in the channel     |

Rooms with no members are dropped (members + cache), so an idle relay holds
essentially nothing.

> Education only. No real patient data path.
