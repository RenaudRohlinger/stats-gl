import { StatsCore, StatsCoreOptions, StatsData, AverageData, BYTES_TO_MB } from './core';
import { Panel } from './panel';
import { PanelVSync } from './panelVsync';
import { PanelMemory } from './panelMemory';
import { PanelTexture } from './panelTexture';
import {
  TextureCaptureWebGL,
  TextureCaptureWebGPU,
  extractWebGLSource,
  extractWebGPUSource,
  ThreeTextureSource,
  DEFAULT_PREVIEW_WIDTH,
  DEFAULT_PREVIEW_HEIGHT
} from './textureCapture';

interface StatsOptions extends StatsCoreOptions {
  minimal?: boolean;
  horizontal?: boolean;
  mode?: number;
  texturesPerSecond?: number;
}

interface VSyncInfo {
  refreshRate: number;
  frameTime: number;
}

function maxOf(values: number[]): number {
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > max) max = values[i];
  }
  return max;
}

function minOf(values: number[]): number {
  let min = Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
  }
  return min;
}

class Stats extends StatsCore {
  public dom: HTMLDivElement;
  public mode: number;
  public horizontal: boolean;
  public minimal: boolean;
  public texturesPerSecond: number;

  /** Metric panels in display order (ids match array index) */
  public panels: Panel[] = [];
  private fpsPanel: Panel | null = null;
  private msPanel: Panel | null = null;
  private gpuPanel: Panel | null = null;
  private gpuPanelCompute: Panel | null = null;
  private vramPanel: PanelMemory | null = null;
  private vsyncPanel: PanelVSync | null = null;
  private workerCpuPanel: Panel | null = null;
  private vramMaxSeen = 0;

  // Texture panel support
  public texturePanels: Map<string, PanelTexture> = new Map();
  private texturePanelRow: HTMLDivElement | null = null;
  private textureCaptureWebGL: TextureCaptureWebGL | null = null;
  private textureCaptureWebGPU: TextureCaptureWebGPU | null = null;
  private textureSourcesWebGL: Map<string, { target: ThreeTextureSource; framebuffer: WebGLFramebuffer; width: number; height: number }> = new Map();
  private textureSourcesWebGPU: Map<string, any> = new Map(); // GPUTexture
  private texturePreviewWidth = DEFAULT_PREVIEW_WIDTH;
  private texturePreviewHeight = DEFAULT_PREVIEW_HEIGHT;
  private lastRendererWidth = 0;
  private lastRendererHeight = 0;
  private textureUpdatePending = false;
  private prevTextureTime: number;

  private readonly VSYNC_RATES: VSyncInfo[] = [
    { refreshRate: 30, frameTime: 33.33 },
    { refreshRate: 50, frameTime: 20.0 },
    { refreshRate: 60, frameTime: 16.67 },
    { refreshRate: 75, frameTime: 13.33 },
    { refreshRate: 90, frameTime: 11.11 },
    { refreshRate: 120, frameTime: 8.33 },
    { refreshRate: 144, frameTime: 6.94 },
    { refreshRate: 165, frameTime: 6.06 },
    { refreshRate: 240, frameTime: 4.17 },
    { refreshRate: 360, frameTime: 2.78 },
    { refreshRate: 480, frameTime: 2.08 }
  ];
  private detectedVSync: VSyncInfo | null = null;
  // Ring buffer with running sum/sum-of-squares for O(1) mean and variance
  private readonly HISTORY_SIZE = 120;
  private readonly VSYNC_THRESHOLD = 0.05;
  private frameTimeHistory = new Float32Array(this.HISTORY_SIZE);
  private frameTimeIndex = 0;
  private frameTimeCount = 0;
  private frameTimeSum = 0;
  private frameTimeSumSq = 0;
  private frameTimeResync = 0;
  private lastFrameTime: number = 0;

  private externalData: StatsData | null = null;
  private hasNewExternalData = false;
  private isWorker = false;
  private averageWorkerCpu: AverageData = { logs: [], graph: [] };

  static Panel = Panel;
  static PanelTexture = PanelTexture;

  constructor({
    trackGPU = false,
    trackCPT = false,
    trackHz = false,
    trackFPS = true,
    trackVRAM = false,
    logsPerSecond = 4,
    graphsPerSecond = 30,
    texturesPerSecond = 10,
    samplesLog = 40,
    samplesGraph = 10,
    precision = 2,
    minimal = false,
    horizontal = true,
    mode = 0
  }: StatsOptions = {}) {
    super({
      trackGPU,
      trackCPT,
      trackHz,
      trackFPS,
      trackVRAM,
      logsPerSecond,
      graphsPerSecond,
      samplesLog,
      samplesGraph,
      precision
    });

    this.mode = mode;
    this.horizontal = horizontal;
    this.minimal = minimal;
    this.texturesPerSecond = texturesPerSecond;
    this.prevTextureTime = performance.now();

    this.dom = document.createElement('div');
    this.initializeDOM();

    if (this.trackFPS) {
      this.fpsPanel = this.addPanel(new Stats.Panel('FPS', '#0ff', '#002'));
      this.msPanel = this.addPanel(new Stats.Panel('CPU', '#0f0', '#020'));
    }

    if (this.trackGPU) {
      this.gpuPanel = this.addPanel(new Stats.Panel('GPU', '#ff0', '#220'));
    }

    if (this.trackCPT) {
      this.gpuPanelCompute = this.addPanel(new Stats.Panel('CPT', '#e1e1e1', '#212121'));
    }

    if (this.trackHz === true) {
      this.vsyncPanel = new PanelVSync('', '#f0f', '#202');
      this.dom.appendChild(this.vsyncPanel.canvas);
      this.vsyncPanel.setOffset(56, 35);
    }

    this.setupEventListeners();
  }

  private initializeDOM(): void {
    this.dom.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      opacity: 0.9;
      z-index: 10000;
      ${this.minimal ? 'cursor: pointer;' : ''}
    `;
  }

  private setupEventListeners(): void {
    if (this.minimal) {
      this.dom.addEventListener('click', this.handleClick);
      this.showPanel(this.mode);
    }
  }

  private handleClick = (event: MouseEvent): void => {
    event.preventDefault();
    if (this.panels.length === 0) return;
    this.showPanel(++this.mode % this.panels.length);
  };

  /**
   * Compute and update texture preview dimensions based on renderer aspect ratio
   */
  private updateTexturePreviewDimensions(): void {
    if (!this.renderer) return;

    const rendererWidth = this.renderer.domElement?.width || 0;
    const rendererHeight = this.renderer.domElement?.height || 0;

    // Skip if dimensions unchanged
    if (rendererWidth === this.lastRendererWidth && rendererHeight === this.lastRendererHeight) {
      return;
    }
    if (rendererWidth === 0 || rendererHeight === 0) return;

    this.lastRendererWidth = rendererWidth;
    this.lastRendererHeight = rendererHeight;

    // Compute preview size maintaining aspect ratio
    // Base dimensions: 90x48 panel, compute to fit source aspect
    const sourceAspect = rendererWidth / rendererHeight;
    const panelAspect = DEFAULT_PREVIEW_WIDTH / DEFAULT_PREVIEW_HEIGHT;

    let newWidth: number;
    let newHeight: number;

    if (sourceAspect > panelAspect) {
      // Source wider than panel - fit to width
      newWidth = DEFAULT_PREVIEW_WIDTH;
      newHeight = Math.round(DEFAULT_PREVIEW_WIDTH / sourceAspect);
    } else {
      // Source taller than panel - fit to height
      newHeight = DEFAULT_PREVIEW_HEIGHT;
      newWidth = Math.round(DEFAULT_PREVIEW_HEIGHT * sourceAspect);
    }

    // Ensure minimum dimensions
    newWidth = Math.max(newWidth, 16);
    newHeight = Math.max(newHeight, 16);

    if (newWidth !== this.texturePreviewWidth || newHeight !== this.texturePreviewHeight) {
      this.texturePreviewWidth = newWidth;
      this.texturePreviewHeight = newHeight;

      // Resize capture helpers
      if (this.textureCaptureWebGL) {
        this.textureCaptureWebGL.resize(newWidth, newHeight);
      }
      if (this.textureCaptureWebGPU) {
        this.textureCaptureWebGPU.resize(newWidth, newHeight);
      }

      // Update panel source sizes
      for (const panel of this.texturePanels.values()) {
        panel.setSourceSize(rendererWidth, rendererHeight);
      }
    }
  }

  protected override onWebGPUTimestampSupported(): void {
    // Panels already created in constructor
  }

  protected override onGPUTrackingInitialized(): void {
    // Panel already created in constructor
  }

  protected override onVRAMSupported(): void {
    if (!this.vramPanel) {
      this.vramPanel = this.addPanel(new PanelMemory('VRAM', '#e0e', '#202')) as PanelMemory;
      if (this.minimal) this.showPanel(this.mode);
    }
  }

  public setData(data: StatsData): void {
    this.externalData = data;
    this.hasNewExternalData = true;

    // Dynamically add worker CPU panel right after main CPU panel
    if (!this.isWorker && this.msPanel) {
      this.isWorker = true;

      this.workerCpuPanel = new Stats.Panel('WRK', '#f90', '#220');

      // Insert after msPanel and re-derive ids from display order
      const insertIndex = this.panels.indexOf(this.msPanel) + 1;
      this.panels.splice(insertIndex, 0, this.workerCpuPanel);
      for (let i = 0; i < this.panels.length; i++) {
        this.panels[i].id = i;
        this.resizePanel(this.panels[i]);
      }

      // Insert canvas after msPanel in DOM
      const msCanvas = this.msPanel.canvas;
      if (msCanvas.nextSibling) {
        this.dom.insertBefore(this.workerCpuPanel.canvas, msCanvas.nextSibling);
      } else {
        this.dom.appendChild(this.workerCpuPanel.canvas);
      }

      // resizePanel hides panels in minimal mode - restore the active one
      if (this.minimal) this.showPanel(this.mode % this.panels.length);
    }

    // Worker forwards VRAM (three WebGPURenderer in worker)
    if (data.vram !== undefined && data.vram > 0 && this.trackVRAM && !this.vramPanel) {
      this.onVRAMSupported();
    }
  }

  public update(): void {
    if (this.externalData) {
      this.updateFromExternalData();
    } else {
      this.updateFromInternalData();
    }
  }

  private updateFromExternalData(): void {
    const data = this.externalData!;

    // Track main thread CPU (measures from begin() call if user called it)
    this.endProfiling();
    this.addToAverage(this.totalCpuDuration, this.averageCpu);
    this.totalCpuDuration = 0;
    this.beginDepth = 0; // frame boundary - see resetCounters()

    // Only add worker data when new message arrived
    if (this.hasNewExternalData) {
      this.addToAverage(data.cpu, this.averageWorkerCpu);
      this.addToAverage(data.fps, this.averageFps);
      this.addToAverage(data.gpu, this.averageGpu);
      this.addToAverage(data.gpuCompute, this.averageGpuCompute);
      if (data.vram !== undefined) {
        this.addToAverage(data.vram, this.averageVram);
      }
      this.hasNewExternalData = false;
    }

    this.renderPanels();
  }

  private updateFromInternalData(): void {
    this.endProfiling();
    this.processFrameTimings();
    this.updateAverages();
    this.resetCounters();
    this.renderPanels();
  }

  private renderPanels(): void {
    const currentTime = performance.now();

    // Only calculate FPS locally when not using worker data
    if (!this.isWorker) {
      this.addToAverage(this.calculateFps(), this.averageFps);
    }

    const shouldUpdateText = currentTime >= this.prevTextTime + 1000 / this.logsPerSecond;
    const shouldUpdateGraph = currentTime >= this.prevGraphTime + 1000 / this.graphsPerSecond;
    const shouldUpdateTextures = currentTime >= this.prevTextureTime + 1000 / this.texturesPerSecond;

    const suffix = this.isWorker ? ' ⛭' : '';
    this.updatePanelComponents(this.fpsPanel, this.averageFps, 0, shouldUpdateText, shouldUpdateGraph, suffix);
    // Main thread CPU (no suffix)
    this.updatePanelComponents(this.msPanel, this.averageCpu, this.precision, shouldUpdateText, shouldUpdateGraph, '');
    // Worker CPU panel (with ⛭ suffix)
    if (this.workerCpuPanel && this.isWorker) {
      this.updatePanelComponents(this.workerCpuPanel, this.averageWorkerCpu, this.precision, shouldUpdateText, shouldUpdateGraph, ' ⛭');
    }
    if (this.gpuPanel) {
      this.updatePanelComponents(this.gpuPanel, this.averageGpu, this.precision, shouldUpdateText, shouldUpdateGraph, suffix);
    }
    if (this.trackCPT && this.gpuPanelCompute) {
      this.updatePanelComponents(this.gpuPanelCompute, this.averageGpuCompute, this.precision, shouldUpdateText, shouldUpdateGraph, suffix);
    }
    if (this.vramPanel) {
      this.updateVramPanel(shouldUpdateText, shouldUpdateGraph, suffix);
    }

    if (shouldUpdateText) {
      this.prevTextTime = currentTime;
    }
    if (shouldUpdateGraph) {
      this.prevGraphTime = currentTime;
    }
    if (shouldUpdateTextures) {
      this.prevTextureTime = currentTime;

      // Update texture panels (prevent overlapping async updates)
      if (this.texturePanels.size > 0 && !this.textureUpdatePending) {
        this.textureUpdatePending = true;
        this.updateTexturePanels().finally(() => {
          this.textureUpdatePending = false;
        });
      }

      // Capture StatsGL nodes (registered by addon)
      this.captureStatsGLNodes();
    }

    if (this.vsyncPanel !== null) {
      this.detectVSync(currentTime);

      if (shouldUpdateText) {
        const vsyncValue = this.detectedVSync?.refreshRate || 0;
        this.vsyncPanel.update(vsyncValue, vsyncValue);
      }
    }
  }

  private updateVramPanel(shouldUpdateText: boolean, shouldUpdateGraph: boolean, suffix: string): void {
    const logs = this.averageVram.logs;
    if (!this.vramPanel || logs.length === 0) return;
    if (!shouldUpdateText && !shouldUpdateGraph) return;

    const currentValue = logs[logs.length - 1];
    if (currentValue > this.vramMaxSeen) this.vramMaxSeen = currentValue;

    if (shouldUpdateText) {
      // Exact value (no smoothing) - memory should read precisely
      this.vramPanel.update(currentValue, maxOf(logs), this.precision, suffix, minOf(logs));
      this.updateVramTooltip();
    }

    if (shouldUpdateGraph) {
      // Scale against the running max with headroom: a windowed max would pin
      // a near-constant signal to the top of the graph
      this.vramPanel.updateGraph(currentValue, this.vramMaxSeen * 1.25);
    }
  }

  private updateVramTooltip(): void {
    const memory = this.info?.memory;
    const canvas = this.vramPanel?.canvas;
    if (!memory || !canvas || !('title' in canvas)) return;

    const mb = (bytes?: number) => ((bytes ?? 0) * BYTES_TO_MB).toFixed(1);
    canvas.title =
      `VRAM (tracked allocations)\n` +
      `textures: ${mb(memory.texturesSize)} MB (${memory.textures})\n` +
      `geometry: ${mb((memory.attributesSize ?? 0) + (memory.indexAttributesSize ?? 0))} MB (${memory.geometries})\n` +
      `storage: ${mb((memory.storageAttributesSize ?? 0) + (memory.indirectStorageAttributesSize ?? 0))} MB\n` +
      `programs: ${mb(memory.programsSize)} MB (${memory.programs ?? 0})\n` +
      `render targets: ${memory.renderTargets ?? 0}`;
  }

  resizePanel(panel: Panel) {
    panel.canvas.style.position = 'absolute';

    if (this.minimal) {
      panel.canvas.style.display = 'none';
    } else {
      panel.canvas.style.display = 'block';
      if (this.horizontal) {
        panel.canvas.style.top = '0px';
        panel.canvas.style.left = panel.id * panel.WIDTH / panel.PR + 'px';
      } else {
        panel.canvas.style.left = '0px';
        panel.canvas.style.top = panel.id * panel.HEIGHT / panel.PR + 'px';
      }
    }
  }

  addPanel(panel: Panel) {
    if (panel.canvas) {
      this.dom.appendChild(panel.canvas);
      panel.id = this.panels.length;
      this.panels.push(panel);
      this.resizePanel(panel);
    }
    return panel;
  }

  showPanel(id: number) {
    // Only metric panels participate in cycling - the VSync overlay and the
    // texture row are not part of the rotation
    for (let i = 0; i < this.panels.length; i++) {
      this.panels[i].canvas.style.display = i === id ? 'block' : 'none';
    }
    this.mode = id;
  }

  // ==========================================================================
  // Texture Panel API
  // ==========================================================================

  /**
   * Add a new texture preview panel
   * @param name - Label for the texture panel
   * @returns The created PanelTexture instance
   */
  public addTexturePanel(name: string): PanelTexture {
    // Create texture panel row if not exists
    if (!this.texturePanelRow) {
      this.texturePanelRow = document.createElement('div');
      this.texturePanelRow.style.cssText = `
        position: absolute;
        top: 48px;
        left: 0;
        display: flex;
        flex-direction: row;
      `;
      this.dom.appendChild(this.texturePanelRow);
    }

    const panel = new PanelTexture(name);
    panel.canvas.style.position = 'relative';
    panel.canvas.style.left = '';
    panel.canvas.style.top = '';
    this.texturePanelRow.appendChild(panel.canvas);
    this.texturePanels.set(name, panel);

    return panel;
  }

  /**
   * Set texture source for a panel (Three.js render target)
   * Auto-detects WebGL/WebGPU and extracts native handles
   * @param name - Panel name
   * @param source - Three.js RenderTarget or native texture
   */
  public setTexture(name: string, source: ThreeTextureSource | any): void {
    // Update preview dimensions based on current renderer
    this.updateTexturePreviewDimensions();

    // Initialize capture helpers if needed
    if (this.gl && !this.textureCaptureWebGL) {
      this.textureCaptureWebGL = new TextureCaptureWebGL(this.gl, this.texturePreviewWidth, this.texturePreviewHeight);
    }
    if (this.gpuDevice && !this.textureCaptureWebGPU) {
      this.textureCaptureWebGPU = new TextureCaptureWebGPU(this.gpuDevice, this.texturePreviewWidth, this.texturePreviewHeight);
    }

    const panel = this.texturePanels.get(name);

    // Handle Three.js WebGLRenderTarget
    if ((source as ThreeTextureSource).isWebGLRenderTarget && this.gl) {
      const webglSource = extractWebGLSource(source as ThreeTextureSource, this.gl);
      if (webglSource) {
        this.textureSourcesWebGL.set(name, {
          target: source as ThreeTextureSource,
          ...webglSource
        });
        // Set source aspect ratio on panel
        if (panel) {
          panel.setSourceSize(webglSource.width, webglSource.height);
        }
      }
      return;
    }

    // Handle Three.js WebGPU RenderTarget
    if ((source as ThreeTextureSource).isRenderTarget && this.gpuBackend) {
      const gpuTexture = extractWebGPUSource(source as ThreeTextureSource, this.gpuBackend);
      if (gpuTexture) {
        this.textureSourcesWebGPU.set(name, gpuTexture);
        // Set source aspect ratio on panel (use source dimensions if available)
        if (panel && (source as ThreeTextureSource).width && (source as ThreeTextureSource).height) {
          panel.setSourceSize((source as ThreeTextureSource).width!, (source as ThreeTextureSource).height!);
        }
      }
      return;
    }

    // Handle raw GPUTexture (check for createView method)
    if (source && typeof source.createView === 'function') {
      this.textureSourcesWebGPU.set(name, source);
      return;
    }

    // Handle raw WebGLFramebuffer (need width/height from user)
    // For raw FBOs, user should call setTextureWebGL directly
  }

  /**
   * Set WebGL framebuffer source with explicit dimensions
   * @param name - Panel name
   * @param framebuffer - WebGL framebuffer
   * @param width - Texture width
   * @param height - Texture height
   */
  public setTextureWebGL(name: string, framebuffer: WebGLFramebuffer, width: number, height: number): void {
    // Update preview dimensions based on current renderer
    this.updateTexturePreviewDimensions();

    if (this.gl && !this.textureCaptureWebGL) {
      this.textureCaptureWebGL = new TextureCaptureWebGL(this.gl, this.texturePreviewWidth, this.texturePreviewHeight);
    }
    this.textureSourcesWebGL.set(name, {
      target: { isWebGLRenderTarget: true } as ThreeTextureSource,
      framebuffer,
      width,
      height
    });
    // Set source aspect ratio on panel
    const panel = this.texturePanels.get(name);
    if (panel) {
      panel.setSourceSize(width, height);
    }
  }

  /**
   * Set texture from ImageBitmap (for worker mode)
   * @param name - Panel name
   * @param bitmap - ImageBitmap transferred from worker
   * @param sourceWidth - Optional source texture width for aspect ratio
   * @param sourceHeight - Optional source texture height for aspect ratio
   */
  public setTextureBitmap(name: string, bitmap: ImageBitmap, sourceWidth?: number, sourceHeight?: number): void {
    const panel = this.texturePanels.get(name);
    if (panel) {
      // Set source size for proper aspect ratio if provided
      if (sourceWidth !== undefined && sourceHeight !== undefined) {
        panel.setSourceSize(sourceWidth, sourceHeight);
      }
      panel.updateTexture(bitmap);
    }
  }

  /**
   * Remove a texture panel
   * @param name - Panel name to remove
   */
  public removeTexturePanel(name: string): void {
    const panel = this.texturePanels.get(name);
    if (panel) {
      panel.dispose();
      panel.canvas.remove();
      this.texturePanels.delete(name);
      this.textureSourcesWebGL.delete(name);
      this.textureSourcesWebGPU.delete(name);
      this.textureCaptureWebGL?.removeSource(name);
      this.textureCaptureWebGPU?.removeSource(name);
    }
  }

  /**
   * Capture and update all texture panels
   * Called automatically during renderPanels at graphsPerSecond rate
   */
  private async updateTexturePanels(): Promise<void> {
    // Check for renderer dimension changes every frame
    this.updateTexturePreviewDimensions();

    // Update WebGL textures: poll-based async readback (PBO + fence), no stall
    if (this.textureCaptureWebGL) {
      for (const [name, source] of this.textureSourcesWebGL) {
        const panel = this.texturePanels.get(name);
        if (panel) {
          // Re-extract framebuffer for Three.js targets (may change each frame)
          let framebuffer = source.framebuffer;
          let width = source.width;
          let height = source.height;

          if (source.target.isWebGLRenderTarget && source.target.__webglFramebuffer) {
            framebuffer = source.target.__webglFramebuffer;
            width = source.target.width || width;
            height = source.target.height || height;
          }

          const result = this.textureCaptureWebGL.captureSync(framebuffer, width, height, name);
          if (result) {
            panel.updatePixels(result.pixels, result.width, result.height);
          }
        }
      }
    }

    // Update WebGPU textures: all sources batched into a single submission
    if (this.textureCaptureWebGPU && this.textureSourcesWebGPU.size > 0) {
      const entries: Array<{ key: string; texture: any }> = [];
      for (const [name, gpuTexture] of this.textureSourcesWebGPU) {
        if (this.texturePanels.has(name)) {
          entries.push({ key: name, texture: gpuTexture });
        }
      }
      if (entries.length > 0) {
        const results = await this.textureCaptureWebGPU.captureBatch(entries);
        for (const result of results) {
          const panel = this.texturePanels.get(result.key);
          if (panel) {
            panel.updatePixels(result.pixels, result.width, result.height);
          }
        }
      }
    }
  }

  /**
   * Capture StatsGL nodes registered by the addon
   */
  private captureStatsGLNodes(): void {
    const captures = (this as any)._statsGLCaptures as Map<string, any> | undefined;
    if (!captures || captures.size === 0 || !this.renderer) return;

    for (const captureData of captures.values()) {
      if (captureData.capture) {
        captureData.capture(this.renderer);
      }
    }
  }

  private detectVSync(currentTime: number): void {
    if (this.lastFrameTime === 0) {
      this.lastFrameTime = currentTime;
      return;
    }

    const frameTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    // Ignore pauses (tab switch, debugger) - one outlier would poison the
    // variance for the whole history window
    if (frameTime > 250) return;

    // Ring buffer write with running sum / sum of squares
    if (this.frameTimeCount === this.HISTORY_SIZE) {
      const evicted = this.frameTimeHistory[this.frameTimeIndex];
      this.frameTimeSum -= evicted;
      this.frameTimeSumSq -= evicted * evicted;
    } else {
      this.frameTimeCount++;
    }
    this.frameTimeHistory[this.frameTimeIndex] = frameTime;
    this.frameTimeSum += frameTime;
    this.frameTimeSumSq += frameTime * frameTime;
    this.frameTimeIndex = (this.frameTimeIndex + 1) % this.HISTORY_SIZE;

    // Periodically recompute the running sums to cancel float drift
    if (++this.frameTimeResync >= 600) {
      this.frameTimeResync = 0;
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < this.frameTimeCount; i++) {
        const t = this.frameTimeHistory[i];
        sum += t;
        sumSq += t * t;
      }
      this.frameTimeSum = sum;
      this.frameTimeSumSq = sumSq;
    }

    if (this.frameTimeCount < 60) return;

    const mean = this.frameTimeSum / this.frameTimeCount;
    const variance = Math.max(0, this.frameTimeSumSq / this.frameTimeCount - mean * mean);
    const stdDev = Math.sqrt(variance);

    // Relative stability gate (~2ms at 60Hz, scales with refresh rate)
    if (stdDev > mean * 0.12) {
      this.detectedVSync = null;
      return;
    }

    let closestMatch: VSyncInfo | null = null;
    let smallestDiff = Infinity;

    for (const rate of this.VSYNC_RATES) {
      const diff = Math.abs(mean - rate.frameTime);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        closestMatch = rate;
      }
    }

    if (closestMatch && (smallestDiff / closestMatch.frameTime <= this.VSYNC_THRESHOLD)) {
      this.detectedVSync = closestMatch;
    } else {
      this.detectedVSync = null;
    }
  }

  private updatePanelComponents(
    panel: Panel | null,
    averageArray: { logs: number[], graph: number[] },
    precision: number,
    shouldUpdateText: boolean,
    shouldUpdateGraph: boolean,
    suffix = ''
  ) {
    if (!panel || averageArray.logs.length === 0) return;
    if (!shouldUpdateText && !shouldUpdateGraph) return;

    const logs = averageArray.logs;
    const currentValue = logs[logs.length - 1];

    if (shouldUpdateText) {
      // EMA at text cadence: the gate makes smoothing wall-clock based,
      // independent of the frame rate
      panel.emaValue = panel.emaValue === null
        ? currentValue
        : panel.emaValue * 0.6 + currentValue * 0.4;

      panel.update(panel.emaValue, maxOf(logs), precision, suffix, minOf(logs));
    }

    if (shouldUpdateGraph) {
      // graph[] is already capped at samplesGraph by addToAverage
      const graphMax = Math.max(maxOf(logs), maxOf(averageArray.graph));
      panel.updateGraph(currentValue, graphMax);
    }
  }

  get domElement() {
    return this.dom;
  }

  /**
   * Dispose of all resources. Call when done using Stats.
   */
  public override dispose(): void {
    // Remove event listeners
    if (this.minimal) {
      this.dom.removeEventListener('click', this.handleClick);
    }

    // Dispose texture capture helpers
    if (this.textureCaptureWebGL) {
      this.textureCaptureWebGL.dispose();
      this.textureCaptureWebGL = null;
    }
    if (this.textureCaptureWebGPU) {
      this.textureCaptureWebGPU.dispose();
      this.textureCaptureWebGPU = null;
    }

    // Dispose all texture panels
    for (const panel of this.texturePanels.values()) {
      panel.dispose();
    }
    this.texturePanels.clear();
    this.textureSourcesWebGL.clear();
    this.textureSourcesWebGPU.clear();

    // Dispose StatsGL captures if any
    const captures = (this as any)._statsGLCaptures as Map<string, any> | undefined;
    if (captures) {
      for (const captureData of captures.values()) {
        if (captureData.dispose) {
          captureData.dispose();
        }
      }
      captures.clear();
    }

    // Remove DOM element
    if (this.texturePanelRow) {
      this.texturePanelRow.remove();
      this.texturePanelRow = null;
    }
    this.dom.remove();

    // Clear panel references
    this.panels.length = 0;
    this.fpsPanel = null;
    this.msPanel = null;
    this.gpuPanel = null;
    this.gpuPanelCompute = null;
    this.vramPanel = null;
    this.vsyncPanel = null;
    this.workerCpuPanel = null;
    this.vramMaxSeen = 0;

    // Reset tracking state
    this.frameTimeIndex = 0;
    this.frameTimeCount = 0;
    this.frameTimeSum = 0;
    this.frameTimeSumSq = 0;
    this.frameTimeResync = 0;
    this.lastFrameTime = 0;
    this.detectedVSync = null;
    this.externalData = null;
    this.hasNewExternalData = false;
    this.isWorker = false;
    this.averageWorkerCpu.logs.length = 0;
    this.averageWorkerCpu.graph.length = 0;

    // Call parent dispose
    super.dispose();
  }
}


export default Stats;
export type { StatsData, StatsCoreOptions, AverageData, InfoMemoryData } from './core';
export type { StatsOptions };
export { StatsProfiler } from './profiler';
export { Panel } from './panel';
export { PanelMemory } from './panelMemory';
export { PanelTexture } from './panelTexture';
export { TextureCaptureWebGL, TextureCaptureWebGPU } from './textureCapture';

