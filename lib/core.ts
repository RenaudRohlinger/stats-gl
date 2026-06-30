export interface StatsCoreOptions {
  trackGPU?: boolean;
  trackCPT?: boolean;
  trackHz?: boolean;
  trackFPS?: boolean;
  logsPerSecond?: number;
  graphsPerSecond?: number;
  samplesLog?: number;
  samplesGraph?: number;
  precision?: number;
  /**
   * Maximum number of timestamp pairs (begin/end) the native WebGPU path can record per frame.
   * Each pair costs 16 bytes in a single QuerySet. Default 2048 (matches Three.js's WebGPUTimestampQueryPool).
   */
  maxTimestampPairs?: number;
}

export type TimestampPassType = 'render' | 'compute';

interface InFlightTimestampFrame {
  buffer: GPUBuffer;
  pairCount: number;
  slotTypes: ReadonlyArray<TimestampPassType>;
  mapPromise: Promise<void> | null;
  ready: boolean;
  error: unknown | null;
}

export interface QueryInfo {
  query: WebGLQuery;
}

export interface AverageData {
  logs: number[];
  graph: number[];
}

export interface InfoData {
  render: {
    timestamp: number;
  };
  compute: {
    timestamp: number;
  };
}

export interface StatsData {
  fps: number;
  cpu: number;
  gpu: number;
  gpuCompute: number;
  isWorker?: boolean;
}

export class StatsCore {
  public trackGPU: boolean;
  public trackHz: boolean;
  public trackFPS: boolean;
  public trackCPT: boolean;
  public samplesLog: number;
  public samplesGraph: number;
  public precision: number;
  public logsPerSecond: number;
  public graphsPerSecond: number;

  public gl: WebGL2RenderingContext | null = null;
  public ext: any | null = null;
  public info?: InfoData;
  public gpuDevice: GPUDevice | null = null;
  public gpuBackend: any | null = null;
  public renderer: any | null = null;
  protected activeQuery: WebGLQuery | null = null;
  protected gpuQueries: QueryInfo[] = [];
  protected threeRendererPatched = false;

  // Native WebGPU timing support
  public maxTimestampPairs: number = 2048;
  protected webgpuNative: boolean = false;
  protected gpuQuerySet: GPUQuerySet | null = null;
  protected gpuResolveBuffer: GPUBuffer | null = null;
  protected gpuTimestampBufferSize: number = 0; // querySet.count * 8

  // Per-frame slot allocator (reset on begin())
  protected frameCursor: number = 0;
  protected slotTypes: TimestampPassType[] = [];

  // Async readback infrastructure
  protected readBufferPool: GPUBuffer[] = []; // unmapped buffers ready for reuse
  protected inFlightFrames: InFlightTimestampFrame[] = [];
  protected readonly poolWarnThreshold: number = 8;
  protected warnedMapError: boolean = false;
  protected warnedSlotOverflow: boolean = false;
  protected warnedPoolGrowth: boolean = false;

  protected beginTime: number;
  protected prevCpuTime: number;
  protected frameTimes: number[] = [];
  protected frameTimesHead = 0;

  protected renderCount = 0;

  protected cpuStartTime = 0;
  protected isRunningCPUProfiling = false;
  protected totalCpuDuration = 0;
  protected totalGpuDuration = 0;
  protected totalGpuDurationCompute = 0;

  public averageFps: AverageData = { logs: [], graph: [] };
  public averageCpu: AverageData = { logs: [], graph: [] };
  public averageGpu: AverageData = { logs: [], graph: [] };
  public averageGpuCompute: AverageData = { logs: [], graph: [] };

  protected prevGraphTime: number;
  protected prevTextTime: number;

  constructor({
    trackGPU = false,
    trackCPT = false,
    trackHz = false,
    trackFPS = true,
    logsPerSecond = 4,
    graphsPerSecond = 30,
    samplesLog = 40,
    samplesGraph = 10,
    precision = 2,
    maxTimestampPairs = 2048
  }: StatsCoreOptions = {}) {
    this.trackGPU = trackGPU;
    this.trackCPT = trackCPT;
    this.trackHz = trackHz;
    this.trackFPS = trackFPS;
    this.samplesLog = samplesLog;
    this.samplesGraph = samplesGraph;
    this.precision = precision;
    this.logsPerSecond = logsPerSecond;
    this.graphsPerSecond = graphsPerSecond;
    this.maxTimestampPairs = Math.max(1, maxTimestampPairs);

    const now = performance.now();
    this.prevGraphTime = now;
    this.beginTime = now;
    this.prevTextTime = now;
    this.prevCpuTime = now;
  }

  public async init(
    canvasOrGL: WebGL2RenderingContext | HTMLCanvasElement | OffscreenCanvas | GPUDevice | any
  ): Promise<void> {
    if (!canvasOrGL) {
      console.error('Stats: The "canvas" parameter is undefined.');
      return;
    }

    if (this.handleThreeRenderer(canvasOrGL)) return;
    if (await this.handleWebGPURenderer(canvasOrGL)) return;

    // Handle native GPUDevice
    if (this.handleNativeWebGPU(canvasOrGL)) return;

    if (this.initializeWebGL(canvasOrGL)) {
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

    const count = this.maxTimestampPairs * 2;
    this.gpuTimestampBufferSize = count * 8; // 8 bytes per u64 timestamp

    this.gpuQuerySet = this.gpuDevice.createQuerySet({
      type: 'timestamp',
      count
    });

    this.gpuResolveBuffer = this.gpuDevice.createBuffer({
      size: this.gpuTimestampBufferSize,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
    });
  }

  private acquireReadBuffer(): GPUBuffer | null {
    if (!this.gpuDevice) return null;
    const recycled = this.readBufferPool.pop();
    if (recycled) return recycled;

    const totalLive = this.inFlightFrames.length + this.readBufferPool.length + 1;
    if (totalLive > this.poolWarnThreshold && !this.warnedPoolGrowth) {
      console.warn(
        `stats-gl: WebGPU timestamp readback pool grew to ${totalLive} buffers — ` +
        `is update() being called every frame after queue.submit?`
      );
      this.warnedPoolGrowth = true;
    }
    return this.gpuDevice.createBuffer({
      size: this.gpuTimestampBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }

  protected handleThreeRenderer(renderer: any): boolean {
    if (renderer.isWebGLRenderer && !this.threeRendererPatched) {
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
        renderer.backend.trackTimestamp = true;
        if (!renderer._initialized) {
          await renderer.init();
        }
        if (renderer.hasFeature('timestamp-query')) {
          this.onWebGPUTimestampSupported();
        }
      }
      this.info = renderer.info;
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
   * Allocate a fresh timestamp pair (beginning + end) and return the descriptor
   * to embed in a render or compute pass. Each call consumes one pair from the
   * per-frame budget; counters reset on the next `begin()`.
   *
   * @param type - 'render' (default) or 'compute' — controls which panel the
   *               resolved duration is added to.
   * @returns timestampWrites object, or `undefined` if the native WebGPU path
   *          is not active or the per-frame pair budget is exhausted.
   */
  public getTimestampWrites(
    type: TimestampPassType = 'render'
  ): GPURenderPassTimestampWrites | undefined {
    if (!this.webgpuNative || !this.gpuQuerySet) return undefined;
    if (this.frameCursor >= this.maxTimestampPairs) {
      if (!this.warnedSlotOverflow) {
        console.warn(
          `stats-gl: WebGPU timestamp pair budget exhausted ` +
          `(maxTimestampPairs=${this.maxTimestampPairs}). ` +
          `Increase maxTimestampPairs in StatsOptions to instrument more passes.`
        );
        this.warnedSlotOverflow = true;
      }
      return undefined;
    }
    const i = this.frameCursor++;
    this.slotTypes[i] = type;
    return {
      querySet: this.gpuQuerySet,
      beginningOfPassWriteIndex: i * 2,
      endOfPassWriteIndex: i * 2 + 1
    };
  }

  public begin(encoder?: GPUCommandEncoder): void {
    this.beginProfiling();

    // For native WebGPU, timing is handled via timestampWrites in the
    // render/compute pass descriptors returned by getTimestampWrites().
    // Reset the per-frame slot allocator here so the next pass starts at index 0.
    if (this.webgpuNative) {
      this.frameCursor = 0;
      this.slotTypes.length = 0;
      return;
    }

    if (!this.gl || !this.ext) return;

    if (this.activeQuery) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    }

    this.activeQuery = this.gl.createQuery();
    if (this.activeQuery) {
      this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.activeQuery);
    }
  }

  public end(encoder?: GPUCommandEncoder): void {
    this.renderCount++;

    // Native WebGPU: resolve the slots used this frame and queue a buffer read.
    if (this.webgpuNative && encoder && this.gpuQuerySet && this.gpuResolveBuffer) {
      const usedPairs = this.frameCursor;
      if (usedPairs > 0) {
        const usedQueries = usedPairs * 2;
        const usedBytes = usedQueries * 8;
        // resolveQuerySet writes into gpuResolveBuffer, which is never mapped — safe to call always.
        encoder.resolveQuerySet(this.gpuQuerySet, 0, usedQueries, this.gpuResolveBuffer, 0);

        const readBuffer = this.acquireReadBuffer();
        if (readBuffer) {
          encoder.copyBufferToBuffer(this.gpuResolveBuffer, 0, readBuffer, 0, usedBytes);
          this.inFlightFrames.push({
            buffer: readBuffer,
            pairCount: usedPairs,
            slotTypes: this.slotTypes.slice(0, usedPairs),
            mapPromise: null,
            ready: false,
            error: null
          });
        }
      }

      this.endProfiling();
      return;
    }

    if (this.gl && this.ext && this.activeQuery) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gpuQueries.push({ query: this.activeQuery });
      this.activeQuery = null;
    }

    this.endProfiling();
  }

  /**
   * Drive the WebGPU timestamp readback pipeline. Call once per frame, AFTER
   * queue.submit(). Kicks off mapAsync for any newly-submitted in-flight frames
   * and drains any frames whose mapping has resolved (oldest first).
   *
   * Returns the most recently resolved render-pass duration in milliseconds.
   */
  public async resolveTimestampsAsync(): Promise<number> {
    if (!this.webgpuNative) return this.totalGpuDuration;

    // Kick off mapAsync for any frames that haven't started mapping yet.
    // The user is expected to have called queue.submit() before update(),
    // so the copy commands are now in flight on the GPU.
    for (const entry of this.inFlightFrames) {
      if (entry.mapPromise === null) {
        entry.mapPromise = entry.buffer.mapAsync(GPUMapMode.READ).then(
          () => { entry.ready = true; },
          (e) => { entry.error = e; entry.ready = true; }
        );
      }
    }

    // Drain completed frames in submission order. Each completed frame
    // overwrites totalGpuDuration / totalGpuDurationCompute, so the latest
    // resolved frame's data is what the panels see.
    while (this.inFlightFrames.length > 0 && this.inFlightFrames[0].ready) {
      const entry = this.inFlightFrames.shift()!;
      if (entry.error) {
        if (!this.warnedMapError) {
          console.warn('stats-gl: WebGPU timestamp mapAsync failed', entry.error);
          this.warnedMapError = true;
        }
        this.totalGpuDuration = 0;
        this.totalGpuDurationCompute = 0;
        // Failed mapAsync leaves the buffer unmapped; safe to recycle.
        this.readBufferPool.push(entry.buffer);
        continue;
      }

      const data = new BigUint64Array(entry.buffer.getMappedRange());
      let renderNs = 0;
      let computeNs = 0;
      for (let i = 0; i < entry.pairCount; i++) {
        const start = data[i * 2];
        const end = data[i * 2 + 1];
        // Guard against rare disjoint timestamps (end < start) and stay in Number land.
        const delta = end >= start ? Number(end - start) : 0;
        if (entry.slotTypes[i] === 'compute') {
          computeNs += delta;
        } else {
          renderNs += delta;
        }
      }
      entry.buffer.unmap();
      this.readBufferPool.push(entry.buffer);

      this.totalGpuDuration = renderNs / 1_000_000;
      this.totalGpuDurationCompute = computeNs / 1_000_000;
    }

    return this.totalGpuDuration;
  }

  protected processGpuQueries(): void {
    if (!this.gl || !this.ext) return;

    this.totalGpuDuration = 0;

    // Iterate in reverse to safely remove while iterating
    for (let i = this.gpuQueries.length - 1; i >= 0; i--) {
      const queryInfo = this.gpuQueries[i];
      const available = this.gl.getQueryParameter(queryInfo.query, this.gl.QUERY_RESULT_AVAILABLE);
      const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);

      if (available && !disjoint) {
        const elapsed = this.gl.getQueryParameter(queryInfo.query, this.gl.QUERY_RESULT);
        const duration = elapsed * 1e-6;
        this.totalGpuDuration += duration;
        this.gl.deleteQuery(queryInfo.query);
        this.gpuQueries.splice(i, 1);
      }
    }
  }

  protected processWebGPUTimestamps(): void {
    this.totalGpuDuration = this.info!.render.timestamp;
    this.totalGpuDurationCompute = this.info!.compute.timestamp;
  }

  protected beginProfiling(): void {
    this.cpuStartTime = performance.now();
    this.isRunningCPUProfiling = true;
  }

  protected endProfiling(): void {
    if (this.isRunningCPUProfiling) {
      this.totalCpuDuration += performance.now() - this.cpuStartTime;
      this.isRunningCPUProfiling = false;
    }
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
    if ((this.info || this.webgpuNative) && this.totalGpuDurationCompute !== undefined) {
      this.addToAverage(this.totalGpuDurationCompute, this.averageGpuCompute);
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
    this.renderCount = 0;
    this.totalCpuDuration = 0;
    this.beginTime = performance.now();
  }

  public getData(): StatsData {
    const fpsLogs = this.averageFps.logs;
    const cpuLogs = this.averageCpu.logs;
    const gpuLogs = this.averageGpu.logs;
    const gpuComputeLogs = this.averageGpuCompute.logs;

    return {
      fps: fpsLogs.length > 0 ? fpsLogs[fpsLogs.length - 1] : 0,
      cpu: cpuLogs.length > 0 ? cpuLogs[cpuLogs.length - 1] : 0,
      gpu: gpuLogs.length > 0 ? gpuLogs[gpuLogs.length - 1] : 0,
      gpuCompute: gpuComputeLogs.length > 0 ? gpuComputeLogs[gpuComputeLogs.length - 1] : 0
    };
  }

  protected patchThreeWebGPU(renderer: any): void {
    const originalAnimationLoop = renderer.info.reset;
    const statsInstance = this;

    renderer.info.reset = function () {
      statsInstance.beginProfiling();
      originalAnimationLoop.call(this);
    };
  }

  protected patchThreeRenderer(renderer: any): void {
    const originalRenderMethod = renderer.render;
    const statsInstance = this;

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

      // Delete all pending queries
      for (const queryInfo of this.gpuQueries) {
        this.gl.deleteQuery(queryInfo.query);
      }
      this.gpuQueries.length = 0;
    }

    // Clean up WebGPU resources
    if (this.gpuQuerySet) {
      this.gpuQuerySet.destroy();
      this.gpuQuerySet = null;
    }
    if (this.gpuResolveBuffer) {
      this.gpuResolveBuffer.destroy();
      this.gpuResolveBuffer = null;
    }
    for (const entry of this.inFlightFrames) {
      try {
        if ((entry.buffer as any).mapState === 'mapped') {
          entry.buffer.unmap();
        }
      } catch (_) {
        // Buffer may already be in a terminal state.
      }
      entry.buffer.destroy();
    }
    this.inFlightFrames.length = 0;
    for (const buffer of this.readBufferPool) {
      buffer.destroy();
    }
    this.readBufferPool.length = 0;
    this.frameCursor = 0;
    this.slotTypes.length = 0;
    this.gpuTimestampBufferSize = 0;
    this.warnedMapError = false;
    this.warnedSlotOverflow = false;
    this.warnedPoolGrowth = false;
    this.webgpuNative = false;

    // Clear references
    this.gl = null;
    this.ext = null;
    this.info = undefined;
    this.gpuDevice = null;
    this.gpuBackend = null;
    this.renderer = null;

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
  }
}
