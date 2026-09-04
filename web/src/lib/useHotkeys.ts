import { useEffect, useRef } from "react";

/**
 * useHotkeys — a tiny, dependency-free keyboard-shortcut hook for the encounter.
 *
 * Bindings use human-readable combos:
 *   - "mod+k"  → ⌘K on macOS / iPad, Ctrl-K everywhere else
 *   - "1".."9" → the bare digit keys (tab switching)
 *   - "?"      → the shifted-slash character (open help/palette)
 * Additional modifiers ("ctrl", "meta"/"cmd", "shift", "alt"/"opt") are also
 * understood, e.g. "shift+/" or "ctrl+meta+p".
 *
 * By default a binding is ignored while focus sits in an editable field
 * (input / textarea / select / contenteditable) so typing never triggers a
 * shortcut. Pass `whenTyping: true` for combos that must fire anywhere — the
 * palette's own ⌘K toggle is the canonical example.
 *
 * SSR-safe (no listener without a `window`), and the single keydown listener is
 * torn down cleanly on unmount or when `enabled` flips to false. Handlers are
 * read through a ref so the listener is not re-subscribed on every render.
 */

export interface HotkeyBinding {
  /** e.g. "mod+k", "1", "?". Case-insensitive. */
  combo: string;
  /** Invoked with the raw event so the caller can `preventDefault()`. */
  handler: (e: KeyboardEvent) => void;
  /** Fire even while focus is in an editable field. Defaults to false. */
  whenTyping?: boolean;
}

interface ParsedCombo {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** macOS / iPadOS use ⌘ (metaKey) as the primary modifier; everywhere else Ctrl. */
function isMacLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const probe = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(probe);
}

function parseCombo(combo: string): ParsedCombo {
  const parsed: ParsedCombo = {
    key: "",
    mod: false,
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
  };
  for (const raw of combo.toLowerCase().split("+")) {
    const part = raw.trim();
    if (!part) continue;
    switch (part) {
      case "mod":
        parsed.mod = true;
        break;
      case "ctrl":
      case "control":
        parsed.ctrl = true;
        break;
      case "meta":
      case "cmd":
      case "command":
      case "win":
        parsed.meta = true;
        break;
      case "shift":
        parsed.shift = true;
        break;
      case "alt":
      case "option":
      case "opt":
        parsed.alt = true;
        break;
      default:
        parsed.key = part;
    }
  }
  return parsed;
}

function comboMatches(e: KeyboardEvent, pc: ParsedCombo, mac: boolean): boolean {
  if (!pc.key) return false;
  if (e.key.toLowerCase() !== pc.key) return false;

  const wantMeta = pc.meta || (pc.mod && mac);
  const wantCtrl = pc.ctrl || (pc.mod && !mac);
  if (e.metaKey !== wantMeta) return false;
  if (e.ctrlKey !== wantCtrl) return false;
  // Alt must match exactly (so "alt+" combos don't leak into bare keys).
  if (e.altKey !== pc.alt) return false;
  // Shift is only enforced when requested: characters like "?" are produced
  // with Shift held, and we match those on the resulting character instead.
  if (pc.shift && !e.shiftKey) return false;
  return true;
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable === true;
}

export function useHotkeys(
  bindings: HotkeyBinding[],
  enabled: boolean = true,
): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const mac = isMacLike();

    function onKeyDown(e: KeyboardEvent) {
      const typing = isTypingTarget(e);
      for (const binding of bindingsRef.current) {
        if (typing && !binding.whenTyping) continue;
        if (comboMatches(e, parseCombo(binding.combo), mac)) {
          binding.handler(e);
          return; // first match wins
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
