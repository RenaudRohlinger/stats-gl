# stats-gl v4.2 — Overhaul Plan

Goal: **the profiler should be invisible and the numbers should be right.**
Audit date: 2026-06-10, against three r184 internals (`Info.js`, `Backend.js`, `WebGPUTimestampQueryPool.js`, `Animation.js`, `QuadMesh.js`).

**Status: Phases 1–5 implemented (2026-06-10).** Repo tooling runs on Bun
(`bun install` / `bun run build`). Build green, logic verified by `bun run test`
(`scripts/smoke.mjs`, 14 checks: CPU single-count,
re-entrancy, begin-without-end, WebGL frame grouping/carry/pool/disjoint,
auto-resolve, VRAM feed, dispose unpatching). Items under **Future** remain open.

---

## Phase 1 — Timing correctness (the numbers must be right)

### 1.1 CPU double-count regression *(critical)*
- `endProfiling()` (`core.ts`) is not idempotent. `end()` adds begin→end, then `update()` adds begin→update **again** → native WebGL, three-WebGL, and native WebGPU report ~2× CPU.
- Regression from `6ead2d4` (perf.mark → performance.now migration): v3 cleared the start mark after measuring, making the second call ≈0.
- **Fix:** consume-on-end sentinel — `cpuStartTime = -1` after adding; `endProfiling` no-ops when sentinel.
- Bonus fix: worker main-thread path without `stats.begin()` showed *ms-since-page-load* in the CPU panel; with the sentinel it shows 0.

### 1.2 Auto-resolve Three.js WebGPU timestamps *(critical DX)*
- In three r167+, `info.render.timestamp` is **only** written by `renderer.resolveTimestampsAsync()`. stats-gl never calls it → README quick-start shows GPU=0 forever and three's 2048-query pool exhausts (warning spam + dead per-pass timestamp writes).
- **Fix:** after `processWebGPUTimestamps()`, fire-and-forget `renderer.resolveTimestampsAsync('render'/'compute')` when the method exists (gated by `trackGPU`/`trackCPT`). Three's pool dedupes via `pendingResolve`.
- Shared `processFrameTimings()` in core so `Stats` and `StatsProfiler` use identical logic (fixes `StatsProfiler` missing the `webgpuNative` resolve branch entirely → GPU=0 in native-WebGPU workers).

### 1.3 `trackTimestamp` feature gate
- Setting `backend.trackTimestamp = true` on an **already-initialized** renderer bypasses three's feature AND-gate → `createQuerySet` validation errors on devices without `timestamp-query`.
- **Fix:** after init, re-gate with `renderer.hasFeature('timestamp-query')`.

### 1.4 Re-entrant `renderer.render()` (CubeCamera, RT passes in onBeforeRender)
- Nested patched `render` → `begin()` ends the outer query and **orphans it** (GPU resource leak) and resets `cpuStartTime` (CPU corruption).
- **Fix:** depth counter — only the outermost begin/end pair measures; inner pairs no-op. WebGL `TIME_ELAPSED` can't nest anyway.

### 1.5 WebGL GPU query rewrite
Current `processGpuQueries()`: zeroes the total then sums whatever queries are ready → **0-dips** when none ready, **2× spikes** when two frames complete in one tick; `getParameter(GPU_DISJOINT_EXT)` per query per frame (sync round-trip); disjoint results trusted; `splice()` alloc per completion; create/delete query churn.
- Tag queries with a frame id (parallel arrays, in-place compaction, early break on first unavailable — GPU completes in order).
- Per-frame sums; report the **last completed frame** (carry previous value when nothing resolved — matches three's pool semantics).
- Hoist disjoint check; on disjoint, discard all pending queries (spec: results invalid).
- **Pool** `WebGLQuery` objects (reuse after read; delete only in dispose). Zero steady-state allocations + no driver churn.
- Cap pending queries as a safety bound.

### 1.6 Dead/broken code removal
- `updatePanel()` (main.ts): calls `Panel.update` with the old 5-arg signature → `toFixed(lastMax)` throws when max > 100. Unused. **Delete.**
- `lib/statsGLNode.ts` (`StatsGLCapture`): `quad.render(renderer, canvasTarget)` — `QuadMesh.render` ignores arg 2 → renders into the user's bound target and captures a blank canvas. Superseded by the addon. **Delete.**
- `updateCounter`, `beginTime`, `lastMin/lastMax/lastValue` dicts (replaced by per-panel state in Phase 3), `QueryInfo` wrapper.
- `init()` re-call guard (second call currently falls through to a bogus "Failed to initialize WebGL" error).

---

## Phase 2 — VRAM panel *(headline feature)*

Three r18x common `Info` tracks bytes live: `memory.total`, `texturesSize`, `attributesSize`, `indexAttributesSize`, `storageAttributesSize`, `indirectStorageAttributesSize`, `readbackBuffersSize`, `programsSize` + counts incl. `renderTargets`. Works for **WebGPURenderer on both backends** (webgpu + webgl-fallback). Reading is free.

- New option `trackVRAM` (default `false`). Panel created at init when `info.memory.total !== undefined` (feature detect = older three just gets no panel).
- New `PanelMemory extends Panel`: stores MB, renders adaptively (`512 MB`, `1.3 GB`), min–max in matching units.
- Feed `info.memory.total / 2^20` into `averageVram` each update; graph normalized to **running max** (windowed max is useless for a monotonic-ish metric).
- Breakdown tooltip via `canvas.title` at text cadence: textures/geometry/programs MB + texture/RT counts.
- `StatsData.vram?: number` so workers can forward it; `setData`/`getData` wired.
- Document caveats: estimated allocation, not driver VRAM; compressed textures count 1 byte in three (upstream PR opportunity); classic `WebGLRenderer` has counts only.

---

## Phase 3 — Panel pipeline perf + accuracy

- **Gate the math:** min/max/EMA/graphMax in `updatePanelComponents` run per frame but are consumed at 4–30 Hz. Move inside `shouldUpdateText/Graph`. (~90% of the work deleted at 60fps.)
- **Kill allocations:** `graph.slice(-samplesGraph)` per panel per frame (graph is already capped — pure waste); `Math.max(...spread)` → loop helpers `maxOf/minOf`; `String(panel.id)` keys → state lives on the `Panel` instance.
- **Real min:** `Math.min(Infinity, value)` in `Panel.update` is just `value`. Pass the true windowed min as a new optional 5th param (back-compat default = current behavior).
- **Time-consistent smoothing:** EMA currently per-frame (`0.7/0.3`) → framerate-dependent. Applying it inside the text gate makes it wall-clock-cadenced.
- **FPS de-dup:** `renderPanels` re-implements FPS with `shift()`; core `calculateFps()` (head pointer + compaction) already exists. Use it.
- **showPanel/minimal mode:** iterate a maintained `panels[]` list, not `dom.children` (children include the VSync overlay + texture row → broken cycle states). Worker panel insertion re-derives ids from array order.
- **VSync:** ring buffer + running sum/sumSq (O(1) mean/variance instead of 2×reduce over 120 entries/frame); relative stability threshold (σ/mean) instead of absolute 2 ms (too loose at 240 Hz); add 30/360/480 Hz; clear the overlay when detection is lost (currently shows stale Hz forever).
- **dispose() unpatching:** restore original `renderer.render` / `info.reset`; drop the no-op window resize listener (positions don't depend on viewport).

---

## Phase 4 — Texture capture overhaul (stop perturbing the thing we measure)

### WebGL
- Sync `readPixels` at 30 Hz = full pipeline stall on the app's context (the file header still says "PBO double-buffering"; the `_sourceId` param was designed for it).
- **Fix:** per-source PBO + `fenceSync`: blit → `readPixels` into PIXEL_PACK buffer → fence; next tick, if `clientWaitSync(0)` signaled → `getBufferSubData`. One tick latency, zero stall.

### WebGPU
- Shared preview texture + staging buffer force serial awaits; new bind group + `createView()` per capture; one submit per panel.
- **Fix:** per-panel staging buffers; **one** command encoder for all panels (blit pass + copy per panel, ordered); single submit; `Promise.all` the maps; bind group + view cached per source `GPUTexture` (WeakMap → auto-invalidates when three recreates the texture).

### Both
- **No ImageBitmap/ImageData churn on the main thread:** preview is captured at display size, so keep one persistent `ImageData` per panel, write rows (flip / un-pad) directly into it, `putImageData` at the letterbox offset. `ImageBitmap` stays only for worker transfer (and there, prefer `OffscreenCanvas.transferToImageBitmap()`).
- New `texturesPerSecond` option (default 10) — decouple readback cadence from `graphsPerSecond` (30).

### Addon (`addons/StatsGLNode.js`)
- Main thread: `panelCtx.drawImage(captureCanvas, …)` directly (sync, alloc-free) instead of `createImageBitmap`.
- Worker: `transferToImageBitmap()`.
- Pass a cached state object to `RendererUtils.resetRendererState(renderer, cache)` (bare call allocates per capture).
- Size the `CanvasTarget` to the panel aspect (90×48), not 90×90 (current square distorts, then letterboxes to 48×48).

---

## Phase 5 — Cleanups, docs, build

- Generic gradient derivation (darken fg) instead of hard-coded hex switch — custom panels get gradients too.
- `parseFloat(max.toFixed(d))` → numeric rounding.
- Export `StatsOptions` type; keep `AverageData`/`StatsData` shapes stable (public API).
- README: three-WebGPU quick-start note that timestamps auto-resolve (manual `resolveTimestampsAsync` no longer needed); VRAM section; `texturesPerSecond`; worker snippet `begin()` note.
- Verify: `bun run build` green (tsc + vite + rollup), demos reviewed by hand.

## Future (not this pass)
- Upgrade vite 4 → 6+: vite 4 doesn't watch `bun.lock`, so its dep-optimizer cache
  goes stale after dependency bumps (bit us: page silently ran three 0.182 after the
  0.184 upgrade until `node_modules/.vite` was deleted). Until then: `rm -rf
  node_modules/.vite` after any `bun install` that changes versions.
- `InspectorBase` integration (r180+; would replace `info.reset` patching and give per-pass GPU/CPU breakdowns via pool UIDs) — needs a three import, so it belongs in an addon.
- Native-WebGPU multi-pass timestamp pooling for `getTimestampWrites()` (currently: one pass per frame measured; documented).
- `stats.trackDevice(device)` — wrap `createBuffer/createTexture/destroy` for VRAM on raw WebGPU.
- Upstream three PR: real byte sizes for compressed textures in `Info._getTextureMemorySize` (currently 1 byte).
- DPR-change handling via `matchMedia` (panel backing stores go blurry after browser zoom).
