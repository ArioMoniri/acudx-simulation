import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { COLOR, FONT } from "../theme";
import { useFadeUp, useSceneFade } from "../motion";

interface Feature {
  icon: ReactNode;
  title: { en: string; tr: string };
  body: { en: string; tr: string };
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/* Five small geometric glyphs in the Phosphor "regular" weight spirit, drawn inline so the render needs no icon package. */
const Icons = {
  generator: (
    <svg viewBox="0 0 32 32" width="34" height="34" {...stroke}>
      <path d="M16 4v6M16 22v6M4 16h6M22 16h6M7.5 7.5l4.2 4.2M20.3 20.3l4.2 4.2M24.5 7.5l-4.2 4.2M11.7 20.3l-4.2 4.2" />
    </svg>
  ),
  cited: (
    <svg viewBox="0 0 32 32" width="34" height="34" {...stroke}>
      <path d="M5 6h9a3 3 0 0 1 3 3v17a2 2 0 0 0-2-2H5zM27 6h-9a3 3 0 0 0-3 3v17a2 2 0 0 1 2-2h10z" />
      <path d="M9 12h4M9 16h4M19 12h4M19 16h4" />
    </svg>
  ),
  rooms: (
    <svg viewBox="0 0 32 32" width="34" height="34" {...stroke}>
      <circle cx="16" cy="9" r="4" />
      <circle cx="7" cy="14" r="3" />
      <circle cx="25" cy="14" r="3" />
      <path d="M9 27a7 7 0 0 1 14 0M2 23a5 5 0 0 1 6-4.6M30 23a5 5 0 0 0-6-4.6" />
    </svg>
  ),
  voice: (
    <svg viewBox="0 0 32 32" width="34" height="34" {...stroke}>
      <rect x="11" y="3" width="10" height="16" rx="5" />
      <path d="M6 14a10 10 0 0 0 20 0M16 24v5M11 29h10" />
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 32 32" width="34" height="34" {...stroke}>
      <path d="M4 27h24M8 23V15M14 23V9M20 23v-7M26 23V5" />
    </svg>
  ),
};

export const FEATURES: Feature[] = [
  {
    icon: Icons.generator,
    title: { en: "Dynamic case generator", tr: "Dinamik vaka üreteci" },
    body: { en: "Every encounter is generated on demand, so a cohort can never memorise the bank.", tr: "Her karşılaşma anında üretilir; bir dönem vaka bankasını ezberleyemez." },
  },
  {
    icon: Icons.cited,
    title: { en: "Cited attending tips", tr: "Kaynaklı uzman ipuçları" },
    body: { en: "Every hint and every miss points at a guideline statement that resolves.", tr: "Her ipucu ve her atlanan nokta, erişilebilir bir kılavuz ifadesine bağlıdır." },
  },
  {
    icon: Icons.rooms,
    title: { en: "Interprofessional rooms", tr: "Meslekler arası odalar" },
    body: { en: "Doctor, nurse and paramedic work one live patient, with AI holding empty seats.", tr: "Hekim, hemşire ve paramedik tek canlı hastada çalışır; boş koltukları yapay zeka tutar." },
  },
  {
    icon: Icons.voice,
    title: { en: "Voice and video interview", tr: "Sesli ve görüntülü görüşme" },
    body: { en: "Take the history by talking to the patient, in Turkish or English.", tr: "Öyküyü hastayla konuşarak alın; Türkçe ya da İngilizce." },
  },
  {
    icon: Icons.analytics,
    title: { en: "Dean analytics", tr: "Dekanlık analitiği" },
    body: { en: "Cohort competency, remediation and a fairness audit, aggregate and role-gated.", tr: "Dönem yetkinliği, telafi ve adalet denetimi; toplu ve role bağlı." },
  },
];

/**
 * Scene D: five feature cards, staggered fade-up (motion.ts STAGGER_GAP of
 * 0.06 s, here 2 frames), hairline borders, one brand-tint icon well each.
 */
export function FeatureScene() {
  const fade = useSceneFade();
  const head = useFadeUp(4);
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg, opacity: fade }}>
      <AbsoluteFill style={{ padding: "110px 120px 0" }}>
        <div style={{ ...head, display: "flex", alignItems: "baseline", gap: 24 }}>
          <span
            style={{
              fontFamily: FONT.body,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: COLOR.muted,
            }}
          >
            Beyond the encounter
          </span>
          <span lang="tr" style={{ fontFamily: FONT.body, fontSize: 18, color: COLOR.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Karşılaşmanın ötesi
          </span>
        </div>
        <h2
          style={{
            ...head,
            margin: "18px 0 0",
            fontFamily: FONT.display,
            fontWeight: 700,
            fontSize: 64,
            letterSpacing: "-0.03em",
            color: COLOR.fg,
          }}
        >
          A whole training programme around the loop
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 24, marginTop: 72 }}>
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title.en} feature={f} delay={20 + i * 6} />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function FeatureCard({ feature, delay }: { feature: Feature; delay: number }) {
  const style = useFadeUp(delay, 16);
  return (
    <div
      style={{
        ...style,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 16,
        padding: 28,
        backgroundColor: COLOR.surface,
        minHeight: 380,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <span
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          backgroundColor: COLOR.brandTint,
          color: COLOR.brand,
        }}
      >
        {feature.icon}
      </span>
      <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em", color: COLOR.fg, lineHeight: 1.15 }}>
        {feature.title.en}
      </div>
      <div lang="tr" style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 21, color: COLOR.brand, lineHeight: 1.2, marginTop: -8 }}>
        {feature.title.tr}
      </div>
      <div style={{ fontFamily: FONT.body, fontSize: 20, color: COLOR.muted, lineHeight: 1.45 }}>{feature.body.en}</div>
      <div lang="tr" style={{ fontFamily: FONT.body, fontSize: 17, color: COLOR.muted, lineHeight: 1.45, marginTop: "auto" }}>
        {feature.body.tr}
      </div>
    </div>
  );
}
