import { AbsoluteFill } from "remotion";
import { COLOR, FONT } from "../theme";
import { useFadeUp, useSceneFade } from "../motion";

export const PROMISE = {
  en: { line: "Simulated patients. Real decisions.", sub: "A clinical reasoning simulator inside a real EHR shell." },
  tr: { line: "Simüle hastalar. Gerçek kararlar.", sub: "Gerçek bir EHR kabuğu içinde klinik akıl yürütme simülatörü." },
} as const;

/**
 * Scene B: the one-line promise, English first and Turkish beneath it,
 * because the product is first-class in both.
 */
export function PromiseScene({ compact = false }: { compact?: boolean }) {
  const fade = useSceneFade();
  const en = useFadeUp(6);
  const tr = useFadeUp(compact ? 16 : 26);
  const sub = useFadeUp(compact ? 26 : 44);
  const rule = useFadeUp(compact ? 12 : 20, 0);

  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg, opacity: fade }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "flex-start", padding: "0 220px" }}>
        <div
          style={{
            ...en,
            fontFamily: FONT.display,
            fontWeight: 700,
            fontSize: compact ? 96 : 112,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            color: COLOR.fg,
          }}
        >
          Simulated patients.
          <br />
          Real decisions.
        </div>
        <div
          style={{
            ...rule,
            width: 72,
            height: 4,
            borderRadius: 2,
            backgroundColor: COLOR.brand,
            margin: "40px 0 36px",
          }}
        />
        <div
          lang="tr"
          style={{
            ...tr,
            fontFamily: FONT.display,
            fontWeight: 600,
            fontSize: compact ? 60 : 68,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            color: COLOR.brand,
          }}
        >
          {PROMISE.tr.line}
        </div>
        {compact ? null : (
          <div
            style={{
              ...sub,
              marginTop: 44,
              fontFamily: FONT.body,
              fontSize: 34,
              color: COLOR.muted,
              lineHeight: 1.4,
            }}
          >
            {PROMISE.en.sub}
            <span style={{ display: "block", fontSize: 28, marginTop: 6 }} lang="tr">
              {PROMISE.tr.sub}
            </span>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
