import { StatsCore, StatsCoreOptions, StatsData, AverageData } from './core';
import { Panel } from './panel';
import { PanelVSync } from './panelVsync';
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
}

interface VSyncInfo {
  refreshRate: number;
  frameTime: number;
}

class Stats extends StatsCore {
  public dom: HTMLDivElement;
  public mode: number;
  public horizontal: boolean;
  public minimal: boolean;

  private _panelId: number;
  private fpsPanel: Panel | null = null;
  private msPanel: Panel | null = null;
  private gpuPanel: Panel | null = null;
  private gpuPanelCompute: Panel | null = null;
  private vsyncPanel: PanelVSync | null = null;
  private workerCpuPanel: Panel | null = null;

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

  private updateCounter = 0;
  private lastMin: { [key: string]: number } = {};
  private lastMax: { [key: string]: number } = {};
  private lastValue: { [key: string]: number } = {};

  private readonly VSYNC_RATES: VSyncInfo[] = [
    { refreshRate: 60, frameTime: 16.67 },
    { refreshRate: 75, frameTime: 13.33 },
    { refreshRate: 90, frameTime: 11.11 },
    { refreshRate: 120, frameTime: 8.33 },
    { refreshRate: 144, frameTime: 6.94 },
    { refreshRate: 165, frameTime: 6.06 },
    { refreshRate: 240, frameTime: 4.17 }
  ];
  private detectedVSync: VSyncInfo | null = null;
  private frameTimeHistory: number[] = [];
  private readonly HISTORY_SIZE = 120;
  private readonly VSYNC_THRESHOLD = 0.05;
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
    logsPerSecond = 4,
    graphsPerSecond = 30,
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
      logsPerSecond,
      graphsPerSecond,
      samplesLog,
      samplesGraph,
      precision
    });

    this.mode = mode;
    this.horizontal = horizontal;
    this.minimal = minimal;

    this.dom = document.createElement('div');
    this.initializeDOM();

    this._panelId = 0;

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
    } else {
      window.addEventListener('resize', this.handleResize);
    }
  }

  private handleClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.showPanel(++this.mode % this.dom.children.length);
  };

  private handleResize = (): void => {
    if (this.fpsPanel) this.resizePanel(this.fpsPanel);
    if (this.msPanel) this.resizePanel(this.msPanel);
    if (this.workerCpuPanel) this.resizePanel(this.workerCpuPanel);
    if (this.gpuPanel) this.resizePanel(this.gpuPanel);
    if (this.gpuPanelCompute) this.resizePanel(this.gpuPanelCompute);
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

  public setData(data: StatsData): void {
    this.externalData = data;
    this.hasNewExternalData = true;

    // Dynamically add worker CPU panel right after main CPU panel
    if (!this.isWorker && this.msPanel) {
      this.isWorker = true;

      this.workerCpuPanel = new Stats.Panel('WRK', '#f90', '#220');
      const insertPosition = this.msPanel.id + 1;
      this.workerCpuPanel.id = insertPosition;

      // Shift IDs of panels that come after
      if (this.gpuPanel && this.gpuPanel.id >= insertPosition) {
        this.gpuPanel.id++;
        this.resizePanel(this.gpuPanel);
      }
      if (this.gpuPanelCompute && this.gpuPanelCompute.id >= insertPosition) {
        this.gpuPanelCompute.id++;
        this.resizePanel(this.gpuPanelCompute);
      }

      // Insert canvas after msPanel in DOM
      const msCanvas = this.msPanel.canvas;
      if (msCanvas.nextSibling) {
        this.dom.insertBefore(this.workerCpuPanel.canvas, msCanvas.nextSibling);
      } else {
        this.dom.appendChild(this.workerCpuPanel.canvas);
      }

      this.resizePanel(this.workerCpuPanel);
      this._panelId++;
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
    this.endProfiling('cpu-started', 'cpu-finished', 'cpu-duration');
    this.addToAverage(this.totalCpuDuration, this.averageCpu);
    this.totalCpuDuration = 0;

    // Only add worker data when new message arrived
    if (this.hasNewExternalData) {
      this.addToAverage(data.cpu, this.averageWorkerCpu);
      this.addToAverage(data.fps, this.averageFps);
      this.addToAverage(data.gpu, this.averageGpu);
      this.addToAverage(data.gpuCompute, this.averageGpuCompute);
      this.hasNewExternalData = false;
    }

    this.renderPanels();
  }

  private updateFromInternalData(): void {
    this.endProfiling('cpu-started', 'cpu-finished', 'cpu-duration');

    if (this.webgpuNative) {
      // Native WebGPU: resolve timestamps async
      this.resolveTimestampsAsync();
    } else if (!this.info) {
      this.processGpuQueries();
    } else {
      this.processWebGPUTimestamps();
    }

    this.updateAverages();
    this.resetCounters();
    this.renderPanels();
  }

  private renderPanels(): void {
    const currentTime = performance.now();

    // Only calculate FPS locally when not using worker data
    if (!this.isWorker) {
      this.frameTimes.push(currentTime);

      while (this.frameTimes.length > 0 && this.frameTimes[0] <= currentTime - 1000) {
        this.frameTimes.shift();
      }

      const fps = Math.round(this.frameTimes.length);
      this.addToAverage(fps, this.averageFps);
    }

    const shouldUpdateText = currentTime >= this.prevTextTime + 1000 / this.logsPerSecond;
    const shouldUpdateGraph = currentTime >= this.prevGraphTime + 1000 / this.graphsPerSecond;

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

    if (shouldUpdateText) {
      this.prevTextTime = currentTime;
    }
    if (shouldUpdateGraph) {
      this.prevGraphTime = currentTime;

      // Update texture panels at graph rate (prevent overlapping async updates)
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

      const vsyncValue = this.detectedVSync?.refreshRate || 0;

      if (shouldUpdateText && vsyncValue > 0) {
        this.vsyncPanel.update(vsyncValue, vsyncValue);
      }
    }
  }

  protected override resetCounters(): void {
    this.renderCount = 0;
    this.totalCpuDuration = 0;
    this.beginTime = performance.now();
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
      panel.id = this._panelId;
      this.resizePanel(panel);
      this._panelId++;
    }
    return panel;
  }

  showPanel(id: number) {
    for (let i = 0; i < this.dom.children.length; i++) {
      const child = this.dom.children[i] as HTMLElement;
      child.style.display = i === id ? 'block' : 'none';
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
    }
  }

  /**
   * Capture and update all texture panels
   * Called automatically during renderPanels at graphsPerSecond rate
   */
  private async updateTexturePanels(): Promise<void> {
    // Check for renderer dimension changes every frame
    this.updateTexturePreviewDimensions();

    // Update WebGL textures
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

          const bitmap = await this.textureCaptureWebGL.capture(framebuffer, width, height, name);
          if (bitmap) {
            panel.updateTexture(bitmap);
          }
        }
      }
    }

    // Update WebGPU textures
    if (this.textureCaptureWebGPU) {
      for (const [name, gpuTexture] of this.textureSourcesWebGPU) {
        const panel = this.texturePanels.get(name);
        if (panel) {
          const bitmap = await this.textureCaptureWebGPU.capture(gpuTexture);
          if (bitmap) {
            panel.updateTexture(bitmap);
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

    this.frameTimeHistory.push(frameTime);
    if (this.frameTimeHistory.length > this.HISTORY_SIZE) {
      this.frameTimeHistory.shift();
    }

    if (this.frameTimeHistory.length < 60) return;

    const avgFrameTime = this.frameTimeHistory.reduce((a, b) => a + b) / this.frameTimeHistory.length;

    const variance = this.frameTimeHistory.reduce((acc, time) =>
      acc + Math.pow(time - avgFrameTime, 2), 0) / this.frameTimeHistory.length;
    const stability = Math.sqrt(variance);

    if (stability > 2) {
      this.detectedVSync = null;
      return;
    }

    let closestMatch: VSyncInfo | null = null;
    let smallestDiff = Infinity;

    for (const rate of this.VSYNC_RATES) {
      const diff = Math.abs(avgFrameTime - rate.frameTime);
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

    // Use panel.id as key to avoid collision between panels with same name
    const key = String(panel.id);

    if (!(key in this.lastMin)) {
      this.lastMin[key] = Infinity;
      this.lastMax[key] = 0;
      this.lastValue[key] = 0;
    }

    const currentValue = averageArray.logs[averageArray.logs.length - 1];

    this.lastMax[key] = Math.max(...averageArray.logs);
    this.lastMin[key] = Math.min(this.lastMin[key], currentValue);
    this.lastValue[key] = this.lastValue[key] * 0.7 + currentValue * 0.3;

    const graphMax = Math.max(
      Math.max(...averageArray.logs),
      ...averageArray.graph.slice(-this.samplesGraph)
    );

    this.updateCounter++;

    if (shouldUpdateText) {
      panel.update(
        this.lastValue[key],
        this.lastMax[key],
        precision,
        suffix
      );
    }

    if (shouldUpdateGraph) {
      panel.updateGraph(
        currentValue,
        graphMax
      );
    }
  }

  updatePanel(panel: { update: any; updateGraph: any; name: string; } | null, averageArray: { logs: number[], graph: number[] }, precision = 2) {
    if (!panel || averageArray.logs.length === 0) return;

    const currentTime = performance.now();

    if (!(panel.name in this.lastMin)) {
      this.lastMin[panel.name] = Infinity;
      this.lastMax[panel.name] = 0;
      this.lastValue[panel.name] = 0;
    }

    const currentValue = averageArray.logs[averageArray.logs.length - 1];
    const recentMax = Math.max(...averageArray.logs.slice(-30));

    this.lastMin[panel.name] = Math.min(this.lastMin[panel.name], currentValue);
    this.lastMax[panel.name] = Math.max(this.lastMax[panel.name], currentValue);

    this.lastValue[panel.name] = this.lastValue[panel.name] * 0.7 + currentValue * 0.3;

    const graphMax = Math.max(recentMax, ...averageArray.graph.slice(-this.samplesGraph));

    this.updateCounter++;

    if (this.updateCounter % (this.logsPerSecond * 2) === 0) {
      this.lastMax[panel.name] = recentMax;
      this.lastMin[panel.name] = currentValue;
    }

    if (panel.update) {
      if (currentTime >= this.prevCpuTime + 1000 / this.logsPerSecond) {
        panel.update(
          this.lastValue[panel.name],
          currentValue,
          this.lastMax[panel.name],
          graphMax,
          precision
        );
      }

      if (currentTime >= this.prevGraphTime + 1000 / this.graphsPerSecond) {
        panel.updateGraph(
          currentValue,
          graphMax
        );
        this.prevGraphTime = currentTime;
      }
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
    } else {
      window.removeEventListener('resize', this.handleResize);
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
    this.fpsPanel = null;
    this.msPanel = null;
    this.gpuPanel = null;
    this.gpuPanelCompute = null;
    this.vsyncPanel = null;
    this.workerCpuPanel = null;

    // Clear tracking arrays
    this.frameTimeHistory.length = 0;
    this.averageWorkerCpu.logs.length = 0;
    this.averageWorkerCpu.graph.length = 0;

    // Call parent dispose
    super.dispose();
  }
}


export default Stats;
export type { StatsData } from './core';
export { StatsProfiler } from './profiler';
export { PanelTexture } from './panelTexture';
export { TextureCaptureWebGL, TextureCaptureWebGPU } from './textureCapture';
export { StatsGLCapture } from './statsGLNode';

