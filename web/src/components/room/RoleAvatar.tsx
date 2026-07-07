import { Robot } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { Participant } from "@/data/rooms";

export interface RoleAvatarProps {
  participant: Participant;
  size?: "sm" | "md";
  className?: string;
}

/**
 * RoleAvatar — a compact identity chip for a participant. Humans show their
 * initials on a neutral surface; AI participants show a robot glyph on a brand
 * tint so an AI-held seat is legible at a glance AND (paired with the always
 * present text badge elsewhere) never carried by colour alone.
 */
export function RoleAvatar({ participant, size = "md", className }: RoleAvatarProps) {
  const isAi = participant.kind === "ai";
  const dims = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";

  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold",
        dims,
        isAi
          ? "bg-brand-tint text-brand"
          : "bg-bg-subtle text-fg ring-1 ring-inset ring-border",
        className,
      )}
      aria-hidden="true"
    >
      {isAi ? (
        <Robot weight="bold" className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
      ) : (
        participant.initials
      )}
    </span>
  );
}
