/**
 * AcuDx — local multiplayer relay (a dumb, cheap message bus).
 *
 * This is NOT a game server. It runs on the host machine, holds NO clinical
 * logic, calls NO model, and pulls in only `ws`. Its single job is to let the
 * AcuDx web app's rooms sync across devices on the same LAN: it caches the
 * latest room snapshot per channel and forwards each incoming snapshot to the
 * other members of that channel (last-write-wins). All game logic stays in the
 * browser clients; here every message is opaque JSON passed straight through.
 *
 * Protocol (JSON), `room` = the room's shared join code used as a channel key:
 *   client -> server  { t:"join",     room }            subscribe + get cache back
 *   client -> server  { t:"snapshot", room, data }      cache + fan-out to peers
 *   client -> server  { t:"leave",    room }            unsubscribe
 *   server -> client  { t:"snapshot", room, data }      cached / forwarded snapshot
 *   server -> client  { t:"presence", room, count }     members in the channel
 *
 * Run:  npm install && npm start   (inside multiplayer/)
 * Bind: 0.0.0.0 so LAN devices can reach it. Port: process.env.PORT || 8899.
 *
 * Education only. No real patient data path.
 */

import { WebSocket, WebSocketServer } from "ws";

const PORT = Number.parseInt(process.env.PORT ?? "", 10) || 8899;
const HOST = process.env.HOST || "0.0.0.0";

/** channel -> Set<WebSocket> */
const members = new Map();
/** channel -> latest snapshot payload (opaque JSON) */
const cache = new Map();
/** WebSocket -> Set<channel> (so a disconnect cleans up every channel) */
const subscriptions = new WeakMap();

function log(...args) {
  // Minimal, single-line logging. No message contents (privacy + noise).
  console.log(`[acudx-relay]`, ...args);
}

function channelsOf(ws) {
  let set = subscriptions.get(ws);
  if (!set) {
    set = new Set();
    subscriptions.set(ws, set);
  }
  return set;
}

function membersOf(channel) {
  let set = members.get(channel);
  if (!set) {
    set = new Set();
    members.set(channel, set);
  }
  return set;
}

function broadcastPresence(channel) {
  const set = members.get(channel);
  const count = set ? set.size : 0;
  const msg = JSON.stringify({ t: "presence", room: channel, count });
  if (!set) return;
  for (const peer of set) send(peer, msg);
}

function send(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  } catch {
    /* a dead peer will be reaped by its own close handler */
  }
}

function join(ws, channel) {
  if (!channel) return;
  const set = membersOf(channel);
  set.add(ws);
  channelsOf(ws).add(channel);
  // Hand the newcomer the current cached snapshot immediately (if any).
  const cached = cache.get(channel);
  if (cached !== undefined) {
    send(ws, { t: "snapshot", room: channel, data: cached });
  }
  broadcastPresence(channel);
  log(`join ${channel} (members=${set.size})`);
}

function leave(ws, channel, { silent = false } = {}) {
  const set = members.get(channel);
  if (set) {
    set.delete(ws);
    if (set.size === 0) {
      // Drop empty rooms entirely — no members, no cache, near-zero footprint.
      members.delete(channel);
      cache.delete(channel);
      log(`drop ${channel} (empty)`);
    } else if (!silent) {
      broadcastPresence(channel);
    }
  }
  const owned = subscriptions.get(ws);
  if (owned) owned.delete(channel);
}

function snapshot(ws, channel, data) {
  if (!channel) return;
  cache.set(channel, data);
  // Make sure the sender is a member (covers a snapshot that races the join).
  const set = membersOf(channel);
  if (!set.has(ws)) {
    set.add(ws);
    channelsOf(ws).add(channel);
    broadcastPresence(channel);
  }
  // Fan out to everyone EXCEPT the sender (they already hold this state).
  const msg = JSON.stringify({ t: "snapshot", room: channel, data });
  for (const peer of set) {
    if (peer !== ws) send(peer, msg);
  }
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed frames
    }
    if (!msg || typeof msg !== "object") return;
    const channel = typeof msg.room === "string" ? msg.room : null;
    switch (msg.t) {
      case "join":
        join(ws, channel);
        break;
      case "snapshot":
        snapshot(ws, channel, msg.data);
        break;
      case "leave":
        leave(ws, channel);
        break;
      default:
        break; // unknown message types are ignored
    }
  });

  ws.on("close", () => {
    const owned = subscriptions.get(ws);
    if (owned) {
      for (const channel of owned) leave(ws, channel);
    }
  });

  ws.on("error", () => {
    // Swallow socket errors; the close handler performs cleanup.
  });
});

wss.on("listening", () => {
  log(`listening on ws://${HOST}:${PORT} (message bus only — no LLM, no state machine)`);
});

wss.on("error", (err) => {
  log(`server error: ${err?.message ?? err}`);
});

function shutdown() {
  log("shutting down");
  try {
    wss.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
