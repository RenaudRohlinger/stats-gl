export interface StatsCoreOptions {
  trackGPU?: boolean;
  trackCPT?: boolean;
  trackHz?: boolean;
  trackFPS?: boolean;
  trackVRAM?: boolean;
  logsPerSecond?: number;
  graphsPerSecond?: number;
  samplesLog?: number;
  samplesGraph?: number;
  precision?: number;
}

export interface AverageData {
  logs: number[];
  graph: number[];
}

/**
 * Subset of three's common Info.memory (r18x+). Byte fields only exist on
 * WebGPURenderer (both backends); the classic WebGLRenderer exposes counts only.
 */
export interface InfoMemoryData {
  geometries: number;
  textures: number;
  renderTargets?: number;
  programs?: number;
  total?: number;
  texturesSize?: number;
  attributesSize?: number;
  indexAttributesSize?: number;
  storageAttributesSize?: number;
  indirectStorageAttributesSize?: number;
  readbackBuffersSize?: number;
  programsSize?: number;
}

export interface InfoData {
  render: {
    timestamp: number;
  };
  compute: {
    timestamp: number;
  };
  memory?: InfoMemoryData;
}

export interface StatsData {
  fps: number;
  cpu: number;
  gpu: number;
  gpuCompute: number;
  vram?: number;
  isWorker?: boolean;
}

// Safety bound for in-flight WebGL timer queries (results that never arrive)
const MAX_PENDING_QUERIES = 128;

// Bytes to mebibytes
export const BYTES_TO_MB = 1 / (1024 * 1024);

export class StatsCore {
  public trackGPU: boolean;
  public trackHz: boolean;
  public trackFPS: boolean;
  public trackCPT: boolean;
  public trackVRAM: boolean;
  public samplesLog: number;
  public samplesGraph: number;
  public precision: number;
  public logsPerSecond: number;
  public graphsPerSecond: number;
  protected vramSupported = false;

  public gl: WebGL2RenderingContext | null = null;
  public ext: any | null = null;
  public info?: InfoData;
  public gpuDevice: GPUDevice | null = null;
  public gpuBackend: any | null = null;
  public renderer: any | null = null;
  protected activeQuery: WebGLQuery | null = null;
  protected gpuQueries: WebGLQuery[] = [];
  protected gpuQueryFrames: number[] = []; // frame id per pending query (parallel to gpuQueries)
  protected queryPool: WebGLQuery[] = []; // recycled query objects
  protected frameId = 0;
  protected pendingFrameId = -1; // frame currently being summed from resolved queries
  protected pendingFrameSum = 0;
  protected beginDepth = 0; // re-entrancy guard for begin()/end() (e.g. CubeCamera renders)
  protected initialized = false;
  protected threeRendererPatched = false;
  protected patchedWebGLRenderer: any | null = null;
  protected originalRenderMethod: ((scene: any, camera: any) => void) | null = null;
  protected originalInfoReset: (() => void) | null = null;

  // Native WebGPU timing support
  protected webgpuNative: boolean = false;
  protected gpuQuerySet: GPUQuerySet | null = null;
  protected gpuResolveBuffer: GPUBuffer | null = null;
  protected gpuReadBuffers: GPUBuffer[] = [];
  protected gpuWriteBufferIndex: number = 0; // Buffer to write to this frame
  protected gpuFrameCount: number = 0; // Track frames for first-frame skip
  protected pendingResolve: Promise<number> | null = null;

  protected frameTimes: number[] = [];
  protected frameTimesHead = 0;

  protected cpuStartTime = -1; // -1 = no measurement in progress (consumed by endProfiling)
  protected totalCpuDuration = 0;
  protected totalGpuDuration = 0;
  protected totalGpuDurationCompute = 0;

  public averageFps: AverageData = { logs: [], graph: [] };
  public averageCpu: AverageData = { logs: [], graph: [] };
  public averageGpu: AverageData = { logs: [], graph: [] };
  public averageGpuCompute: AverageData = { logs: [], graph: [] };
  public averageVram: AverageData = { logs: [], graph: [] };

  protected prevGraphTime: number;
  protected prevTextTime: number;

  constructor({
    trackGPU = false,
    trackCPT = false,
    trackHz = false,
    trackFPS = true,
    trackVRAM = false,
    logsPerSecond = 4,
    graphsPerSecond = 30,
    samplesLog = 40,
    samplesGraph = 10,
    precision = 2
  }: StatsCoreOptions = {}) {
    this.trackGPU = trackGPU;
    this.trackCPT = trackCPT;
    this.trackHz = trackHz;
    this.trackFPS = trackFPS;
    this.trackVRAM = trackVRAM;
    this.samplesLog = samplesLog;
    this.samplesGraph = samplesGraph;
    this.precision = precision;
    this.logsPerSecond = logsPerSecond;
    this.graphsPerSecond = graphsPerSecond;

    const now = performance.now();
    this.prevGraphTime = now;
    this.prevTextTime = now;
  }

  public async init(
    canvasOrGL: WebGL2RenderingContext | HTMLCanvasElement | OffscreenCanvas | GPUDevice | any
  ): Promise<void> {
    if (!canvasOrGL) {
      console.error('Stats: The "canvas" parameter is undefined.');
      return;
    }

    if (this.initialized) return;

    if (this.handleThreeRenderer(canvasOrGL)) {
      this.initialized = true;
      return;
    }
    if (await this.handleWebGPURenderer(canvasOrGL)) {
      this.initialized = true;
      return;
    }

    // Handle native GPUDevice
    if (this.handleNativeWebGPU(canvasOrGL)) {
      this.initialized = true;
      return;
    }

    if (this.initializeWebGL(canvasOrGL)) {
      this.initialized = true;
      if (this.trackGPU) {
        this.initializeGPUTracking();
      }
      return;
    } else {
      console.error('Stats-gl: Failed to initialize WebGL context');
    }
  }

  protected handleNativeWebGPU(device: any): boolean {
    // Check if this is a GPUDevice by looking for characteristic properties
    if (device && typeof device.createCommandEncoder === 'function' &&
        typeof device.createQuerySet === 'function' && device.queue) {
      this.gpuDevice = device;
      this.webgpuNative = true;

      if (this.trackGPU && device.features?.has('timestamp-query')) {
        this.initializeWebGPUTiming();
        this.onWebGPUTimestampSupported();
      }
      return true;
    }
    return false;
  }

  protected initializeWebGPUTiming(): void {
    if (!this.gpuDevice) return;

    // Create query set for 2 timestamps (begin + end)
    this.gpuQuerySet = this.gpuDevice.createQuerySet({
      type: 'timestamp',
      count: 2
    });

    // Buffer to resolve query results (2 * 8 bytes for BigInt64)
    this.gpuResolveBuffer = this.gpuDevice.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
    });

    // Double-buffered read buffers for async readback
    for (let i = 0; i < 2; i++) {
      this.gpuReadBuffers.push(this.gpuDevice.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      }));
    }
  }

  protected handleThreeRenderer(renderer: any): boolean {
    if (renderer.isWebGLRenderer) {
      this.patchThreeRenderer(renderer);
      this.gl = renderer.getContext();

      if (this.trackGPU) {
        this.initializeGPUTracking();
      }
      return true;
    }
    return false;
  }

  protected async handleWebGPURenderer(renderer: any): Promise<boolean> {
    if (renderer.isWebGPURenderer) {
      this.renderer = renderer;

      if (this.trackGPU || this.trackCPT) {
        // Must be set before init() so the backend requests the feature
        renderer.backend.trackTimestamp = true;
      }
      if (!renderer._initialized) {
        await renderer.init();
      }
      if (this.trackGPU || this.trackCPT) {
        const supported = renderer.hasFeature('timestamp-query');
        // init() AND-gates trackTimestamp with feature support; re-gate here for
        // renderers that were already initialized when stats attached, otherwise
        // every pass would trigger WebGPU validation errors on unsupported devices.
        renderer.backend.trackTimestamp = supported;
        if (supported) {
          this.onWebGPUTimestampSupported();
        }
      }
      this.info = renderer.info;

      // Byte-level memory tracking exists on three's common Info (r18x+)
      if (this.trackVRAM && typeof renderer.info?.memory?.total === 'number') {
        this.vramSupported = true;
        this.onVRAMSupported();
      }

      // Store WebGPU device and backend for texture capture
      this.gpuBackend = renderer.backend;
      this.gpuDevice = renderer.backend?.device || null;
      this.patchThreeWebGPU(renderer);
      return true;
    }
    return false;
  }

  protected onWebGPUTimestampSupported(): void {
    // Override in subclass to create panels
  }

  protected onVRAMSupported(): void {
    // Override in subclass to create panels
  }

  protected initializeWebGL(
    canvasOrGL: WebGL2RenderingContext | HTMLCanvasElement | OffscreenCanvas
  ): boolean {
    if (canvasOrGL instanceof WebGL2RenderingContext) {
      this.gl = canvasOrGL;
    } else if (
      canvasOrGL instanceof HTMLCanvasElement ||
      canvasOrGL instanceof OffscreenCanvas
    ) {
      this.gl = canvasOrGL.getContext('webgl2');
      if (!this.gl) {
        console.error('Stats: Unable to obtain WebGL2 context.');
        return false;
      }
    } else {
      console.error(
        'Stats: Invalid input type. Expected WebGL2RenderingContext, HTMLCanvasElement, or OffscreenCanvas.'
      );
      return false;
    }
    return true;
  }

  protected initializeGPUTracking(): void {
    if (this.gl) {
      this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (this.ext) {
        this.onGPUTrackingInitialized();
      }
    }
  }

  protected onGPUTrackingInitialized(): void {
    // Override in subclass to create panels
  }

  /**
   * Get timestampWrites configuration for WebGPU render pass.
   * Use this when creating your render pass descriptor.
   * @returns timestampWrites object or undefined if not tracking GPU
   */
  public getTimestampWrites(): GPURenderPassTimestampWrites | undefined {
    if (!this.webgpuNative || !this.gpuQuerySet) return undefined;
    return {
      querySet: this.gpuQuerySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1
    };
  }

  public begin(encoder?: GPUCommandEncoder): void {
    // Re-entrant render calls (CubeCamera, RT renders inside onBeforeRender, ...):
    // only the outermost begin/end pair measures. WebGL TIME_ELAPSED queries
    // cannot nest, and nested CPU segments would double-count.
    this.beginDepth++;
    if (this.beginDepth > 1) return;

    this.beginProfiling();

    // For native WebGPU, timing is handled via timestampWrites in render pass
    if (this.webgpuNative) {
      return;
    }

    if (!this.gl || !this.ext) return;

    // Unbalanced begin() without end(): close and keep the previous query
    if (this.activeQuery) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gpuQueries.push(this.activeQuery);
      this.gpuQueryFrames.push(this.frameId);
      this.activeQuery = null;
    }

    if (this.gpuQueries.length < MAX_PENDING_QUERIES) {
      const query = this.queryPool.pop() ?? this.gl.createQuery();
      if (query) {
        this.activeQuery = query;
        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
      }
    }
  }

  public end(encoder?: GPUCommandEncoder): void {
    if (this.beginDepth > 0) this.beginDepth--;
    if (this.beginDepth > 0) return; // inner pair of a re-entrant render

    // Handle native WebGPU timing - resolve query and copy to read buffer
    if (this.webgpuNative && encoder && this.gpuQuerySet && this.gpuResolveBuffer && this.gpuReadBuffers.length > 0) {
      // Track frame count for first-frame skip
      this.gpuFrameCount++;

      // Write to current buffer (will read from other buffer in resolve)
      const writeBuffer = this.gpuReadBuffers[this.gpuWriteBufferIndex];

      // Only add resolve commands if the target buffer is unmapped
      if ((writeBuffer as any).mapState === 'unmapped') {
        encoder.resolveQuerySet(this.gpuQuerySet, 0, 2, this.gpuResolveBuffer, 0);
        encoder.copyBufferToBuffer(this.gpuResolveBuffer, 0, writeBuffer, 0, 16);
      }

      this.endProfiling();
      return;
    }

    if (this.gl && this.ext && this.activeQuery) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gpuQueries.push(this.activeQuery);
      this.gpuQueryFrames.push(this.frameId);
      this.activeQuery = null;
    }

    this.endProfiling();
  }

  /**
   * Resolve WebGPU timestamp queries. Call this after queue.submit().
   * Returns a promise that resolves to the GPU duration in milliseconds.
   */
  public async resolveTimestampsAsync(): Promise<number> {
    if (!this.webgpuNative || this.gpuReadBuffers.length === 0) {
      return this.totalGpuDuration;
    }

    // If there's already a pending resolve, wait for it
    if (this.pendingResolve) {
      return this.pendingResolve;
    }

    // Read from the OTHER buffer (written in previous frame)
    // Current frame writes to gpuWriteBufferIndex, so read from the other one
    const readBufferIndex = (this.gpuWriteBufferIndex + 1) % 2;
    const readBuffer = this.gpuReadBuffers[readBufferIndex];

    // Toggle write buffer for next frame
    this.gpuWriteBufferIndex = (this.gpuWriteBufferIndex + 1) % 2;

    // Skip first frame (no previous data to read)
    if (this.gpuFrameCount < 2) {
      return this.totalGpuDuration;
    }

    // Only attempt to map if buffer is unmapped
    if ((readBuffer as any).mapState !== 'unmapped') {
      return this.totalGpuDuration;
    }

    this.pendingResolve = this._resolveTimestamps(readBuffer);

    try {
      const result = await this.pendingResolve;
      return result;
    } finally {
      this.pendingResolve = null;
    }
  }

  private async _resolveTimestamps(readBuffer: GPUBuffer): Promise<number> {
    try {
      await readBuffer.mapAsync(GPUMapMode.READ);
      const data = new BigInt64Array(readBuffer.getMappedRange());
      const startTime = data[0];
      const endTime = data[1];
      readBuffer.unmap();

      // Convert nanoseconds to milliseconds
      const durationNs = Number(endTime - startTime);
      this.totalGpuDuration = durationNs / 1_000_000;
      return this.totalGpuDuration;
    } catch (_) {
      // Buffer may have been destroyed or mapping failed
      return this.totalGpuDuration;
    }
  }

  /**
   * Process per-backend GPU timings for the frame that just ended.
   * Shared by Stats.update() and StatsProfiler.update().
   */
  protected processFrameTimings(): void {
    if (this.webgpuNative) {
      // Native WebGPU: read back last frame's timestamps asynchronously
      this.resolveTimestampsAsync();
    } else if (!this.info) {
      this.processGpuQueries();
    } else {
      this.processWebGPUTimestamps();

      // Since three r167, info.render/compute.timestamp is only written when
      // timestamps are explicitly resolved. Resolve here so users don't have to;
      // three's query pool dedupes concurrent resolves internally.
      // Both pools must be drained whenever trackTimestamp is on: with trackGPU
      // alone, renderer.compute() still allocates compute queries every frame
      // and the pool would exhaust with a warning if never resolved.
      const renderer = this.renderer;
      if ((this.trackGPU || this.trackCPT) && renderer && typeof renderer.resolveTimestampsAsync === 'function') {
        renderer.resolveTimestampsAsync('render').catch(() => {});
        renderer.resolveTimestampsAsync('compute').catch(() => {});
      }
    }
  }

  protected processGpuQueries(): void {
    if (!this.gl || !this.ext) return;

    const gl = this.gl;

    // A disjoint event (context switch, power state change) invalidates all
    // in-flight results - discard them and keep the last known duration.
    if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      for (let i = 0; i < this.gpuQueries.length; i++) {
        this.queryPool.push(this.gpuQueries[i]);
      }
      this.gpuQueries.length = 0;
      this.gpuQueryFrames.length = 0;
      this.pendingFrameId = -1;
      this.pendingFrameSum = 0;
      return;
    }

    // Queries complete in submission order - walk from the head and stop at the
    // first unavailable one. Group durations by frame so a tick that drains two
    // frames' queries doesn't report their sum as one frame.
    let resolved = 0;
    for (let i = 0; i < this.gpuQueries.length; i++) {
      const query = this.gpuQueries[i];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;

      const frame = this.gpuQueryFrames[i];
      if (frame !== this.pendingFrameId) {
        if (this.pendingFrameId !== -1) {
          this.totalGpuDuration = this.pendingFrameSum;
        }
        this.pendingFrameId = frame;
        this.pendingFrameSum = 0;
      }
      this.pendingFrameSum += gl.getQueryParameter(query, gl.QUERY_RESULT) * 1e-6;
      this.queryPool.push(query);
      resolved++;
    }

    if (resolved > 0) {
      this.gpuQueries.copyWithin(0, resolved);
      this.gpuQueries.length -= resolved;
      this.gpuQueryFrames.copyWithin(0, resolved);
      this.gpuQueryFrames.length -= resolved;
    }

    // Queue drained: the pending frame can receive no more queries - publish it.
    // When nothing resolved this tick, totalGpuDuration keeps its last value
    // instead of dipping to zero.
    if (this.gpuQueries.length === 0 && this.pendingFrameId !== -1) {
      this.totalGpuDuration = this.pendingFrameSum;
      this.pendingFrameId = -1;
      this.pendingFrameSum = 0;
    }
  }

  protected processWebGPUTimestamps(): void {
    this.totalGpuDuration = this.info!.render.timestamp;
    this.totalGpuDurationCompute = this.info!.compute.timestamp;
  }

  protected beginProfiling(): void {
    this.cpuStartTime = performance.now();
  }

  protected endProfiling(): void {
    // Consume the start time so paired calls (end() followed by update())
    // can't add the same span twice.
    if (this.cpuStartTime < 0) return;
    this.totalCpuDuration += performance.now() - this.cpuStartTime;
    this.cpuStartTime = -1;
  }

  protected calculateFps(): number {
    const currentTime = performance.now();
    const cutoff = currentTime - 1000;

    this.frameTimes.push(currentTime);

    while (this.frameTimesHead < this.frameTimes.length && this.frameTimes[this.frameTimesHead] <= cutoff) {
      this.frameTimesHead++;
    }

    // Compact when head passes half the array to bound memory
    if (this.frameTimesHead > 128) {
      this.frameTimes = this.frameTimes.slice(this.frameTimesHead);
      this.frameTimesHead = 0;
    }

    return Math.round(this.frameTimes.length - this.frameTimesHead);
  }

  protected updateAverages(): void {
    this.addToAverage(this.totalCpuDuration, this.averageCpu);
    this.addToAverage(this.totalGpuDuration, this.averageGpu);
    if (this.info && this.totalGpuDurationCompute !== undefined) {
      this.addToAverage(this.totalGpuDurationCompute, this.averageGpuCompute);
    }
    if (this.vramSupported) {
      this.addToAverage(this.info!.memory!.total! * BYTES_TO_MB, this.averageVram);
    }
  }

  protected addToAverage(value: number, averageArray: { logs: any; graph: any; }): void {
    averageArray.logs.push(value);
    while (averageArray.logs.length > this.samplesLog) {
      averageArray.logs.shift();
    }

    averageArray.graph.push(value);
    while (averageArray.graph.length > this.samplesGraph) {
      averageArray.graph.shift();
    }
  }

  protected resetCounters(): void {
    this.totalCpuDuration = 0;
    this.frameId++;
    // update() is the frame boundary: recover from begin() calls that never
    // saw a matching end() (e.g. main-thread CPU tracking in worker setups)
    this.beginDepth = 0;
  }

  public getData(): StatsData {
    const fpsLogs = this.averageFps.logs;
    const cpuLogs = this.averageCpu.logs;
    const gpuLogs = this.averageGpu.logs;
    const gpuComputeLogs = this.averageGpuCompute.logs;
    const vramLogs = this.averageVram.logs;

    return {
      fps: fpsLogs.length > 0 ? fpsLogs[fpsLogs.length - 1] : 0,
      cpu: cpuLogs.length > 0 ? cpuLogs[cpuLogs.length - 1] : 0,
      gpu: gpuLogs.length > 0 ? gpuLogs[gpuLogs.length - 1] : 0,
      gpuCompute: gpuComputeLogs.length > 0 ? gpuComputeLogs[gpuComputeLogs.length - 1] : 0,
      vram: vramLogs.length > 0 ? vramLogs[vramLogs.length - 1] : 0
    };
  }

  protected patchThreeWebGPU(renderer: any): void {
    const originalInfoReset = renderer.info.reset;
    const statsInstance = this;

    this.originalInfoReset = originalInfoReset;

    renderer.info.reset = function () {
      statsInstance.beginProfiling();
      originalInfoReset.call(this);
    };
  }

  protected patchThreeRenderer(renderer: any): void {
    const originalRenderMethod = renderer.render;
    const statsInstance = this;

    this.patchedWebGLRenderer = renderer;
    this.originalRenderMethod = originalRenderMethod;

    renderer.render = function (scene: any, camera: any) {
      statsInstance.begin();
      originalRenderMethod.call(this, scene, camera);
      statsInstance.end();
    };

    this.threeRendererPatched = true;
  }

  /**
   * Dispose of all resources. Call when done using the stats instance.
   */
  public dispose(): void {
    // Restore patched renderer methods so the renderer no longer references us
    if (this.patchedWebGLRenderer && this.originalRenderMethod) {
      this.patchedWebGLRenderer.render = this.originalRenderMethod;
      this.patchedWebGLRenderer = null;
      this.originalRenderMethod = null;
      this.threeRendererPatched = false;
    }
    if (this.renderer && this.originalInfoReset) {
      this.renderer.info.reset = this.originalInfoReset;
      this.originalInfoReset = null;
    }

    // Clean up any pending GPU queries
    if (this.gl) {
      // End active query if any
      if (this.activeQuery && this.ext) {
        try {
          this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
        } catch (_) {
          // Query may not be active
        }
        this.gl.deleteQuery(this.activeQuery);
        this.activeQuery = null;
      }

      // Delete all pending and pooled queries
      for (const query of this.gpuQueries) {
        this.gl.deleteQuery(query);
      }
      for (const query of this.queryPool) {
        this.gl.deleteQuery(query);
      }
    }
    this.gpuQueries.length = 0;
    this.gpuQueryFrames.length = 0;
    this.queryPool.length = 0;
    this.pendingFrameId = -1;
    this.pendingFrameSum = 0;
    this.beginDepth = 0;
    this.frameId = 0;
    this.cpuStartTime = -1;
    this.initialized = false;

    // Clean up WebGPU resources
    if (this.gpuQuerySet) {
      this.gpuQuerySet.destroy();
      this.gpuQuerySet = null;
    }
    if (this.gpuResolveBuffer) {
      this.gpuResolveBuffer.destroy();
      this.gpuResolveBuffer = null;
    }
    for (const buffer of this.gpuReadBuffers) {
      if ((buffer as any).mapState === 'mapped') {
        buffer.unmap();
      }
      buffer.destroy();
    }
    this.gpuReadBuffers.length = 0;
    this.gpuFrameCount = 0;
    this.pendingResolve = null;
    this.webgpuNative = false;

    // Clear references
    this.gl = null;
    this.ext = null;
    this.info = undefined;
    this.gpuDevice = null;
    this.gpuBackend = null;
    this.renderer = null;
    this.vramSupported = false;

    // Clear arrays
    this.frameTimes.length = 0;
    this.frameTimesHead = 0;
    this.averageFps.logs.length = 0;
    this.averageFps.graph.length = 0;
    this.averageCpu.logs.length = 0;
    this.averageCpu.graph.length = 0;
    this.averageGpu.logs.length = 0;
    this.averageGpu.graph.length = 0;
    this.averageGpuCompute.logs.length = 0;
    this.averageGpuCompute.graph.length = 0;
    this.averageVram.logs.length = 0;
    this.averageVram.graph.length = 0;
  }
}
