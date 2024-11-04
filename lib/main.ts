import type * as THREE from 'three';
import { Panel } from './panel';

interface StatsOptions {
  trackGPU?: boolean;
  logsPerSecond?: number;
  graphsPerSecond?: number;
  samplesLog?: number;
  samplesGraph?: number;
  precision?: number;
  minimal?: boolean;
  horizontal?: boolean;
  mode?: number;
}

interface QueryInfo {
  query: WebGLQuery;
}

interface AverageData {
  logs: number[];
  graph: number[];
}

interface InfoData {
  render: {
    timestamp: number;
  };
  compute: {
    timestamp: number;
  };
}

class Stats {
  public dom: HTMLDivElement;
  public mode: number;
  public horizontal: boolean;
  public minimal: boolean;
  public trackGPU: boolean;
  public samplesLog: number;
  public samplesGraph: number;
  public precision: number;
  public logsPerSecond: number;
  public graphsPerSecond: number;

  public gl: WebGL2RenderingContext | null = null;
  public ext: any | null = null;
  public info?: InfoData;
  private activeQuery: WebGLQuery | null = null;
  private gpuQueries: QueryInfo[] = [];
  private threeRendererPatched = false;

  private beginTime: number;
  private prevCpuTime: number;
  private frameTimes: number[] = [];  // Store frame timestamps

  private renderCount = 0;
  private isRunningCPUProfiling = false;

  private totalCpuDuration = 0;
  private totalGpuDuration = 0;
  private totalGpuDurationCompute = 0;

  private fpsPanel: Panel;
  private msPanel: Panel;
  private gpuPanel: Panel | null = null;
  private gpuPanelCompute: Panel | null = null;

  public averageFps: AverageData = { logs: [], graph: [] };
  public averageCpu: AverageData = { logs: [], graph: [] };
  public averageGpu: AverageData = { logs: [], graph: [] };
  public averageGpuCompute: AverageData = { logs: [], graph: [] };

  private updateCounter = 0;
  private prevGraphTime: number;
  private lastMin: { [key: string]: number } = {};
  private lastMax: { [key: string]: number } = {};
  private lastValue: { [key: string]: number } = {};
  private prevTextTime: number;


  static Panel = Panel;

  constructor({
    trackGPU = false,
    logsPerSecond = 4,
    graphsPerSecond = 30,
    samplesLog = 40,
    samplesGraph = 10,
    precision = 2,
    minimal = false,
    horizontal = true,
    mode = 0
  }: StatsOptions = {}) {
    this.mode = mode;
    this.horizontal = horizontal;
    this.minimal = minimal;
    this.trackGPU = trackGPU;
    this.samplesLog = samplesLog;
    this.samplesGraph = samplesGraph;
    this.precision = precision;
    this.logsPerSecond = logsPerSecond;
    this.graphsPerSecond = graphsPerSecond;
    const prevGraphTime = performance.now();
    this.prevGraphTime = prevGraphTime

    // Initialize DOM
    this.dom = document.createElement('div');
    this.initializeDOM();

    // Initialize timing
    this.beginTime = performance.now();
    this.prevTextTime = this.beginTime;

    this.prevCpuTime = this.beginTime;

    // Create panels
    this.fpsPanel = this.addPanel(new Stats.Panel('FPS', '#0ff', '#002'), 0);
    this.msPanel = this.addPanel(new Stats.Panel('CPU', '#0f0', '#020'), 1);

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
    this.resizePanel(this.fpsPanel, 0);
    this.resizePanel(this.msPanel, 1);
    if (this.gpuPanel) this.resizePanel(this.gpuPanel, 2);
    if (this.gpuPanelCompute) this.resizePanel(this.gpuPanelCompute, 3);
  };

  public async init(
    canvasOrGL: WebGL2RenderingContext | HTMLCanvasElement | OffscreenCanvas | any
  ): Promise<void> {
    if (!canvasOrGL) {
      console.error('Stats: The "canvas" parameter is undefined.');
      return;
    }

    if (this.handleThreeRenderer(canvasOrGL)) return;
    if (await this.handleWebGPURenderer(canvasOrGL)) return;
    if (!this.initializeWebGL(canvasOrGL)) return;

  }

  private handleThreeRenderer(renderer: any): boolean {
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

  private async handleWebGPURenderer(renderer: any): Promise<boolean> {
    if (renderer.isWebGPURenderer) {
      if (this.trackGPU) {
        renderer.backend.trackTimestamp = true;
        if (await renderer.hasFeatureAsync('timestamp-query')) {
          this.initializeWebGPUPanels();
        }
      }
      this.info = renderer.info;
      return true;
    }
    return false;
  }

  private initializeWebGPUPanels(): void {
    this.gpuPanel = this.addPanel(new Stats.Panel('GPU', '#ff0', '#220'), 2);
    this.gpuPanelCompute = this.addPanel(
      new Stats.Panel('CPT', '#e1e1e1', '#212121'),
      3
    );
  }

  private initializeWebGL(
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

  private initializeGPUTracking(): void {
    if (this.gl) {
      this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (this.ext) {
        this.gpuPanel = this.addPanel(new Stats.Panel('GPU', '#ff0', '#220'), 2);
      }
    }
  }

  public begin(): void {
    if (!this.isRunningCPUProfiling) {
      this.beginProfiling('cpu-started');
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

  public end(): void {
    this.renderCount++;
    if (this.gl && this.ext && this.activeQuery) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gpuQueries.push({ query: this.activeQuery });
      this.activeQuery = null;
    }
  }

  public update(): void {
    // Always end the current CPU profiling if it's running
    if (this.isRunningCPUProfiling) {
      this.endProfiling('cpu-started', 'cpu-finished', 'cpu-duration');
      // Add to averages immediately after getting the duration
      // this.addToAverage(this.totalCpuDuration, this.averageCpu);
    }

    if (!this.info) {
      this.processGpuQueries();
    } else {
      this.processWebGPUTimestamps();
    }

    this.updateAverages()
    this.resetCounters();
  }

  private processWebGPUTimestamps(): void {
    this.totalGpuDuration = this.info!.render.timestamp;
    this.totalGpuDurationCompute = this.info!.compute.timestamp;
  }

  private resetCounters(): void {
    this.renderCount = 0;
    this.totalCpuDuration = 0;
    this.beginProfiling('cpu-started');
    this.beginTime = this.endInternal();
  }

  resizePanel(panel: Panel, offset: number) {

    panel.canvas.style.position = 'absolute';

    if (this.minimal) {

      panel.canvas.style.display = 'none';

    } else {

      panel.canvas.style.display = 'block';
      if (this.horizontal) {
        panel.canvas.style.top = '0px';
        panel.canvas.style.left = offset * panel.WIDTH / panel.PR + 'px';
      } else {
        panel.canvas.style.left = '0px';
        panel.canvas.style.top = offset * panel.HEIGHT / panel.PR + 'px';

      }
    }

  }
  addPanel(panel: Panel, offset: number) {

    if (panel.canvas) {

      this.dom.appendChild(panel.canvas);

      this.resizePanel(panel, offset);

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

  processGpuQueries() {


    if (!this.gl || !this.ext) return;

    this.totalGpuDuration = 0;

    this.gpuQueries.forEach((queryInfo, index) => {
      if (this.gl) {
        const available = this.gl.getQueryParameter(queryInfo.query, this.gl.QUERY_RESULT_AVAILABLE);
        const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);

        if (available && !disjoint) {
          const elapsed = this.gl.getQueryParameter(queryInfo.query, this.gl.QUERY_RESULT);
          const duration = elapsed * 1e-6;  // Convert nanoseconds to milliseconds
          this.totalGpuDuration += duration;
          this.gl.deleteQuery(queryInfo.query);
          this.gpuQueries.splice(index, 1);  // Remove the processed query
        }
      }
    });

  }

  endInternal() {
    const currentTime = performance.now();

    this.frameTimes.push(currentTime);

    // Remove frames older than 1 second
    while (this.frameTimes.length > 0 && this.frameTimes[0] <= currentTime - 1000) {
      this.frameTimes.shift();
    }

    // Calculate FPS based on frames in the last second
    const fps = Math.round(this.frameTimes.length);

    this.addToAverage(fps, this.averageFps);

    const shouldUpdateText = currentTime >= this.prevTextTime + 1000 / this.logsPerSecond;
    const shouldUpdateGraph = currentTime >= this.prevGraphTime + 1000 / this.graphsPerSecond;

    this.updatePanelComponents(this.fpsPanel, this.averageFps, 0, shouldUpdateText, shouldUpdateGraph);
    this.updatePanelComponents(this.msPanel, this.averageCpu, this.precision, shouldUpdateText, shouldUpdateGraph);
    if (this.gpuPanel) {
      this.updatePanelComponents(this.gpuPanel, this.averageGpu, this.precision, shouldUpdateText, shouldUpdateGraph);
    }
    if (this.gpuPanelCompute) {
      this.updatePanelComponents(this.gpuPanelCompute, this.averageGpuCompute, this.precision, shouldUpdateText, shouldUpdateGraph);
    }

    if (shouldUpdateText) {
      this.prevTextTime = currentTime;
    }
    if (shouldUpdateGraph) {
      this.prevGraphTime = currentTime;
    }

    return currentTime;
  }

  private updatePanelComponents(
    panel: Panel | null,
    averageArray: { logs: number[], graph: number[] },
    precision: number,
    shouldUpdateText: boolean,
    shouldUpdateGraph: boolean
  ) {
    if (!panel || averageArray.logs.length === 0) return;

    // Initialize tracking for this panel if not exists
    if (!(panel.name in this.lastMin)) {
      this.lastMin[panel.name] = Infinity;
      this.lastMax[panel.name] = 0;
      this.lastValue[panel.name] = 0;
    }

    const currentValue = averageArray.logs[averageArray.logs.length - 1];

    this.lastMax[panel.name] = Math.max(...averageArray.logs);
    this.lastMin[panel.name] = Math.min(this.lastMin[panel.name], currentValue);
    // Smooth the display value
    this.lastValue[panel.name] = this.lastValue[panel.name] * 0.7 + currentValue * 0.3;

    // Calculate graph max considering both recent values and graph history
    const graphMax = Math.max(
      Math.max(...averageArray.logs),
      ...averageArray.graph.slice(-this.samplesGraph)
    );

    this.updateCounter++;

    // Update text if it's time
    if (shouldUpdateText) {
      panel.update(
        this.lastValue[panel.name],
        this.lastMax[panel.name],
        precision
      );
    }

    // Update graph if it's time
    if (shouldUpdateGraph) {
      panel.updateGraph(
        currentValue,
        graphMax
      );
    }
  }

  beginProfiling(marker: string) {

    if (window.performance) {

      window.performance.mark(marker);
      this.isRunningCPUProfiling = true

    }

  }

  endProfiling(startMarker: string | PerformanceMeasureOptions | undefined, endMarker: string | undefined, measureName: string) {

    if (window.performance && endMarker && this.isRunningCPUProfiling) {

      window.performance.mark(endMarker);
      const cpuMeasure = performance.measure(measureName, startMarker, endMarker);
      this.totalCpuDuration += cpuMeasure.duration;
      this.isRunningCPUProfiling = false

    }

  }

  updatePanel(panel: { update: any; updateGraph: any; name: string; } | null, averageArray: { logs: number[], graph: number[] }, precision = 2) {
    if (!panel || averageArray.logs.length === 0) return;

    const currentTime = performance.now();

    // Initialize tracking for this panel if not exists
    if (!(panel.name in this.lastMin)) {
      this.lastMin[panel.name] = Infinity;
      this.lastMax[panel.name] = 0;
      this.lastValue[panel.name] = 0;
    }

    // Get the current value and recent max
    const currentValue = averageArray.logs[averageArray.logs.length - 1];
    const recentMax = Math.max(...averageArray.logs.slice(-30));

    // Update running statistics
    this.lastMin[panel.name] = Math.min(this.lastMin[panel.name], currentValue);
    this.lastMax[panel.name] = Math.max(this.lastMax[panel.name], currentValue);

    // Smooth the display value
    this.lastValue[panel.name] = this.lastValue[panel.name] * 0.7 + currentValue * 0.3;

    // Calculate graph scaling value
    const graphMax = Math.max(recentMax, ...averageArray.graph.slice(-this.samplesGraph));

    this.updateCounter++;

    // Reset min/max periodically
    if (this.updateCounter % (this.logsPerSecond * 2) === 0) {
      this.lastMax[panel.name] = recentMax;
      this.lastMin[panel.name] = currentValue;
    }

    if (panel.update) {
      // Check if it's time to update the text (based on logsPerSecond)
      if (currentTime >= this.prevCpuTime + 1000 / this.logsPerSecond) {
        panel.update(
          this.lastValue[panel.name],
          currentValue,
          this.lastMax[panel.name],
          graphMax,
          precision
        );
      }

      // Check if it's time to update the graph (based on graphsPerSecond)
      if (currentTime >= this.prevGraphTime + 1000 / this.graphsPerSecond) {
        panel.updateGraph(
          currentValue,
          graphMax
        );
        this.prevGraphTime = currentTime;
      }
    }
  }

  private updateAverages(): void {
    this.addToAverage(this.totalCpuDuration, this.averageCpu);
    this.addToAverage(this.totalGpuDuration, this.averageGpu);
    // Add GPU Compute to the main update flow
    if (this.info && this.totalGpuDurationCompute !== undefined) {
      this.addToAverage(this.totalGpuDurationCompute, this.averageGpuCompute);
    }
  }

  addToAverage(value: number, averageArray: { logs: any; graph: any; }) {
    // Validate value
    // if (value === undefined || value === null || isNaN(value)) {
    //   return;
    // }

    // Store raw values for logs
    averageArray.logs.push(value);
    if (averageArray.logs.length > this.samplesLog) {
      averageArray.logs = averageArray.logs.slice(-this.samplesLog);
    }

    // For graph, store raw values
    averageArray.graph.push(value);
    if (averageArray.graph.length > this.samplesGraph) {
      averageArray.graph = averageArray.graph.slice(-this.samplesGraph);
    }
  }

  get domElement() {
    // patch for some use case in threejs
    return this.dom;

  }

  patchThreeRenderer(renderer: any) {

    // Store the original render method
    const originalRenderMethod = renderer.render;

    // Reference to the stats instance
    const statsInstance = this;

    // Override the render method on the prototype
    renderer.render = function (scene: THREE.Scene, camera: THREE.Camera) {


      statsInstance.begin(); // Start tracking for this render call

      // Call the original render method
      originalRenderMethod.call(this, scene, camera);

      statsInstance.end(); // End tracking for this render call
    };


    this.threeRendererPatched = true;

  }
}


export default Stats;
