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
  protected webgpuNative: boolean = false;
  protected gpuQuerySet: GPUQuerySet | null = null;
  protected gpuResolveBuffer: GPUBuffer | null = null;
  protected gpuReadBuffers: GPUBuffer[] = [];
  protected gpuWriteBufferIndex: number = 0; // Buffer to write to this frame
  protected gpuFrameCount: number = 0; // Track frames for first-frame skip
  protected pendingResolve: Promise<number> | null = null;

  protected beginTime: number;
  protected prevCpuTime: number;
  protected frameTimes: number[] = [];

  protected renderCount = 0;

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
    precision = 2
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
    this.beginProfiling('cpu-started');

    // For native WebGPU, timing is handled via timestampWrites in render pass
    if (this.webgpuNative) {
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

      this.endProfiling('cpu-started', 'cpu-finished', 'cpu-duration');
      return;
    }

    if (this.gl && this.ext && this.activeQuery) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gpuQueries.push({ query: this.activeQuery });
      this.activeQuery = null;
    }

    this.endProfiling('cpu-started', 'cpu-finished', 'cpu-duration');
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

  protected beginProfiling(marker: string): void {
    if (typeof performance !== 'undefined') {
      try {
        performance.clearMarks(marker);
        performance.mark(marker);
      } catch (error) {
        console.debug('Stats: Performance marking failed:', error);
      }
    }
  }

  protected endProfiling(startMarker: string | PerformanceMeasureOptions | undefined, endMarker: string | undefined, measureName: string): void {
    if (typeof performance === 'undefined' || !endMarker || !startMarker) return;

    try {
      const entries = performance.getEntriesByName(startMarker as string, 'mark');
      if (entries.length === 0) {
        this.beginProfiling(startMarker as string);
      }

      performance.clearMarks(endMarker);
      performance.mark(endMarker);

      performance.clearMeasures(measureName);

      const cpuMeasure = performance.measure(measureName, startMarker, endMarker);
      this.totalCpuDuration += cpuMeasure.duration;

      performance.clearMarks(startMarker as string);
      performance.clearMarks(endMarker);
      performance.clearMeasures(measureName);
    } catch (error) {
      console.debug('Stats: Performance measurement failed:', error);
    }
  }

  protected calculateFps(): number {
    const currentTime = performance.now();

    this.frameTimes.push(currentTime);

    while (this.frameTimes.length > 0 && this.frameTimes[0] <= currentTime - 1000) {
      this.frameTimes.shift();
    }

    return Math.round(this.frameTimes.length);
  }

  protected updateAverages(): void {
    this.addToAverage(this.totalCpuDuration, this.averageCpu);
    this.addToAverage(this.totalGpuDuration, this.averageGpu);
    if (this.info && this.totalGpuDurationCompute !== undefined) {
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
      statsInstance.beginProfiling('cpu-started');
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

    // Clear arrays
    this.frameTimes.length = 0;
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
