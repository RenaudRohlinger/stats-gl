// Smoke test for core timing logic (no browser needed). Runs on Bun or Node.
// Run: bun run test   (or: bun ./scripts/smoke.mjs / node ./scripts/smoke.mjs)
// Requires a fresh build first (tests run against dist/).
import { StatsProfiler } from '../dist/main.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

function busyWait(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* spin */ }
}

// --- 1. CPU sentinel: end() + update() must not double-count -----------------
{
  const p = new StatsProfiler();
  p.begin();
  busyWait(10);
  p.end();      // adds ~10ms
  busyWait(10); // gap between end and update must NOT be counted
  p.update();   // endProfiling again - must be a no-op
  const cpu = p.getData().cpu;
  check('cpu single-count (~10ms, not ~20ms)', cpu > 8 && cpu < 15, `got ${cpu.toFixed(2)}ms`);
  p.dispose();
}

// --- 2. Re-entrant begin/end: only the outermost pair measures ---------------
{
  const p = new StatsProfiler();
  p.begin();        // outer
  busyWait(5);
  p.begin();        // inner (e.g. CubeCamera render) - must not reset the clock
  busyWait(5);
  p.end();          // inner
  busyWait(5);
  p.end();          // outer - adds ~15ms total
  p.update();
  const cpu = p.getData().cpu;
  check('re-entrant pairs measure outermost span (~15ms)', cpu > 12 && cpu < 22, `got ${cpu.toFixed(2)}ms`);
  p.dispose();
}

// --- 3. begin() without end() (worker main-thread pattern) -------------------
{
  const p = new StatsProfiler();
  for (let i = 0; i < 3; i++) {
    p.begin();
    busyWait(6);
    p.update(); // frame boundary resets depth; endProfiling consumes
  }
  const cpu = p.getData().cpu;
  check('begin-without-end keeps measuring every frame', cpu > 4 && cpu < 12, `got ${cpu.toFixed(2)}ms`);
  p.dispose();
}

// --- 4. No begin() at all: CPU must be 0, not time-since-epoch ---------------
{
  const p = new StatsProfiler();
  p.update();
  const cpu = p.getData().cpu;
  check('no begin() reports 0 cpu', cpu === 0, `got ${cpu}`);
  p.dispose();
}

// --- 5. WebGL query processing: frame grouping, no zero dips, disjoint -------
{
  // Minimal EXT_disjoint_timer_query_webgl2 stub
  const QUERY_RESULT_AVAILABLE = 0x8867;
  const QUERY_RESULT = 0x8866;
  let nextQueryId = 1;
  const available = new Map(); // query id -> { ready, elapsedNs }
  const glStub = {
    QUERY_RESULT_AVAILABLE,
    QUERY_RESULT,
    disjoint: false,
    createQuery: () => ({ id: nextQueryId++ }),
    deleteQuery: () => {},
    beginQuery: () => {},
    endQuery: () => {},
    getQueryParameter: (q, pname) => {
      const state = available.get(q.id) || { ready: false, elapsedNs: 0 };
      return pname === QUERY_RESULT_AVAILABLE ? state.ready : state.elapsedNs;
    },
    getParameter: () => glStub.disjoint
  };
  const extStub = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };

  const p = new StatsProfiler({ trackGPU: true });
  p.gl = glStub;
  p.ext = extStub;

  // Frame A: two render calls (4ms + 2ms)
  p.begin(); p.end();
  p.begin(); p.end();
  const [qA1, qA2] = p.gpuQueries;
  p.update(); // nothing available yet -> keeps last value (0), frameId advances

  // Frame B: one render call (8ms)
  p.begin(); p.end();
  const qB1 = p.gpuQueries[2];
  p.update();

  // Now frame A results arrive together with frame B's
  available.set(qA1.id, { ready: true, elapsedNs: 4e6 });
  available.set(qA2.id, { ready: true, elapsedNs: 2e6 });
  available.set(qB1.id, { ready: true, elapsedNs: 8e6 });
  p.update();
  const gpu = p.getData().gpu;
  check('multi-frame drain reports last frame (8ms), not sum (14ms)', Math.abs(gpu - 8) < 0.01, `got ${gpu}`);

  // Next tick with no new results: value carried, no zero dip
  p.update();
  check('no new results carries last value (no 0 dip)', Math.abs(p.getData().gpu - 8) < 0.01, `got ${p.getData().gpu}`);

  // Queries are pooled, not deleted
  check('queries recycled into pool', p.queryPool.length === 3, `pool=${p.queryPool.length}`);

  // Disjoint discards in-flight queries and keeps the last value
  p.begin(); p.end();
  glStub.disjoint = true;
  p.update();
  check('disjoint discards pending and keeps value', p.gpuQueries.length === 0 && Math.abs(p.getData().gpu - 8) < 0.01,
    `pending=${p.gpuQueries.length} gpu=${p.getData().gpu}`);
  glStub.disjoint = false;
  p.dispose();
}

// --- 6. Three-WebGPU auto-resolve + VRAM feed --------------------------------
{
  let renderResolves = 0;
  let computeResolves = 0;
  const p = new StatsProfiler({ trackGPU: true, trackCPT: true, trackVRAM: true });
  p.info = {
    render: { timestamp: 3.5 },
    compute: { timestamp: 1.25 },
    memory: { geometries: 2, textures: 4, total: 256 * 1024 * 1024 }
  };
  p.renderer = {
    resolveTimestampsAsync: async (type) => {
      if (type === 'render') renderResolves++;
      else if (type === 'compute') computeResolves++;
      return 0;
    }
  };
  p.vramSupported = true;

  p.begin(); p.end(); p.update();
  const data = p.getData();
  check('reads info.render.timestamp', data.gpu === 3.5, `got ${data.gpu}`);
  check('reads info.compute.timestamp', data.gpuCompute === 1.25, `got ${data.gpuCompute}`);
  check('auto-resolves render+compute timestamps', renderResolves === 1 && computeResolves === 1,
    `render=${renderResolves} compute=${computeResolves}`);
  check('vram tracked in MB', data.vram === 256, `got ${data.vram}`);
  p.dispose();
}

// --- 7. dispose() restores patched renderer methods --------------------------
{
  const original = function render() {};
  const fakeThree = { isWebGLRenderer: true, render: original, getContext: () => null };
  const p = new StatsProfiler();
  await p.init(fakeThree);
  check('render patched on init', fakeThree.render !== original);
  p.dispose();
  check('render restored on dispose', fakeThree.render === original);
}

console.log(failures === 0 ? '\nAll smoke tests passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
