import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  pickPatientPhoto,
  patientPhotoUrl,
  type PhotoSex,
} from "@/data/patientPhotos";

export interface ClinicalSignHint {
  sign: string;
  intensity: number;
}

export interface PatientPhotoProps {
  sex: PhotoSex;
  /** Patient age in years — drives which face is shown. */
  age: number;
  /** Stable seed so a given case keeps the same face across renders. */
  seed?: number;
  /** Accessible description (defaults to a synthetic-patient statement). */
  alt?: string;
  /** Physiology signs — apply a subtle clinical tint (pallor/cyanosis/sweat). */
  signs?: ClinicalSignHint[];
  /** Caption under the photo (e.g. the affect / clinical-sign summary). */
  caption?: ReactNode;
  className?: string;
}

/** Derive a subtle CSS filter + cyanosis overlay strength from the signs. */
function physiology(signs: ClinicalSignHint[] | undefined): {
  filter?: string;
  cyanosis: number;
} {
  let saturate = 1;
  let brightness = 1;
  let cyanosis = 0;
  for (const s of signs ?? []) {
    const k = s.sign.toLowerCase();
    if (k.includes("cyanos")) cyanosis = Math.max(cyanosis, s.intensity);
    if (k.includes("pallor") || k.includes("pale")) {
      saturate = Math.min(saturate, 1 - 0.45 * s.intensity);
      brightness = Math.min(1.08, brightness + 0.06 * s.intensity);
    }
    if (k.includes("diaphor") || k.includes("sweat"))
      brightness = Math.min(1.1, brightness + 0.05 * s.intensity);
  }
  const parts: string[] = [];
  if (saturate < 0.999) parts.push(`saturate(${saturate.toFixed(2)})`);
  if (Math.abs(brightness - 1) > 0.001) parts.push(`brightness(${brightness.toFixed(2)})`);
  return { filter: parts.length ? parts.join(" ") : undefined, cyanosis };
}

/**
 * PatientPhoto — the realistic synthetic patient face for a case, matched to the
 * demographic (sex + age). Physiology signs apply a subtle clinical tint. Always
 * labelled "Synthetic patient" so the generated nature is never hidden. Static +
 * bundled: no runtime generation, air-gapped-safe.
 */
export function PatientPhoto({
  sex,
  age,
  seed = 0,
  alt,
  signs,
  caption,
  className,
}: PatientPhotoProps) {
  const photo = useMemo(() => pickPatientPhoto(sex, age, seed), [sex, age, seed]);
  const { filter, cyanosis } = useMemo(() => physiology(signs), [signs]);

  return (
    <figure
      className={cn(
        "relative overflow-hidden rounded-control bg-monitor-border/40",
        className,
      )}
    >
      <img
        src={patientPhotoUrl(photo.id)}
        alt={alt ?? "Synthetic patient portrait — not a real individual"}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        style={filter ? { filter } : undefined}
        draggable={false}
      />
      {/* Cyanosis overlay — a faint bluish cast when hypoxic (never sole cue). */}
      {cyanosis > 0.05 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 mix-blend-multiply"
          style={{
            backgroundColor: "#3b6ea5",
            opacity: Math.min(0.28, cyanosis * 0.34),
          }}
        />
      ) : null}
      {/* Synthetic-patient label — always visible (never hidden). */}
      <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-chip bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
        Synthetic
      </span>
      {caption ? (
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-[11px] leading-tight text-white/90">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
