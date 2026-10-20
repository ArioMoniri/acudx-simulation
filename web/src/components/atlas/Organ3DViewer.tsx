import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowsClockwise, CubeTransparent, Spinner } from "@phosphor-icons/react";
import type * as THREE from "three";

import { cn } from "@/lib/cn";
import type { AtlasOrgan } from "@/data/anatomyAtlas";

const GLB_URL = `${import.meta.env.BASE_URL}atlas/organs.glb`;

/** True when WebGL is being rasterised in software (no GPU behind it). */
function isSoftwareGl(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    return /swiftshader|llvmpipe|softpipe|software/i.test(name);
  } catch {
    return false;
  }
}

interface ThreeApp {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controls: any;
  organMeshes: Map<string, THREE.Mesh[]>;
  clipPlane: THREE.Plane;
  raf: number;
  dispose: () => void;
}

/** Match a loaded node to an atlas organ id (node names come from the GLB). */
function organIdOf(name: string, ids: string[]): string | null {
  const n = name.toLowerCase();
  return ids.find((id) => n === id || n.startsWith(id) || n.includes(id)) ?? null;
}

/**
 * Organ3DViewer — a navigable 3D model of the abdominal organs, built (offline,
 * marching cubes) from the SAME expert-segmented CT the 2D cross-sections use,
 * so the 3D anatomy matches the slices. Never generated.
 *
 * Orbit to rotate, scroll to zoom, drag to pan; toggle organs from the shared
 * legend; optionally spin, or slice the model with an axial cutting plane to see
 * the cross-section in 3D. three.js is imported lazily (only when this mounts),
 * so it never touches the rest of the app's bundle. Degrades to a clear message
 * where WebGL is unavailable.
 */
export function Organ3DViewer({
  organs,
  visibleOrgans,
  activeOrgan,
  className,
}: {
  organs: AtlasOrgan[];
  visibleOrgans: Set<string>;
  activeOrgan: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<ThreeApp | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  const [spin, setSpin] = useState(false);
  const [cutOn, setCutOn] = useState(false);
  const [cutLevel, setCutLevel] = useState(0); // mm along the S–I (Z) axis
  const [cutRange, setCutRange] = useState<[number, number]>([-50, 50]);

  // Keep the latest visibility/highlight in refs so the async init and the
  // per-frame loop read current values without re-initialising the scene.
  const visRef = useRef(visibleOrgans);
  visRef.current = visibleOrgans;
  const activeRef = useRef(activeOrgan);
  activeRef.current = activeOrgan;
  const organIds = organs.map((o) => o.id);

  /* ----- one-time scene setup (lazy-loads three) ----- */
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      let THREEmod: typeof THREE;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let GLTFLoader: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let OrbitControls: any;
      try {
        THREEmod = await import("three");
        ({ GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js"));
        ({ OrbitControls } = await import("three/addons/controls/OrbitControls.js"));
      } catch {
        if (!cancelled) setPhase("error");
        return;
      }
      if (cancelled) return;
      const T = THREEmod;

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        if (!cancelled) setPhase("error");
        return;
      }
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 460;
      // Adaptive quality: a software GL (SwiftShader / llvmpipe, i.e. a VM,
      // remote desktop or a browser without GPU access) rasterises every pixel
      // on the CPU, so the view renders at half resolution there and stays
      // interactive; a real GPU keeps the device pixel ratio (capped at 2).
      renderer.setPixelRatio(
        isSoftwareGl(renderer) ? 0.5 : Math.min(window.devicePixelRatio || 1, 2),
      );
      renderer.setSize(w, h);
      renderer.localClippingEnabled = true;
      container.appendChild(renderer.domElement);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.touchAction = "none";

      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(42, w / h, 1, 6000);

      // Lighting: a soft hemisphere fill + two directionals so organs read.
      scene.add(new T.HemisphereLight(0xffffff, 0x334155, 1.05));
      const key = new T.DirectionalLight(0xffffff, 1.1);
      key.position.set(1, 1, 1.4);
      scene.add(key);
      const rim = new T.DirectionalLight(0x93c5fd, 0.5);
      rim.position.set(-1, -0.6, -1);
      scene.add(rim);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.9;

      const CLIP_PARKED = 1e7;
      const clipPlane = new T.Plane(new T.Vector3(0, 0, -1), CLIP_PARKED);

      const organMeshes = new Map<string, THREE.Mesh[]>();

      const loader = new GLTFLoader();
      loader.load(
        GLB_URL,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gltf: any) => {
          if (cancelled) return;
          const root = gltf.scene as THREE.Object3D;
          root.traverse((obj: THREE.Object3D) => {
            const mesh = obj as THREE.Mesh;
            if (!(mesh as { isMesh?: boolean }).isMesh) return;
            const id =
              organIdOf(obj.name, organIds) ||
              organIdOf(obj.parent?.name ?? "", organIds) ||
              organIdOf((mesh.material as { name?: string })?.name ?? "", organIds);
            const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
            for (const m of mats) {
              (m as THREE.Material & { side: THREE.Side }).side = T.DoubleSide;
              // Every material carries the clip plane from the start; the cut is
              // switched by moving the plane, never by adding / removing planes,
              // because a change in plane count recompiles every shader.
              (m as THREE.Material & { clippingPlanes: THREE.Plane[] }).clippingPlanes = [clipPlane];
            }
            if (id) {
              const arr = organMeshes.get(id) ?? [];
              arr.push(mesh);
              organMeshes.set(id, arr);
            }
          });
          scene.add(root);

          // Frame the model.
          const box = new T.Box3().setFromObject(root);
          const size = box.getSize(new T.Vector3());
          const center = box.getCenter(new T.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 200;
          controls.target.copy(center);
          camera.position.set(center.x + maxDim * 1.1, center.y - maxDim * 1.25, center.z + maxDim * 1.1);
          camera.near = maxDim / 100;
          camera.far = maxDim * 40;
          camera.updateProjectionMatrix();
          controls.update();

          if (!cancelled) {
            const zmin = box.min.z;
            const zmax = box.max.z;
            setCutRange([Math.floor(zmin), Math.ceil(zmax)]);
            setCutLevel(Math.round((zmin + zmax) / 2));
            applyVisibility();
            setPhase("ready");
          }
        },
        undefined,
        () => {
          if (!cancelled) setPhase("error");
        },
      );

      /** Apply the shared organ visibility + active-organ emphasis. */
      function applyVisibility() {
        const vis = visRef.current;
        const active = activeRef.current;
        for (const [id, meshes] of organMeshes) {
          const show = vis.has(id);
          for (const mesh of meshes) {
            mesh.visible = show;
            const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Array<
              THREE.Material & { opacity: number; transparent: boolean; depthWrite: boolean }
            >;
            for (const m of mats) {
              // Dim non-active organs when one is focused; otherwise keep the
              // organ's own (possibly translucent, e.g. lungs) look.
              const dim = active != null && active !== id;
              const base = id === "lungs" ? 0.35 : 1;
              // Opacity, transparency and depth write are plain uniforms /
              // render state: no needsUpdate, which would recompile each
              // material's program on every toggle (seconds on a software GL).
              m.opacity = dim ? Math.min(base, 0.12) : base;
              m.transparent = m.opacity < 1;
              m.depthWrite = m.opacity >= 0.95;
            }
          }
        }
      }

      /**
       * Enable/disable the axial cut. The plane stays attached to every
       * material (see the loader); "off" parks it far above the model so
       * nothing is clipped and no shader is recompiled.
       */
      function applyClip(on: boolean, levelMm: number) {
        clipPlane.constant = on ? levelMm : CLIP_PARKED;
      }

      // Render on demand, not every frame: a frame is drawn only after the
      // controls moved (drag, damping, auto-rotate), the visibility / clip plane
      // changed, or the canvas resized. A static model costs no GPU (or, in a
      // software-rendered CI browser, CPU) time, which keeps the rest of the
      // Atlas page responsive once the 3D view is open.
      let raf = 0;
      let needsRender = true;
      const requestRender = () => {
        needsRender = true;
      };
      controls.addEventListener("change", requestRender);
      // Spin (auto-rotate) only animates while the canvas is actually on screen
      // and the tab is visible: scrolled past the viewer, the loop idles instead
      // of drawing frames nobody sees (battery on phones, and on a software GL
      // a frame costs hundreds of ms that would starve the rest of the page).
      let inView = true;
      const io =
        typeof IntersectionObserver !== "undefined"
          ? new IntersectionObserver((entries) => {
              inView = entries.some((e) => e.isIntersecting);
              if (inView) requestRender();
            })
          : null;
      io?.observe(container);
      const tick = () => {
        raf = requestAnimationFrame(tick);
        if (!inView || document.visibilityState === "hidden") return;
        // Emits "change" while damping or auto-rotating, which requests a frame.
        controls.update();
        if (!needsRender) return;
        needsRender = false;
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(tick);

      const onResize = () => {
        const cw = container.clientWidth || w;
        const ch = container.clientHeight || h;
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
        renderer.setSize(cw, ch);
        requestRender();
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(container);

      const dispose = () => {
        cancelAnimationFrame(appRef.current?.raf ?? raf);
        ro.disconnect();
        io?.disconnect();
        controls.removeEventListener("change", requestRender);
        controls.dispose();
        scene.traverse((obj: THREE.Object3D) => {
          const mesh = obj as THREE.Mesh;
          if ((mesh as { isMesh?: boolean }).isMesh) {
            mesh.geometry?.dispose();
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) (m as THREE.Material)?.dispose();
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
      };

      appRef.current = {
        renderer,
        scene,
        camera,
        controls,
        organMeshes,
        clipPlane,
        raf,
        dispose,
        // expose the two updaters via closure on the app object
        ...({
          applyVisibility: () => {
            applyVisibility();
            requestRender();
          },
          applyClip: (on: boolean, levelMm: number) => {
            applyClip(on, levelMm);
            requestRender();
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      } as ThreeApp;
    })();

    return () => {
      cancelled = true;
      appRef.current?.dispose();
      appRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- react to shared visibility / highlight ----- */
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (appRef.current as any)?.applyVisibility?.();
  }, [visibleOrgans, activeOrgan, phase]);

  /* ----- react to the cutting plane ----- */
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (appRef.current as any)?.applyClip?.(cutOn, cutLevel);
  }, [cutOn, cutLevel, phase]);

  /* ----- spin (auto-rotate) ----- */
  useEffect(() => {
    const c = appRef.current?.controls;
    if (c) {
      c.autoRotate = spin;
      c.autoRotateSpeed = 1.6;
    }
  }, [spin, phase]);

  const resetView = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = appRef.current as any;
    if (!app) return;
    app.controls.reset?.();
  };

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-card border bg-monitor-bg text-monitor-fg border-monitor-border shadow-soft-md",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-monitor-border px-3 py-2">
        <CubeTransparent weight="duotone" className="h-4 w-4 shrink-0 text-monitor-online" aria-hidden />
        <span className="truncate font-mono text-xs uppercase tracking-wide text-monitor-fg">
          {t("atlas.threeD.title", { defaultValue: "3D organs" })}
        </span>
        <span className="ms-auto inline-flex items-center gap-1 rounded-chip bg-[color-mix(in_srgb,var(--monitor-fg)_8%,transparent)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-monitor-dim">
          {t("imaging2.disclaimerShort", { defaultValue: "Representative" })}
        </span>
      </div>

      <div className="relative bg-monitor-bg">
        <div ref={containerRef} className="h-[26rem] w-full sm:h-[30rem]" aria-hidden={phase !== "ready"} />

        {phase === "loading" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-monitor-dim">
            <Spinner weight="bold" className="h-6 w-6 animate-spin" aria-hidden />
            <p className="font-mono text-xs">{t("atlas.threeD.loading", { defaultValue: "Loading 3D model…" })}</p>
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center text-monitor-dim">
            <p className="font-mono text-xs text-monitor-fg">
              {t("atlas.threeD.unsupported", { defaultValue: "3D view needs WebGL" })}
            </p>
            <p className="max-w-xs font-mono text-[11px]">
              {t("atlas.threeD.unsupportedHint", {
                defaultValue: "Use the cross-section view instead — the anatomy is the same data.",
              })}
            </p>
          </div>
        ) : null}

        {/* Controls overlay */}
        {phase === "ready" ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 bg-[color-mix(in_srgb,var(--monitor-bg)_78%,transparent)] px-3 py-2">
            <button
              type="button"
              onClick={() => setSpin((s) => !s)}
              aria-pressed={spin}
              className={cn(
                "pointer-events-auto inline-flex items-center gap-1 rounded-chip px-2 py-1 font-mono text-[11px] transition-colors",
                spin ? "bg-monitor-online text-monitor-bg" : "bg-[color-mix(in_srgb,var(--monitor-fg)_10%,transparent)] text-monitor-dim hover:text-monitor-fg",
              )}
            >
              <ArrowsClockwise weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("atlas.threeD.spin", { defaultValue: "Spin" })}
            </button>
            <button
              type="button"
              onClick={() => setCutOn((c) => !c)}
              aria-pressed={cutOn}
              className={cn(
                "pointer-events-auto inline-flex items-center gap-1 rounded-chip px-2 py-1 font-mono text-[11px] transition-colors",
                cutOn ? "bg-monitor-online text-monitor-bg" : "bg-[color-mix(in_srgb,var(--monitor-fg)_10%,transparent)] text-monitor-dim hover:text-monitor-fg",
              )}
            >
              <CubeTransparent weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("atlas.threeD.cut", { defaultValue: "Axial cut" })}
            </button>
            {cutOn ? (
              <input
                type="range"
                min={cutRange[0]}
                max={cutRange[1]}
                value={cutLevel}
                onChange={(e) => setCutLevel(Number(e.target.value))}
                aria-label={t("atlas.threeD.cutLevel", { defaultValue: "Cut level" })}
                className="pointer-events-auto h-1 min-w-[6rem] flex-1 cursor-pointer accent-monitor-online"
              />
            ) : null}
            <button
              type="button"
              onClick={resetView}
              className="pointer-events-auto ms-auto inline-flex items-center gap-1 rounded-chip bg-[color-mix(in_srgb,var(--monitor-fg)_10%,transparent)] px-2 py-1 font-mono text-[11px] text-monitor-dim transition-colors hover:text-monitor-fg"
            >
              <ArrowsClockwise weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("atlas.threeD.reset", { defaultValue: "Reset view" })}
            </button>
          </div>
        ) : null}
      </div>

      <figcaption className="space-y-1 border-t border-monitor-border px-3 py-2 font-mono text-[11px] text-monitor-dim">
        <p>{t("atlas.threeD.hint", { defaultValue: "Drag to rotate · scroll to zoom · toggle organs in the legend" })}</p>
        <p>
          <span className="text-monitor-dim">{t("imaging2.license", { defaultValue: "License" })}:</span>{" "}
          <span className="text-monitor-fg">CC BY 4.0</span> ·{" "}
          <span className="text-monitor-fg">Wasserthal et al. (TotalSegmentator)</span>
        </p>
      </figcaption>
    </figure>
  );
}
