import { AbsoluteFill, Img, staticFile } from "remotion";
import { COLOR, FONT, REPO_URL } from "../theme";
import { useFadeUp, useSceneFade } from "../motion";

/**
 * Scene F: the end card. The horizontal lockup (the primary logo), the
 * repository URL in the mono face, and the education-only line.
 */
export function EndScene({ compact = false }: { compact?: boolean }) {
  const fade = useSceneFade();
  const lockup = useFadeUp(4, 10);
  const url = useFadeUp(compact ? 12 : 20);
  const note = useFadeUp(compact ? 18 : 32);
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg, opacity: fade }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 48 }}>
        <Img
          src={staticFile("brand/acudx-lockup-horizontal.svg")}
          style={{ ...lockup, width: compact ? 640 : 760, height: "auto" }}
        />
        <div
          style={{
            ...url,
            fontFamily: FONT.mono,
            fontSize: compact ? 36 : 40,
            color: COLOR.fg,
            padding: "16px 32px",
            border: `1px solid ${COLOR.border}`,
            borderRadius: 12,
            backgroundColor: COLOR.bgSubtle,
          }}
        >
          {REPO_URL}
        </div>
        <div style={{ ...note, fontFamily: FONT.body, fontSize: 24, color: COLOR.muted, textAlign: "center", lineHeight: 1.5 }}>
          Education only. Synthetic patients. Turkish and English.
          <span lang="tr" style={{ display: "block", fontSize: 20 }}>
            Yalnızca eğitim amaçlı. Sentetik hastalar. Türkçe ve İngilizce.
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
