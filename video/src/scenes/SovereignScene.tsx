import { AbsoluteFill } from "remotion";
import { COLOR, FONT } from "../theme";
import { useFadeUp, useSceneFade } from "../motion";

const POINTS = [
  { en: "Open source", tr: "Açık kaynak" },
  { en: "Self-hosted, on your own hardware", tr: "Kendi donanımınızda, kendi barındırmanız" },
  { en: "No key ever reaches the browser", tr: "Hiçbir anahtar tarayıcıya ulaşmaz" },
  { en: "Education only. Synthetic patients. No PHI path.", tr: "Yalnızca eğitim. Sentetik hastalar. PHI yolu yok." },
];

/**
 * Scene E: the open-source and sovereign line. The one dark surface in the
 * system is the monitor palette, used here as a calm full-bleed background
 * with the trace colour as a hairline accent.
 */
export function SovereignScene() {
  const fade = useSceneFade();
  const head = useFadeUp(6);
  const sub = useFadeUp(18);
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.monitorBg, opacity: fade }}>
      <AbsoluteFill style={{ padding: "0 220px", justifyContent: "center" }}>
        <div
          style={{
            ...head,
            fontFamily: FONT.display,
            fontWeight: 700,
            fontSize: 104,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            color: COLOR.monitorFg,
          }}
        >
          Open source. Sovereign by design.
        </div>
        <div
          lang="tr"
          style={{
            ...sub,
            marginTop: 22,
            fontFamily: FONT.display,
            fontWeight: 600,
            fontSize: 54,
            letterSpacing: "-0.025em",
            color: COLOR.monitorTrace,
          }}
        >
          Açık kaynak. Tasarım gereği egemen.
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: "64px 0 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "26px 60px" }}>
          {POINTS.map((p, i) => (
            <Point key={p.en} point={p} delay={34 + i * 6} />
          ))}
        </ul>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Point({ point, delay }: { point: { en: string; tr: string }; delay: number }) {
  const style = useFadeUp(delay);
  return (
    <li style={{ ...style, display: "flex", gap: 18, alignItems: "flex-start" }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR.monitorTrace, marginTop: 14, flexShrink: 0 }} />
      <span>
        <span style={{ display: "block", fontFamily: FONT.body, fontSize: 30, color: COLOR.monitorFg, lineHeight: 1.3 }}>{point.en}</span>
        <span lang="tr" style={{ display: "block", fontFamily: FONT.body, fontSize: 22, color: COLOR.monitorMuted, lineHeight: 1.3, marginTop: 4 }}>
          {point.tr}
        </span>
      </span>
    </li>
  );
}
