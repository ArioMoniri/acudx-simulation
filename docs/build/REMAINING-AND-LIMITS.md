# AcuDx — Remaining work, data needs & honest limits

A living checklist of what was requested, what's done, what still needs **more
data / external resources / your action** to finish, and what is a genuine
limitation. Come back to this to continue. Last updated: 2026-09-13.

---

## 🔑 1. Needs YOU — Supabase auth (the only hard blocker)

Real accounts, **email verification**, saved profiles, and **server-verified
roles** need a publicly-reachable backend. The pod can't be one (its outbound
network is firewalled), so we use **Supabase** (managed Postgres + Auth). It's
free to start. Steps:

1. Go to **https://supabase.com** → sign in (GitHub or email) → **New project**.
2. Pick your org, name it `acudx`, set a **database password** (save it — you
   keep it, I never need it), choose the **nearest region**, **Free** plan →
   **Create project** (~2 min to provision).
3. Left sidebar → **⚙ Project Settings → API**. Copy **two** values:
   - **Project URL** — e.g. `https://abcdefgh.supabase.co`
   - **anon public** key — the long `eyJ…` string in *Project API keys* labelled
     **`anon` `public`**. (Newer projects call it the **Publishable** key — same
     thing.) ⚠️ **Never** the `service_role` / secret key.
4. Give them to me, or create `web/.env.local` (gitignored — never committed):
   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```
5. (Email verification is ON by default under **Authentication → Providers →
   Email**; for high volume later, point it at your own SMTP.)

Once those land I build: sign-up → email-verify → sign-in → persisted profile,
a `profiles` table with **row-level security**, and roles become a
**server-verified permission** feeding the `profile.role` gating already in the
app (routes/nav/authoring/institution). This also retires the local
"Dr. Test User" placeholder.

---

## 🧩 2. Built, but would improve with MORE DATA / resources

These work now; the note says what unlocks the next level.

- **Anatomy atlas (the Japanese-reference cross-section viewer).** v1 ships a
  **real, expert-segmented CT** (TotalSegmentator example, CC-BY-4.0): 14 organs
  with toggleable SVG segmentation overlays, axial/coronal/sagittal, level
  scrubber, abdomen/bone windows, R/L/A/P/S/I markers, guided lessons.
  - *Needs more data to grow:* more subjects + full-body coverage (only ~90 mm
    of one subject now), an **MRI** lesson (source: AMOS22, CC-BY), and the
    **3D organ model** with a cutting plane synced to the slice (source: HuBMAP
    CCF GLBs, CC-BY-4.0) — this is the 3D part of the reference, deferred to a
    later phase. Pipeline lives in `data/atlas-pipeline/` (`build_atlas.py`);
    edit `ORGANS`/`LEVELS_PER_PLANE` and re-run to expand.

- **Model-driven / dynamic test results.** Results respond to the patient's
  status, elapsed time, and what the student does (treat in time → improves;
  delay → deteriorates), via a **deterministic, medically-bounded** clinical
  engine — see the limit note below on why numbers are NOT LLM-generated.
  - *Could improve:* a pod-generated **narrative/impression** layer (text only,
    numbers stay bounded) for richer, question-aware read-outs.

- **Catalog completeness (tests + imaging).** Expanded to the common ED studies.
  Ordered **US / echo / MRI** (and normal-read CT head) now show **real,
  curated, open-licensed** representative images — 11 verified Commons studies
  (normal echo, normal abdominal US, cholelithiasis, hydronephrosis, AAA, normal
  brain MRI, DWI stroke, lumbar-spine MRI, cervical-spine MRI, MRCP, normal head
  CT), matching the ECG/CXR/CT bank; the key fix is that a **NORMAL read** now
  resolves (it is queried as literally `"normal <study>"`), which is what left
  the echo blank before.
  - *Residual imaging gaps (next):* curated **normal chest / abdominal CT**,
    **normal AXR**, and an **extremity X-ray / fracture** set; and US/MRI
    *pathology* beyond the curated stills (DVT clot, FAST free fluid, ectopic,
    cord compression, ductal stone) still fall to the live web-search fallback.

- **Interview panel UX.** Scrolling, Q&A layout, and profile-photo panel
  polished to the AMBOSS/Epic language.

---

## ⚠️ 3. Honest limits (can't be faked well — by design)

- **Generated CT / MRI / ECG / echo are NOT anatomically or diagnostically
  accurate.** Image/3D generators invent anatomy, get L/R + slice geometry
  wrong, and fabricate ECG morphology. For a tool whose value is reading the
  *real* thing, that's actively miseducating. → We use **real, curated,
  open-licensed** data with verified provenance (imaging bank + the atlas), and
  will only ever *generate* non-diagnostic assets (patient portraits).

- **True per-word lip-sync on the patient video** needs a real-time talking-head
  avatar model — it can't come from a fixed pre-generated clip and can't run on
  the (CPU, air-gapped) pod. What we do instead (shipped, #165): **sync the
  clip's play duration to the actual spoken (ElevenLabs) audio** so the patient
  "talks" for exactly as long as the reply lasts, and no longer loops. Per-word
  sync remains the genuine limit.

- **Symptoms baked into the still photo.** The generated portrait is a fixed
  image and can't be re-rendered per-symptom. Live symptoms are shown instead
  via **CSS animation from t0** (breathing rate tied to RR, sweat sheen, pallor /
  cyanosis / fever tint, tremor, reduced-LOC droop) over the photo *and* the talk
  video — which is reactive and medically honest.

---

## 🌐 4. Infra still blocked (needs your hosting, not fakeable)

- **Public gateway hosting + internet-scale multiplayer** — the pod firewalls
  outbound tunnels, so it can't be publicly reachable. Needs a public host (or
  opening the pod's egress). Multiplayer works locally on the LAN today.
- **Native-clinician review** of the 12 machine-translated languages.
- **CI is billing-blocked** on the GitHub account (payments failed) → merges are
  gated locally (`tsc && vite build` + vitest) and admin-merged. Fix billing to
  restore CI on PRs.

---

## ✅ 5. Done this arc (for reference)

Interview live path + `/api` dev proxy · unlimited case generation · vitals
realtime + cross-panel + calm monitor · dynamic guidance + correct citations +
guidance-off gating · ElevenLabs **voice** + **mic (STT)** · live symptom
animation · orderable catalog fixes · real curated ECG/CXR/CT imaging ·
full **AMBOSS/Epic redesign** (shell, A&P, all encounter tabs, nav preload) ·
real role permissions + publish→learner wiring · dev/prototype "tells" removed ·
de-hardcoded config. See git history / PRs #135–#156.

Latest arc (#158–#165): **anatomy atlas** — real segmented-CT cross-section
viewer at `/atlas` (#161) · **catalog completeness + action/time-responsive
dynamic results** (#162) · **interview panel UX** — scrolling Q&A, chat bubbles,
portrait (#163) · **patient voice ↔ talking-head sync** — the talk clip matches
the real audio length instead of looping (#165).
