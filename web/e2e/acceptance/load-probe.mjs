// D-26 probe: which request holds the `load` event? Not a test; run by hand:
//   node web/e2e/acceptance/load-probe.mjs http://localhost:4201/signin
/* global process, console, localStorage */
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:4193/signin";
const browser = await chromium.launch();
const page = await browser.newPage();
if (process.argv[3] === "--profile") {
  // A signed-in local learner, as after step S1 of the acceptance walk.
  await page.addInitScript(() => {
    localStorage.setItem("acudx-profile", JSON.stringify({
      active: true,
      profile: { fullName: "Probe Learner", role: "student", institution: "Probe", language: "en", avatarSeed: "p",
        roles: ["student"], createdAt: new Date().toISOString(), onboarded: true, localId: "probe", verified: false },
    }));
  });
}
const pending = new Map();
page.on("request", (r) => pending.set(r, Date.now()));
page.on("requestfinished", (r) => pending.delete(r));
page.on("requestfailed", (r) => pending.delete(r));
const t0 = Date.now();
let loaded = false;
page.once("load", () => {
  loaded = true;
  console.log(`load after ${Date.now() - t0} ms`);
});
await page.goto(url, { waitUntil: "domcontentloaded" });
console.log(`domcontentloaded after ${Date.now() - t0} ms`);
await page.waitForTimeout(12_000);
if (!loaded) console.log("load NOT reached after 12 s");
for (const [r, at] of pending) console.log(`pending ${Date.now() - at} ms  ${r.resourceType()}  ${r.url()}`);
await browser.close();
