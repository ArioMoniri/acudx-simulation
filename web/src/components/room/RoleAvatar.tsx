import { cn } from "@/lib/cn";
import type { Participant } from "@/data/rooms";

export interface RoleAvatarProps {
  participant: Participant;
  size?: "xs" | "sm" | "md";
  className?: string;
}

/**
 * RoleAvatar — a compact identity chip for a participant. Humans show their
 * initials on a neutral surface; AI participants show the letters "AI" on a brand
 * tint so an AI-held seat is legible at a glance AND (paired with the always
 * present text badge elsewhere) never carried by colour alone.
 */
export function RoleAvatar({ participant, size = "md", className }: RoleAvatarProps) {
  const isAi = participant.kind === "ai";
  const dims =
    size === "xs"
      ? "h-6 w-6 text-[0.625rem]"
      : size === "sm"
        ? "h-8 w-8 text-xs"
        : "h-10 w-10 text-sm";

  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold leading-none tracking-tight",
        dims,
        isAi
          ? "bg-brand-tint text-brand"
          : "bg-bg-subtle text-fg ring-1 ring-inset ring-border",
        className,
      )}
      aria-hidden="true"
    >
      {/* Letters, not a robot glyph: "AI" reads at any size and in print. */}
      {isAi ? "AI" : participant.initials}
    </span>
  );
}
