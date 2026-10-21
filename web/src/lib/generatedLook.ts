/**
 * generatedLook: the chart's still portrait as the case's generated picture (docs/architecture/18 6.6).
 *
 * At case start the gateway edits the case portrait into the patient's states (presenting, worse,
 * critical, improved) on the GPU worker; the live call shows them, and every still portrait of the
 * case (banner, viewer, the call tile before the call is live) shows the one that matches the
 * patient now. One watcher per (thread, photo) is shared by every surface: it reads
 * GET /v1/voice/avatar/look, fetches the picture as a Blob when its key changes (the route needs the
 * bearer, so no plain <img src>) and keeps an object URL. It re-reads every `intervalMs`, so a Director
 * step that changes the patient moves the portrait too.
 */

import type { AvatarLook, VoiceApi } from "@/lib/voiceApi";

export interface GeneratedLook {
  /** Object URL of the generated picture, or null while there is none. */
  url: string | null;
  key: string | null;
  exact: boolean;
  state: AvatarLook["state"];
}

export const EMPTY_LOOK: GeneratedLook = { url: null, key: null, exact: false, state: "none" };
/** While the pictures are being made. */
export const LOOK_POLL_MS = 15_000;
/** Once a picture is shown: follow the patient's state. */
export const LOOK_FOLLOW_MS = 30_000;

type Listener = (look: GeneratedLook) => void;

interface Watch {
  look: GeneratedLook;
  listeners: Set<Listener>;
  stop: () => void;
}

const watches = new Map<string, Watch>();

export interface WatchDeps {
  api: Pick<VoiceApi, "avatarLook" | "avatarLookImage">;
  createUrl?: (b: Blob) => string;
  revokeUrl?: (u: string) => void;
}

/** Start one watcher (exported for tests; components use `subscribeGeneratedLook`). */
export function startLookWatch(
  threadId: string,
  photoId: string,
  onLook: Listener,
  deps: WatchDeps,
): () => void {
  const createUrl = deps.createUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = deps.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: GeneratedLook = EMPTY_LOOK;
  const tick = async () => {
    timer = null;
    if (stopped) return;
    const res = await deps.api.avatarLook(threadId, photoId, { timeoutMs: 8000 });
    if (stopped) return;
    if (res.ok) {
      const l = res.data;
      if (l.has_image && l.key && l.key !== current.key) {
        const img = await deps.api.avatarLookImage(threadId, photoId, l.key, { timeoutMs: 15_000 });
        if (stopped) return;
        if (img.ok) {
          const prev = current.url;
          current = { url: createUrl(img.data), key: l.key, exact: !!l.exact, state: l.state };
          onLook(current);
          if (prev) revokeUrl(prev);
        }
      } else if (l.state !== current.state) {
        current = { ...current, state: l.state, exact: l.key === current.key ? !!l.exact : current.exact };
        onLook(current);
      }
    }
    // A 404 (no case thread) or a gateway without the route: stop quietly, the case portrait stays.
    if (!res.ok && (res.status === 404 || res.status === 405)) return;
    timer = setTimeout(() => void tick(), current.url ? LOOK_FOLLOW_MS : LOOK_POLL_MS);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer != null) clearTimeout(timer);
    if (current.url) revokeUrl(current.url);
  };
}

/** Subscribe a surface to the case's generated look; the watcher is shared and stops with the last one. */
export function subscribeGeneratedLook(
  threadId: string,
  photoId: string,
  listener: Listener,
  deps: WatchDeps,
): () => void {
  const id = `${threadId}:${photoId}`;
  let w = watches.get(id);
  if (!w) {
    const created: Watch = { look: EMPTY_LOOK, listeners: new Set(), stop: () => {} };
    created.stop = startLookWatch(threadId, photoId, (look) => {
      created.look = look;
      created.listeners.forEach((l) => l(look));
    }, deps);
    watches.set(id, created);
    w = created;
  }
  w.listeners.add(listener);
  if (w.look.url) listener(w.look);
  return () => {
    const cur = watches.get(id);
    if (!cur) return;
    cur.listeners.delete(listener);
    if (cur.listeners.size === 0) {
      cur.stop();
      watches.delete(id);
    }
  };
}
