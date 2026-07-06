import { useTranslation } from "react-i18next";

export interface PatientPortraitProps {
  /** Clinical-sign caption, already localized. */
  caption: string;
  /** Patient name shown as a label. */
  name: string;
}

/**
 * PatientPortrait — a tasteful, abstract 2D SVG portrait (never a photo) for
 * the monitor panel. Subtle sweat beads + a slightly furrowed brow read as
 * "diaphoretic, mild distress" without caricature. Decorative: the clinical
 * meaning is carried by the visible text caption below it.
 */
export function PatientPortrait({ caption, name }: PatientPortraitProps) {
  const { t } = useTranslation();

  return (
    <figure
      className="rounded-control border p-3"
      style={{
        borderColor: "var(--monitor-border)",
        backgroundColor: "color-mix(in srgb, var(--monitor-fg) 4%, transparent)",
      }}
    >
      <div className="flex items-center gap-3">
        <svg
          viewBox="0 0 72 72"
          className="h-16 w-16 shrink-0"
          role="img"
          aria-label={`${t("encounter.portrait.title")}: ${caption}`}
        >
          <defs>
            <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c98f6f" />
              <stop offset="100%" stopColor="#b07a5c" />
            </linearGradient>
          </defs>
          {/* Shoulders / gown */}
          <path
            d="M12 72c0-13 10.7-20 24-20s24 7 24 20"
            fill="#334155"
          />
          <path
            d="M22 56l14 9 14-9v6l-14 9-14-9z"
            fill="#1e293b"
            opacity="0.7"
          />
          {/* Neck */}
          <rect x="30" y="40" width="12" height="12" rx="5" fill="url(#skin)" />
          {/* Head */}
          <ellipse cx="36" cy="28" rx="15" ry="17" fill="url(#skin)" />
          {/* Hair */}
          <path
            d="M21 24c0-9 7-15 15-15s15 6 15 15c-3-4-8-6-15-6s-12 2-15 6z"
            fill="#3f3a36"
          />
          {/* Brow (furrowed, mild distress) */}
          <path
            d="M27 24.5c1.6-1.2 3.6-1.2 5 0"
            stroke="#5b4636"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M40 24.5c1.4-1.2 3.4-1.2 5 0"
            stroke="#5b4636"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
          {/* Eyes */}
          <circle cx="30" cy="28.5" r="1.5" fill="#26201c" />
          <circle cx="42" cy="28.5" r="1.5" fill="#26201c" />
          {/* Mouth (slightly tense) */}
          <path
            d="M31 37c2 1.6 8 1.6 10 0"
            stroke="#7a4a3a"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
          {/* Sweat beads (diaphoresis) */}
          <path
            d="M49 21c1.4 1.8 1.4 3.4 0 3.4s-1.4-1.6 0-3.4z"
            fill="#7dd3fc"
            opacity="0.85"
          />
          <path
            d="M23 20c1.2 1.6 1.2 3 0 3s-1.2-1.4 0-3z"
            fill="#7dd3fc"
            opacity="0.7"
          />
        </svg>

        <div className="min-w-0">
          <p className="text-sm font-medium" style={{ color: "var(--monitor-fg)" }}>
            {name}
          </p>
          <p
            className="mt-0.5 text-xs"
            style={{ color: "var(--monitor-dim)" }}
          >
            <span className="font-medium">{t("encounter.portrait.sign")}: </span>
            <span className="italic">{caption}</span>
          </p>
        </div>
      </div>
    </figure>
  );
}
