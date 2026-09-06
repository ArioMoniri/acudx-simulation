/**
 * AcuDx — room realtime transport (client half of the local multiplayer relay).
 *
 * A tiny, DEPENDENCY-FREE browser WebSocket client that turns the single-device
 * room mock into genuine cross-device multiplayer WITHOUT any heavy runtime: the
 * relay in `multiplayer/server.mjs` is a dumb message bus that caches the latest
 * room snapshot per channel and fans it out to the other members. All game logic
 * stays in the existing client mutations (roomStore); this file only ships the
 * resulting snapshot and hands incoming ones back to the store.
 *
 * Design contract:
 *   - GRACEFUL: nothing here ever throws into the app. If the socket cannot open
 *     (no relay running, offline, SSR), the app keeps working single-device and
 *     the status simply reports "disconnected".
 *   - SINGLE active connection at a time (one room per device), matching the
 *     `disconnect()` (no-arg) shape and the "you are in one room" UX.
 *   - Auto-reconnect with capped exponential backoff; the latest local snapshot
 *     is re-flushed on every (re)open so a reconnecting host re-seeds the cache.
 *   - SSR-safe: guards `window` / `WebSocket` and never touches them at import.
 *
 * Wire protocol (JSON), channel = the room's shared join code (see roomStore):
 *   client -> server  { t:"join",     room }            subscribe + pull cache
 *   client -> server  { t:"snapshot", room, data }      cache + fan-out to peers
 *   client -> server  { t:"leave",    room }            unsubscribe
 *   server -> client  { t:"snapshot", room, data }      a cached / forwarded snap
 *   server -> client  { t:"presence", room, count }     members in the channel
 *
 * Education only. No real patient data path.
 */

export type RoomConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "disconnected";

export interface RoomTransportStatus {
  state: RoomConnectionState;
  /** Members currently in the channel (including this device), when known. */
  peers: number;
  /** The channel (join code) this device is subscribed to, or null. */
  channel: string | null;
}

export interface ConnectRoomOptions {
  /** Called with the `data` payload of every incoming snapshot for this channel. */
  onSnapshot: (data: unknown) => void;
  /** Optional: called whenever the connection state or peer count changes. */
  onStatus?: (status: RoomTransportStatus) => void;
}

/* -------------------------------------------------------------------------- */
/* URL resolution                                                             */
/* -------------------------------------------------------------------------- */

const LS_URL_KEY = "acudx-mp-url";
const DEFAULT_PORT = 8899;

/**
 * Resolve the relay URL:
 *   1. `VITE_MULTIPLAYER_URL` (build-time env)
 *   2. `localStorage["acudx-mp-url"]` (runtime override, e.g. point at a LAN host)
 *   3. Derived from the page origin: `wss://<host>` when the page is served over
 *      https (same-origin, reverse-proxy friendly, avoids mixed-content), else
 *      `ws://<hostname>:8899` for local / LAN development.
 */
export function resolveRelayUrl(): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const fromEnv = env.VITE_MULTIPLAYER_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  try {
    if (typeof localStorage !== "undefined") {
      const override = localStorage.getItem(LS_URL_KEY);
      if (override && override.trim()) return override.trim();
    }
  } catch {
    /* localStorage may be unavailable (private mode / SSR) — ignore. */
  }

  const loc = typeof location !== "undefined" ? location : undefined;

  // On https, connect with wss on the SAME origin so a reverse proxy can route
  // the relay without tripping the browser's mixed-content block. On http/dev,
  // reach the local relay process on its own port.
  if (loc?.protocol === "https:") {
    return `wss://${loc.host}`;
  }

  const host = loc?.hostname || "localhost";
  return `ws://${host}:${DEFAULT_PORT}`;
}

/* -------------------------------------------------------------------------- */
/* Module state (single active connection)                                    */
/* -------------------------------------------------------------------------- */

const RECONNECT_MIN_MS = 600;
const RECONNECT_MAX_MS = 8000;

let socket: WebSocket | null = null;
/** The channel we WANT to be connected to (null once `disconnect` is called). */
let desiredChannel: string | null = null;
let onSnapshotCb: ((data: unknown) => void) | null = null;
let onStatusCb: ((status: RoomTransportStatus) => void) | null = null;

let status: RoomTransportStatus = { state: "idle", peers: 0, channel: null };
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Latest local snapshot per channel — re-flushed on every (re)open. */
const pendingSnapshots = new Map<string, unknown>();

function canUseSockets(): boolean {
  return typeof window !== "undefined" && typeof WebSocket !== "undefined";
}

function setStatus(next: Partial<RoomTransportStatus>): void {
  status = { ...status, ...next };
  try {
    onStatusCb?.(status);
  } catch {
    /* a status listener must never break the transport */
  }
}

/** Current connection status (non-reactive snapshot). */
export function getStatus(): RoomTransportStatus {
  return status;
}

function clearReconnect(): void {
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (desiredChannel == null) return;
  clearReconnect();
  const delay = reconnectDelay;
  reconnectDelay = Math.min(RECONNECT_MAX_MS, Math.round(reconnectDelay * 1.7));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, delay);
}

function safeSend(payload: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function openSocket(): void {
  if (desiredChannel == null || !canUseSockets()) return;
  // Tear down any half-open socket before opening a new one.
  teardownSocket();

  const channel = desiredChannel;
  setStatus({ state: "connecting", channel });

  let ws: WebSocket;
  try {
    ws = new WebSocket(resolveRelayUrl());
  } catch {
    // Construction itself failed (bad URL, blocked) — degrade + retry.
    setStatus({ state: "disconnected" });
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    if (desiredChannel !== channel) {
      // We were re-pointed while connecting; drop this socket.
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      return;
    }
    reconnectDelay = RECONNECT_MIN_MS;
    setStatus({ state: "live", channel });
    safeSend({ t: "join", room: channel });
    // Re-seed the relay with our latest known snapshot for this channel.
    const pending = pendingSnapshots.get(channel);
    if (pending !== undefined) {
      safeSend({ t: "snapshot", room: channel, data: pending });
    }
  };

  ws.onmessage = (event: MessageEvent) => {
    let msg: unknown;
    try {
      msg =
        typeof event.data === "string" ? JSON.parse(event.data) : undefined;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const m = msg as { t?: string; room?: string; data?: unknown; count?: number };
    if (m.room !== channel) return;
    if (m.t === "snapshot") {
      try {
        onSnapshotCb?.(m.data);
      } catch {
        /* a snapshot handler must never break the transport */
      }
    } else if (m.t === "presence") {
      setStatus({ peers: typeof m.count === "number" ? m.count : status.peers });
    }
  };

  ws.onerror = () => {
    // `onclose` follows and handles reconnect; keep this quiet.
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (desiredChannel === channel) {
      setStatus({ state: "disconnected", peers: 0 });
      scheduleReconnect();
    }
  };
}

function teardownSocket(): void {
  const ws = socket;
  socket = null;
  if (!ws) return;
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Subscribe this device to a room channel. Re-calling with the SAME channel is a
 * no-op (keeps the live socket); a DIFFERENT channel transparently switches. The
 * `onSnapshot` callback receives the `data` payload of every cached / forwarded
 * snapshot. Never throws — on any failure the status simply reports disconnected.
 */
export function connectRoom(channel: string, opts: ConnectRoomOptions): void {
  const normalized = String(channel || "").trim();
  onSnapshotCb = opts.onSnapshot;
  onStatusCb = opts.onStatus ?? null;

  if (!normalized || !canUseSockets()) {
    desiredChannel = normalized || null;
    setStatus({ state: "disconnected", peers: 0, channel: desiredChannel });
    return;
  }

  if (desiredChannel === normalized && socket) {
    // Already connected / connecting to this channel — refresh callbacks only.
    setStatus({ channel: normalized });
    return;
  }

  // Leaving a previous channel: tell the relay before switching.
  if (desiredChannel && desiredChannel !== normalized) {
    safeSend({ t: "leave", room: desiredChannel });
  }

  desiredChannel = normalized;
  reconnectDelay = RECONNECT_MIN_MS;
  clearReconnect();
  setStatus({ state: "connecting", peers: 0, channel: normalized });
  openSocket();
}

/**
 * Broadcast a room snapshot for a channel. The latest snapshot per channel is
 * remembered and re-flushed on reconnect, so a call made before the socket is
 * open (e.g. right after createRoom) is not lost. Never throws.
 */
export function sendSnapshot(channel: string, data: unknown): void {
  const normalized = String(channel || "").trim();
  if (!normalized) return;
  pendingSnapshots.set(normalized, data);
  if (normalized === desiredChannel) {
    safeSend({ t: "snapshot", room: normalized, data });
  }
}

/**
 * Close the active connection and stop reconnecting. Safe to call repeatedly.
 */
export function disconnect(): void {
  clearReconnect();
  if (desiredChannel) {
    safeSend({ t: "leave", room: desiredChannel });
  }
  desiredChannel = null;
  teardownSocket();
  setStatus({ state: "idle", peers: 0, channel: null });
}
