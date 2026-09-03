import { useEffect, useId, type CSSProperties, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "motion/react";

import {
  hashSeed,
  type PatientProfile,
  type SkinTone,
  type HairColor,
  type BaselineAffect,
} from "@/domain/patientProfiles";
import {
  computeAvatarMotion,
  ensureAvatarStyles,
  motionVars,
} from "@/lib/avatarMotion";
// Type-only import (erased at build) so there is no runtime cycle with the
// PatientAvatar module, which imports this component's value.
import type {
  ClinicalSignIntensity,
  AvatarAffect,
} from "@/components/ehr/PatientAvatar";

export interface PatientPortraitProps {
  /** Clinical-sign caption, already localized. Carries the clinical meaning. */
  caption: string;
  /** Patient name shown as a label. */
  name: string;
  /**
   * Optional character profile. When present the portrait renders a parametric
   * procedural avatar (skin tone, hair, headwear, build, affect + clinical-sign
   * shading). When absent it falls back to the original abstract portrait so
   * existing callers keep their current behaviour.
   */
  profile?: PatientProfile;
  /** Clinical-sign intensities (0..1) that shade the face. Used with `profile`. */
  signs?: ClinicalSignIntensity[];
  /** Affect from the persona agent (intensity drives idle motion strength). */
  affect?: AvatarAffect;
}

/* ========================================================================== */
/* Palettes                                                                    */
/* ========================================================================== */

const SKIN: Record<SkinTone, { base: string; shadow: string; blush: string }> = {
  1: { base: "#f3d3c0", shadow: "#e0b39a", blush: "#e6a08b" },
  2: { base: "#eec5a6", shadow: "#d7a381", blush: "#dd937b" },
  3: { base: "#d7a878", shadow: "#bd8b5d", blush: "#c17c62" },
  4: { base: "#b9865c", shadow: "#9c6942", blush: "#a15d47" },
  5: { base: "#8d5a3c", shadow: "#6f4329", blush: "#7c4030" },
  6: { base: "#5e3b28", shadow: "#46291b", blush: "#5c2f20" },
};

const HAIR: Record<HairColor, string> = {
  black: "#241f1c",
  brown: "#5a3d29",
  blonde: "#cf9f5b",
  gray: "#9aa0a6",
  red: "#a44a2a",
  white: "#dfe3e6",
};

/** Soft, respectful fabric tones for hijab / headscarf, chosen per patient. */
const FABRIC = ["#6f7f9c", "#8a6f8e", "#5f8a82", "#a1856f", "#93766b", "#6d8a9c"];
const GOWN = "#4c5872";
const GOWN_FOLD = "#3d475c";
const GLASS = "#39434f";

/* ========================================================================== */
/* Color helpers                                                               */
/* ========================================================================== */

function hexToRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

/* ========================================================================== */
/* Geometry                                                                    */
/* ========================================================================== */

interface Metrics {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  eyeCy: number;
  eyeDx: number;
  eyeRx: number;
  eyeRy: number;
  browY: number;
  noseY: number;
  mouthY: number;
  shoulderHalf: number;
  isChild: boolean;
  isElderly: boolean;
}

function metricsFor(p: PatientProfile): Metrics {
  const isChild = p.age < 13;
  const isElderly = p.age >= 70;
  const cx = 36;
  const cy = isChild ? 25 : 26;
  const rx = isChild ? 14.4 : isElderly ? 12.6 : 13.2;
  const ry = isChild ? 15 : 15.4;
  const eyeCy = cy + (isChild ? 3.2 : 1.8);
  const eyeDx = isChild ? 5.6 : 5.2;
  const eyeRx = isChild ? 2.1 : 1.75;
  const eyeRy = isChild ? 2.5 : 2.05;
  const browY = eyeCy - (isChild ? 3.5 : 3.8);
  const noseY = eyeCy + (isChild ? 3 : 4.2);
  const mouthY = eyeCy + (isChild ? 6 : 8);
  const bw = p.appearance.build;
  const shoulderHalf = isChild ? 16 : bw === "slim" ? 20 : bw === "heavy" ? 26.5 : 23;
  return {
    cx, cy, rx, ry, eyeCy, eyeDx, eyeRx, eyeRy,
    browY, noseY, mouthY, shoulderHalf, isChild, isElderly,
  };
}

function sig(signs: ClinicalSignIntensity[] | undefined, kind: string): number {
  if (!signs) return 0;
  const s = signs.find((x) => x.sign === kind);
  return s ? Math.max(0, Math.min(1, s.intensity)) : 0;
}

/* ========================================================================== */
/* Feature builders (pure -> SVG element arrays)                               */
/* ========================================================================== */

type El = ReactElement;

function browPath(eyeX: number, m: Metrics, affect: BaselineAffect, strength: number): string {
  const half = m.isChild ? 2.4 : 2.7;
  const worried = affect === "anxious" || affect === "distressed" || affect === "tearful";
  const angry = affect === "irritable";
  const s = strength;
  let innerDy = 0;
  let outerDy = 0;
  if (worried) {
    innerDy = -1.5 * s;
    outerDy = 0.8 * s;
  } else if (angry) {
    innerDy = 1.4 * s;
    outerDy = -0.5 * s;
  }
  // inner edge points toward face center (cx)
  const dir = eyeX < m.cx ? 1 : -1;
  const inX = eyeX + dir * half;
  const outX = eyeX - dir * half;
  const inY = m.browY + innerDy;
  const outY = m.browY + outerDy;
  const midY = (inY + outY) / 2 - 0.5;
  return `M ${outX} ${outY} Q ${eyeX} ${midY} ${inX} ${inY}`;
}

/** One eye: dark iris + catchlight, plus a skin-tone lid that blinks/droops. */
function eye(
  eyeX: number,
  m: Metrics,
  skin: { base: string },
  femme: boolean,
): El[] {
  const { eyeCy, eyeRx, eyeRy } = m;
  const out: El[] = [];
  out.push(
    <ellipse key="i" cx={eyeX} cy={eyeCy} rx={eyeRx} ry={eyeRy} fill="#2c2420" />,
  );
  out.push(
    <circle key="c" cx={eyeX + 0.5} cy={eyeCy - 0.6} r={0.5} fill="#ffffff" opacity={0.85} />,
  );
  if (femme && !m.isChild) {
    // subtle upper lash on the outer corner
    const dir = eyeX < m.cx ? -1 : 1;
    out.push(
      <path
        key="l"
        d={`M ${eyeX + dir * eyeRx} ${eyeCy - eyeRy + 0.2} q ${dir * 1.4} ${-0.6} ${dir * 2} 0.4`}
        stroke="#2c2420"
        strokeWidth={0.8}
        strokeLinecap="round"
        fill="none"
      />,
    );
  }
  // Skin-tone eyelid, anchored at its top; scaleY handled by CSS. The class is
  // always applied: its base transform (scaleY of the resting lid) keeps the
  // eye open when motion is off, and the blink animation rides on top when on.
  out.push(
    <ellipse
      key="lid"
      className="acudx-av__lid"
      cx={eyeX}
      cy={eyeCy - eyeRy - 0.3}
      rx={eyeRx + 0.5}
      ry={eyeRy + 0.7}
      fill={skin.base}
    />,
  );
  return out;
}

/* ========================================================================== */
/* Hair + headwear                                                             */
/* ========================================================================== */

function hairBack(p: PatientProfile, m: Metrics, hair: string): El | null {
  const { cx, cy, rx } = m;
  const style = p.appearance.headwear === "none" ? p.appearance.hairStyle : "none";
  if (style === "long") {
    return (
      <path
        key="hb"
        d={`M ${cx - rx - 1} ${cy - 4}
           C ${cx - rx - 5} ${cy + 10}, ${cx - rx - 3} ${cy + 20}, ${cx - rx + 2} ${cy + 23}
           L ${cx + rx - 2} ${cy + 23}
           C ${cx + rx + 3} ${cy + 20}, ${cx + rx + 5} ${cy + 10}, ${cx + rx + 1} ${cy - 4} Z`}
        fill={hair}
      />
    );
  }
  if (style === "coily") {
    return <circle key="hb" cx={cx} cy={cy - 1.5} r={rx + 4} fill={hair} />;
  }
  if (style === "curly") {
    return <circle key="hb" cx={cx} cy={cy - 1} r={rx + 2.2} fill={hair} />;
  }
  return null;
}

function hairFront(p: PatientProfile, m: Metrics, hair: string): El[] {
  const { cx, cy, rx, ry } = m;
  const style = p.appearance.hairStyle;
  const hw = p.appearance.headwear;
  if (hw === "hijab" || style === "bald") return [];
  const els: El[] = [];
  const crownY = cy - ry - 1.5;
  const hairlineY = cy - ry * 0.42;

  const cap = (
    <path
      key="cap"
      d={`M ${cx - rx} ${cy - 1}
         C ${cx - rx - 1} ${crownY}, ${cx + rx + 1} ${crownY}, ${cx + rx} ${cy - 1}
         C ${cx + rx - 2.5} ${hairlineY + 1}, ${cx + 3.5} ${hairlineY}, ${cx} ${hairlineY + 0.4}
         C ${cx - 3.5} ${hairlineY}, ${cx - rx + 2.5} ${hairlineY + 1}, ${cx - rx} ${cy - 1} Z`}
      fill={hair}
    />
  );

  if (style === "medium" || style === "long") {
    // side panels down over the ears
    els.push(
      <path
        key="side"
        d={`M ${cx - rx} ${cy - 3} Q ${cx - rx - 2} ${cy + 7} ${cx - rx + 1.5} ${cy + ry * 0.55}
           L ${cx - rx + 4} ${cy + ry * 0.5} Q ${cx - rx + 1} ${cy} ${cx - rx + 2} ${cy - 4} Z
           M ${cx + rx} ${cy - 3} Q ${cx + rx + 2} ${cy + 7} ${cx + rx - 1.5} ${cy + ry * 0.55}
           L ${cx + rx - 4} ${cy + ry * 0.5} Q ${cx + rx - 1} ${cy} ${cx + rx - 2} ${cy - 4} Z`}
        fill={hair}
      />,
    );
  }
  els.push(cap);

  if (style === "bun") {
    els.push(<circle key="bun" cx={cx} cy={crownY + 0.5} r={3.3} fill={hair} />);
    els.push(
      <path key="buntie" d={`M ${cx - 2} ${crownY + 3} h 4`} stroke={mix(hair, "#000000", 0.25)} strokeWidth={0.8} />,
    );
  }
  if (style === "curly" || style === "coily") {
    // scalloped texture along the hairline
    const bumps: El[] = [];
    for (let i = -2; i <= 2; i++) {
      bumps.push(
        <circle key={`b${i}`} cx={cx + i * (rx * 0.44)} cy={hairlineY + 0.6} r={2.1} fill={hair} />,
      );
    }
    els.push(<g key="tex">{bumps}</g>);
  }
  return els;
}

function headwearBehind(p: PatientProfile, m: Metrics, fabric: string): El | null {
  const { cx, cy, rx, ry } = m;
  if (p.appearance.headwear !== "hijab") return null;
  return (
    <path
      key="hj-b"
      d={`M ${cx - rx - 3} ${cy + 2}
         C ${cx - rx - 4} ${cy - ry - 4}, ${cx + rx + 4} ${cy - ry - 4}, ${cx + rx + 3} ${cy + 2}
         C ${cx + rx + 6} ${cy + 14}, ${cx + rx + 1} ${cy + 23}, ${cx + 8} ${cy + 24}
         L ${cx - 8} ${cy + 24}
         C ${cx - rx - 1} ${cy + 23}, ${cx - rx - 6} ${cy + 14}, ${cx - rx - 3} ${cy + 2} Z`}
      fill={fabric}
    />
  );
}

function headwearFront(p: PatientProfile, m: Metrics, fabric: string, hair: string): El[] {
  const { cx, cy, rx, ry } = m;
  const hw = p.appearance.headwear;
  const els: El[] = [];
  if (hw === "hijab") {
    els.push(
      <path
        key="hj-f"
        d={`M ${cx - rx - 1.5} ${cy + 0.5}
           C ${cx - rx - 1.5} ${cy - ry - 3}, ${cx + rx + 1.5} ${cy - ry - 3}, ${cx + rx + 1.5} ${cy + 0.5}
           L ${cx + rx - 1} ${cy + 0.5}
           C ${cx + rx - 1} ${cy - ry + 3}, ${cx - rx + 1} ${cy - ry + 3}, ${cx - rx + 1} ${cy + 0.5} Z`}
        fill={fabric}
      />,
    );
    els.push(
      <path
        key="hj-fold"
        d={`M ${cx - rx + 1} ${cy - 1} Q ${cx} ${cy - ry + 4} ${cx + rx - 1} ${cy - 1}`}
        stroke={mix(fabric, "#000000", 0.16)}
        strokeWidth={0.7}
        fill="none"
        opacity={0.7}
      />,
    );
  } else if (hw === "headscarf") {
    // scarf over the crown, a little hair shows at the front + a side knot
    els.push(
      <path
        key="hs"
        d={`M ${cx - rx - 0.5} ${cy - 1}
           C ${cx - rx - 2} ${cy - ry - 3}, ${cx + rx + 2} ${cy - ry - 3}, ${cx + rx + 0.5} ${cy - 1}
           C ${cx + rx - 3} ${cy - ry + 2.5}, ${cx - rx + 3} ${cy - ry + 2.5}, ${cx - rx - 0.5} ${cy - 1} Z`}
        fill={fabric}
      />,
    );
    els.push(
      <path
        key="hs-knot"
        d={`M ${cx + rx - 1} ${cy - 3} l 3 -1.5 l -0.5 3.5 Z`}
        fill={mix(fabric, "#000000", 0.1)}
      />,
    );
    // hint of hair at the front hairline
    els.push(
      <path
        key="hs-hair"
        d={`M ${cx - rx + 2} ${cy - 1.5} Q ${cx} ${cy - ry + 5.5} ${cx + rx - 2} ${cy - 1.5}`}
        stroke={hair}
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />,
    );
  } else if (hw === "cap") {
    els.push(
      <path
        key="cap-dome"
        d={`M ${cx - rx + 0.5} ${cy - 2}
           C ${cx - rx - 1} ${cy - ry - 3}, ${cx + rx + 1} ${cy - ry - 3}, ${cx + rx - 0.5} ${cy - 2} Z`}
        fill={fabric}
      />,
    );
    els.push(
      <path
        key="cap-brim"
        d={`M ${cx - rx + 1} ${cy - 2} Q ${cx - rx - 3} ${cy - 1} ${cx - rx - 4.5} ${cy + 0.5}
           L ${cx - rx + 1} ${cy - 0.5} Z`}
        fill={mix(fabric, "#000000", 0.18)}
      />,
    );
  }
  return els;
}

/* ========================================================================== */
/* Procedural avatar                                                           */
/* ========================================================================== */

function ProceduralAvatar({
  profile,
  signs,
  affect,
  ariaLabel,
}: {
  profile: PatientProfile;
  signs?: ClinicalSignIntensity[];
  affect?: AvatarAffect;
  ariaLabel: string;
}) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const faceClip = `acudx-face-${uid}`;

  useEffect(() => {
    ensureAvatarStyles();
  }, []);

  const m = metricsFor(profile);
  const skin = SKIN[profile.appearance.skinTone];
  const hair = HAIR[profile.appearance.hairColor];
  const fabric = FABRIC[hashSeed(profile.id) % FABRIC.length];
  const baseAffect = profile.baselineAffect;
  const femme = profile.genderPresentation === "femme";

  // Clinical-sign intensities.
  const cyanosis = sig(signs, "cyanosis");
  const pallor = sig(signs, "pallor");
  const diaphoresis = sig(signs, "diaphoresis");
  const resp = sig(signs, "respiratory-distress");
  const loc = sig(signs, "reduced-loc");
  const jaundice = sig(signs, "jaundice");
  const flush = sig(signs, "flushing");

  const params = computeAvatarMotion({
    affect: baseAffect,
    affectIntensity: affect?.intensity ?? 0.5,
    respiratoryDistress: resp,
    reducedLoc: loc,
    diaphoresis,
    reducedMotion: !!reduce,
  });
  const animate = params.enabled;
  const strength = 0.5 + 0.5 * (affect?.intensity ?? 0.5);

  // Lips + mouth expression.
  const baseLip = mix(skin.blush, "#7a3f36", 0.5);
  const lipColor = mix(baseLip, "#5f7cae", cyanosis * 0.9);
  const openMouth = resp > 0.35 || baseAffect === "distressed" || baseAffect === "drowsy";
  let curve = 0;
  switch (baseAffect) {
    case "calm": curve = 0.7; break;
    case "stoic": curve = 0.05; break;
    case "anxious": curve = -0.3; break;
    case "distressed": curve = -0.9; break;
    case "drowsy": curve = -0.15; break;
    case "irritable": curve = -0.7; break;
    case "tearful": curve = -1; break;
    default: curve = 0.2;
  }
  const hw = m.isChild ? 3 : 3.9;

  const showEars =
    !["hijab", "headscarf"].includes(profile.appearance.headwear) &&
    !["long", "coily"].includes(profile.appearance.headwear === "none" ? profile.appearance.hairStyle : "");

  // The CSS variables are always set: the resting-lid var keeps the eyes open
  // (or drooped) even when the animation classes are absent under reduced
  // motion; the duration vars are simply unused when their classes are off.
  const rootStyle = motionVars(params) as CSSProperties;

  const headGroup: El[] = [];

  // Ears
  if (showEars) {
    headGroup.push(
      <g key="ears">
        <ellipse cx={m.cx - m.rx + 0.4} cy={m.eyeCy + 0.6} rx={1.7} ry={2.5} fill={skin.base} />
        <ellipse cx={m.cx + m.rx - 0.4} cy={m.eyeCy + 0.6} rx={1.7} ry={2.5} fill={skin.base} />
        <ellipse cx={m.cx - m.rx + 0.6} cy={m.eyeCy + 0.6} rx={0.7} ry={1.3} fill={skin.shadow} opacity={0.7} />
        <ellipse cx={m.cx + m.rx - 0.6} cy={m.eyeCy + 0.6} rx={0.7} ry={1.3} fill={skin.shadow} opacity={0.7} />
      </g>,
    );
  }

  // Head + face shadow
  headGroup.push(
    <ellipse key="head" cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} fill={skin.base} />,
  );
  headGroup.push(
    <path
      key="faceshadow"
      d={`M ${m.cx + m.rx - 1} ${m.cy - m.ry + 6} A ${m.rx} ${m.ry} 0 0 1 ${m.cx + 2} ${m.cy + m.ry - 1} Q ${m.cx + m.rx - 3} ${m.cy} ${m.cx + m.rx - 1} ${m.cy - m.ry + 6} Z`}
      fill={skin.shadow}
      opacity={0.28}
    />,
  );

  // Hair + headwear on the crown. Draw order: hair first, then any headwear on
  // top of it (a cap sits on the hair; a scarf lets a bun peek above it).
  if (profile.appearance.headwear === "none" || profile.appearance.headwear === "cap") {
    hairFront(profile, m, hair).forEach((e) => headGroup.push(e));
  }
  if (profile.appearance.headwear === "headscarf" && profile.appearance.hairStyle === "bun") {
    headGroup.push(<circle key="bun-b" cx={m.cx} cy={m.cy - m.ry + 1} r={3} fill={hair} />);
  }
  headwearFront(profile, m, fabric, hair).forEach((e) => headGroup.push(e));

  // Cheeks: baseline blush (femme) then flushing, minus pallor
  const blushOp = (femme ? 0.2 : 0.08) * (1 - pallor * 0.8) + flush * 0.5;
  if (blushOp > 0.03) {
    const cheekColor = flush > 0.2 ? mix(skin.blush, "#df6a58", flush) : skin.blush;
    headGroup.push(
      <g key="cheeks" opacity={Math.min(0.7, blushOp)}>
        <ellipse cx={m.cx - m.rx * 0.55} cy={m.mouthY - 1.5} rx={2.6} ry={1.7} fill={cheekColor} />
        <ellipse cx={m.cx + m.rx * 0.55} cy={m.mouthY - 1.5} rx={2.6} ry={1.7} fill={cheekColor} />
      </g>,
    );
  }

  // Brows
  const browColor =
    profile.appearance.hairColor === "white"
      ? "#c4c7cc"
      : profile.appearance.hairColor === "gray"
        ? "#9a9ea3"
        : mix(hair, skin.shadow, 0.15);
  headGroup.push(
    <g key="brows" stroke={browColor} strokeWidth={m.isChild ? 1.1 : 1.35} strokeLinecap="round" fill="none">
      <path d={browPath(m.cx - m.eyeDx, m, baseAffect, strength)} />
      <path d={browPath(m.cx + m.eyeDx, m, baseAffect, strength)} />
    </g>,
  );

  // Eyes
  headGroup.push(
    <g key="eyeL">{eye(m.cx - m.eyeDx, m, skin, femme)}</g>,
    <g key="eyeR">{eye(m.cx + m.eyeDx, m, skin, femme)}</g>,
  );

  // Nose (+ nostril flare under respiratory distress)
  headGroup.push(
    <path
      key="nose"
      d={`M ${m.cx - 1.6} ${m.noseY - 1.5} Q ${m.cx} ${m.noseY + 1.2} ${m.cx + 1.6} ${m.noseY - 1.5}`}
      stroke={skin.shadow}
      strokeWidth={1}
      strokeLinecap="round"
      fill="none"
      opacity={0.75}
    />,
  );
  if (resp > 0.4) {
    headGroup.push(
      <g key="nostril" fill={skin.shadow} opacity={0.8}>
        <ellipse cx={m.cx - 1.4} cy={m.noseY + 0.3} rx={0.8} ry={0.55} />
        <ellipse cx={m.cx + 1.4} cy={m.noseY + 0.3} rx={0.8} ry={0.55} />
      </g>,
    );
  }

  // Mouth
  if (openMouth) {
    const openR = 1.3 + resp * 1.4 + (baseAffect === "distressed" ? 0.6 : 0);
    headGroup.push(
      <g key="mouth">
        <ellipse cx={m.cx} cy={m.mouthY + 0.4} rx={hw * 0.55} ry={openR} fill={mix(lipColor, "#361f1c", 0.55)} />
        <path
          d={`M ${m.cx - hw * 0.6} ${m.mouthY - openR + 0.3} Q ${m.cx} ${m.mouthY - openR - 0.6} ${m.cx + hw * 0.6} ${m.mouthY - openR + 0.3}`}
          stroke={lipColor}
          strokeWidth={1.2}
          strokeLinecap="round"
          fill="none"
        />
      </g>,
    );
  } else {
    headGroup.push(
      <path
        key="mouth"
        d={`M ${m.cx - hw} ${m.mouthY} Q ${m.cx} ${m.mouthY - curve * 2.2} ${m.cx + hw} ${m.mouthY}`}
        stroke={lipColor}
        strokeWidth={m.isChild ? 1.4 : 1.6}
        strokeLinecap="round"
        fill="none"
      />,
    );
  }

  // Facial hair (clipped to the lower face)
  const fh = profile.appearance.facialHair;
  if (fh !== "none" && !m.isChild) {
    const beardEls: El[] = [];
    if (fh === "beard" || fh === "stubble") {
      beardEls.push(
        <rect
          key="jaw"
          x={m.cx - m.rx - 2}
          y={m.noseY + 1}
          width={(m.rx + 2) * 2}
          height={m.ry + 4}
          fill={hair}
          opacity={fh === "stubble" ? 0.28 : 0.92}
        />,
      );
    }
    if (fh === "beard" || fh === "mustache") {
      beardEls.push(
        <path
          key="must"
          d={`M ${m.cx - 3.4} ${m.mouthY - 1.8} Q ${m.cx} ${m.mouthY - 0.4} ${m.cx + 3.4} ${m.mouthY - 1.8} Q ${m.cx} ${m.mouthY - 2.8} ${m.cx - 3.4} ${m.mouthY - 1.8} Z`}
          fill={hair}
          opacity={0.92}
        />,
      );
    }
    headGroup.push(
      <g key="facialhair" clipPath={`url(#${faceClip})`}>
        {beardEls}
      </g>,
    );
    // re-draw mouth over a full beard so lips stay visible
    if (fh === "beard" && !openMouth) {
      headGroup.push(
        <path
          key="mouth2"
          d={`M ${m.cx - hw * 0.8} ${m.mouthY} Q ${m.cx} ${m.mouthY - curve * 2.2} ${m.cx + hw * 0.8} ${m.mouthY}`}
          stroke={mix(lipColor, "#000000", 0.15)}
          strokeWidth={1.4}
          strokeLinecap="round"
          fill="none"
        />,
      );
    }
  }

  // Age lines (elderly)
  if (m.isElderly) {
    headGroup.push(
      <g key="age" stroke={skin.shadow} strokeWidth={0.6} fill="none" opacity={0.5} strokeLinecap="round">
        <path d={`M ${m.cx - 4} ${m.browY - 2.6} Q ${m.cx} ${m.browY - 3.4} ${m.cx + 4} ${m.browY - 2.6}`} />
        <path d={`M ${m.cx - 3} ${m.noseY + 1.5} Q ${m.cx - 3.6} ${m.mouthY - 1} ${m.cx - 2.4} ${m.mouthY + 0.4}`} />
        <path d={`M ${m.cx + 3} ${m.noseY + 1.5} Q ${m.cx + 3.6} ${m.mouthY - 1} ${m.cx + 2.4} ${m.mouthY + 0.4}`} />
      </g>,
    );
  }

  // Glasses
  if (profile.appearance.glasses) {
    const lx = m.cx - m.eyeDx;
    const rxE = m.cx + m.eyeDx;
    const lw = m.eyeRx + 1.9;
    const lh = m.eyeRy + 1.5;
    headGroup.push(
      <g key="glasses" stroke={GLASS} strokeWidth={1} fill="#ffffff" fillOpacity={0.05} strokeLinejoin="round">
        <rect x={lx - lw} y={m.eyeCy - lh} width={lw * 2} height={lh * 2} rx={1.7} />
        <rect x={rxE - lw} y={m.eyeCy - lh} width={lw * 2} height={lh * 2} rx={1.7} />
        <path d={`M ${lx + lw} ${m.eyeCy} H ${rxE - lw}`} fill="none" />
        <path d={`M ${lx - lw} ${m.eyeCy - 0.5} H ${m.cx - m.rx + 0.5}`} fill="none" />
        <path d={`M ${rxE + lw} ${m.eyeCy - 0.5} H ${m.cx + m.rx - 0.5}`} fill="none" />
      </g>,
    );
  }

  // Tear (tearful) — animated fall reuses the bead keyframe
  if (baseAffect === "tearful" && (affect?.intensity ?? 0.5) > 0.3) {
    headGroup.push(
      <path
        key="tear"
        className={animate ? "acudx-av__bead" : undefined}
        d={`M ${m.cx - m.eyeDx} ${m.eyeCy + m.eyeRy} q 1.1 1.4 0 2.8 q -1.1 -1.4 0 -2.8 Z`}
        fill="#8fd3f4"
        opacity={0.85}
      />,
    );
  }

  // ----- Clinical wash overlays (opacity carries intensity) ------------------
  const washes: El[] = [];
  if (pallor > 0.05) {
    washes.push(
      <ellipse key="pallor" cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} fill="#f5f8fb" opacity={pallor * 0.45} />,
    );
  }
  if (jaundice > 0.05) {
    washes.push(
      <ellipse key="jaundice" cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} fill="#e7c04a" opacity={jaundice * 0.4} />,
    );
  }
  if (cyanosis > 0.1) {
    washes.push(
      <ellipse
        key="cyan"
        cx={m.cx}
        cy={m.mouthY - 1}
        rx={m.rx * 0.7}
        ry={m.ry * 0.4}
        fill="#5f7cae"
        opacity={cyanosis * 0.3}
      />,
    );
  }

  // Diaphoresis: forehead sheen + falling beads
  const sweat: El[] = [];
  if (diaphoresis > 0.15) {
    sweat.push(
      <ellipse key="sheen" cx={m.cx} cy={m.browY - 1} rx={m.rx * 0.6} ry={2.4} fill="#ffffff" opacity={diaphoresis * 0.25} />,
    );
    sweat.push(
      <path
        key="bead1"
        className={animate ? "acudx-av__bead" : undefined}
        d={`M ${m.cx - m.rx + 3} ${m.cy - 4} q 1 1.4 0 2.6 q -1 -1.2 0 -2.6 Z`}
        fill="#8fd3f4"
        opacity={0.85}
      />,
    );
    sweat.push(
      <path
        key="bead2"
        className={animate ? "acudx-av__bead acudx-av__bead--2" : undefined}
        d={`M ${m.cx + m.rx - 3} ${m.cy - 6} q 0.9 1.2 0 2.4 q -0.9 -1.2 0 -2.4 Z`}
        fill="#8fd3f4"
        opacity={0.75}
      />,
    );
  }

  return (
    <svg
      viewBox="0 0 72 72"
      className="h-16 w-16 shrink-0"
      role="img"
      aria-label={ariaLabel}
      style={rootStyle}
    >
      <defs>
        <clipPath id={faceClip}>
          <ellipse cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} />
        </clipPath>
      </defs>
      <g className={animate ? "acudx-av acudx-av__sway" : "acudx-av"}>
        <g className={animate ? "acudx-av__breathe" : undefined}>
          {/* Gown / shoulders (build-scaled) */}
          <g className={animate ? "acudx-av__shoulders" : undefined}>
            <path
              d={`M ${m.cx - m.shoulderHalf} 72
                 C ${m.cx - m.shoulderHalf} 60, ${m.cx - m.shoulderHalf + 3} 54, ${m.cx} 53
                 C ${m.cx + m.shoulderHalf - 3} 54, ${m.cx + m.shoulderHalf} 60, ${m.cx + m.shoulderHalf} 72 Z`}
              fill={GOWN}
            />
            <path
              d={`M ${m.cx - 7} 55 L ${m.cx} 62 L ${m.cx + 7} 55 L ${m.cx + 7} 60 L ${m.cx} 67 L ${m.cx - 7} 60 Z`}
              fill={GOWN_FOLD}
              opacity={0.75}
            />
          </g>
          {/* Neck */}
          <rect x={m.cx - 4.6} y={m.cy + m.ry - 6} width={9.2} height={12} rx={4} fill={SKIN[profile.appearance.skinTone].base} />
          <rect x={m.cx - 4.6} y={m.cy + m.ry - 6} width={9.2} height={4} rx={3} fill={SKIN[profile.appearance.skinTone].shadow} opacity={0.4} />

          {/* Hair behind + headwear behind */}
          {headwearBehind(profile, m, fabric)}
          {hairBack(profile, m, hair)}

          {/* Head + face (tremor group only when tremor is active) */}
          <g className={animate && params.tremorAmplitude > 0 ? "acudx-av__tremor" : undefined}>
            {headGroup}
            {washes}
            {sweat}
          </g>
        </g>
      </g>
    </svg>
  );
}

/* ========================================================================== */
/* Legacy abstract portrait (fallback when no profile is provided)             */
/* ========================================================================== */

function LegacyPortrait({ caption, title }: { caption: string; title: string }) {
  return (
    <svg viewBox="0 0 72 72" className="h-16 w-16 shrink-0" role="img" aria-label={`${title}: ${caption}`}>
      <defs>
        <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c98f6f" />
          <stop offset="100%" stopColor="#b07a5c" />
        </linearGradient>
      </defs>
      <path d="M12 72c0-13 10.7-20 24-20s24 7 24 20" fill="#334155" />
      <path d="M22 56l14 9 14-9v6l-14 9-14-9z" fill="#1e293b" opacity="0.7" />
      <rect x="30" y="40" width="12" height="12" rx="5" fill="url(#skin)" />
      <ellipse cx="36" cy="28" rx="15" ry="17" fill="url(#skin)" />
      <path d="M21 24c0-9 7-15 15-15s15 6 15 15c-3-4-8-6-15-6s-12 2-15 6z" fill="#3f3a36" />
      <path d="M27 24.5c1.6-1.2 3.6-1.2 5 0" stroke="#5b4636" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M40 24.5c1.4-1.2 3.4-1.2 5 0" stroke="#5b4636" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <circle cx="30" cy="28.5" r="1.5" fill="#26201c" />
      <circle cx="42" cy="28.5" r="1.5" fill="#26201c" />
      <path d="M31 37c2 1.6 8 1.6 10 0" stroke="#7a4a3a" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M49 21c1.4 1.8 1.4 3.4 0 3.4s-1.4-1.6 0-3.4z" fill="#7dd3fc" opacity="0.85" />
      <path d="M23 20c1.2 1.6 1.2 3 0 3s-1.2-1.4 0-3z" fill="#7dd3fc" opacity="0.7" />
    </svg>
  );
}

/* ========================================================================== */
/* PatientPortrait — figure wrapper (identical layout for both renderers)      */
/* ========================================================================== */

/**
 * PatientPortrait — the monitor-panel portrait. With a `profile` it renders a
 * parametric procedural avatar whose skin tone, hair, headwear, build, affect,
 * and clinical-sign shading are all data-driven and gently animated (honoring
 * prefers-reduced-motion). Without a profile it renders the original abstract
 * portrait so existing callers keep their behaviour. The clinical meaning is
 * always carried by the visible caption text below, never by color alone.
 */
export function PatientPortrait({ caption, name, profile, signs, affect }: PatientPortraitProps) {
  const { t } = useTranslation();
  const ariaLabel = t("patient.avatar.alt", { name, state: caption });

  return (
    <figure
      className="rounded-control border p-3"
      style={{
        borderColor: "var(--monitor-border)",
        backgroundColor: "color-mix(in srgb, var(--monitor-fg) 4%, transparent)",
      }}
    >
      <div className="flex items-center gap-3">
        {profile ? (
          <ProceduralAvatar profile={profile} signs={signs} affect={affect} ariaLabel={ariaLabel} />
        ) : (
          <LegacyPortrait caption={caption} title={t("encounter.portrait.title")} />
        )}

        <div className="min-w-0">
          <p className="text-sm font-medium" style={{ color: "var(--monitor-fg)" }}>
            {name}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--monitor-dim)" }}>
            <span className="font-medium">{t("encounter.portrait.sign")}: </span>
            <span className="italic">{caption}</span>
          </p>
        </div>
      </div>
    </figure>
  );
}
