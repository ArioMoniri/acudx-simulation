/**
 * AcuDx — photoreal talking-head loops for the patient portraits.
 *
 * For each portrait id below we ship a short (~5s) silent, looping talking-head
 * clip generated once from the SAME synthetic face (subtle mouth movement + small
 * head motion + blinking, plain studio background). The Interview surface plays
 * this loop while the patient is speaking, so the visible patient actually talks
 * instead of a frozen still. Static + bundled: no runtime generation, air-gapped.
 *
 * These faces are synthetic people, not real individuals, and are always labelled
 * as such in the UI.
 */

/** Portrait ids that ship a photoreal talking-head loop under `patients/talk/`. */
export const TALK_VIDEO_IDS: ReadonlySet<string> = new Set<string>([
  "p01",
  "p02",
  "p03",
  "p04",
  "p05",
  "p06",
  "p07",
  "p08",
  "p09",
  "p10",
  "p11",
  "p12",
  "p13",
  "p14",
  "p15",
  "p16",
  "p17",
  "p19",
  "p22",
  "p23",
  "p24",
  "p25",
  "p26",
  "p27",
  "p28",
  "p29",
  "p30",
  "p31",
  "p32",
  "p33",
  "p34",
  "p35",
  "p36",
]);

/** Whether this portrait id ships a talking-head loop. */
export function hasTalkVideo(photoId: string): boolean {
  return TALK_VIDEO_IDS.has(photoId);
}

/** Resolve the bundled URL for a portrait's talking-head loop (respects base path). */
export function talkVideoUrl(photoId: string): string {
  return `${import.meta.env.BASE_URL}patients/talk/${photoId}.mp4`;
}
