import Panel from "./panel";
import * as THREE from 'three';
export interface AverageArray {
  logs: number[];
  graph: number[];
}


class Stats {
  totalCpuDuration: number = 0;
  totalGpuDuration: number = 0;
  totalGpuDurationCompute: number = 0;
  totalFps: number = 0;
  mode: number;
  info: any;
  dom: HTMLDivElement;
  minimal: boolean;
  horizontal: boolean;
  beginTime: number;
  prevTime: number;
  prevCpuTime: number;
  frames: number;
  averageCpu: AverageArray;
  averageGpu: AverageArray;
  averageGpuCompute: AverageArray;
  queryCreated: boolean;
  isRunningCPUProfiling: boolean;
  fpsPanel: Panel;
  static Panel: typeof Panel = Panel;
  msPanel: Panel;
  gpuPanel: Panel | null;
  gpuPanelCompute: Panel | null;
  samplesLog: number;
  samplesGraph: number;
  logsPerSecond: number;
  activeQuery: WebGLQuery | null = null;

  precision: number;
  gl: WebGL2RenderingContext | null;
  ext: any;
  query: WebGLQuery | null;
  disjoint: any;
  ns: any;
  threeRendererPatched: boolean;
  gpuQueries: { query: WebGLQuery }[] = [];
  renderCount: number = 0;

  constructor({ logsPerSecond = 20, samplesLog = 100, samplesGraph = 10, precision = 2, minimal = false, horizontal = true, mode = 0 } = {}) {

    this.mode = mode;
    this.horizontal = horizontal;
    this.dom = document.createElement('div');
    this.dom.style.cssText = 'position:fixed;top:0;left:0;opacity:0.9;z-index:10000;';

    if (minimal) {

      this.dom.style.cssText += 'cursor:pointer';

    }

    this.gl = null;
    this.query = null;

    this.isRunningCPUProfiling = false;
    this.minimal = minimal;

    this.beginTime = (performance || Date).now();
    this.prevTime = this.beginTime;
    this.prevCpuTime = this.beginTime;
    this.frames = 0;
    this.renderCount = 0;
    this.threeRendererPatched = false;
    this.averageCpu = {
      logs: [],
      graph: []
    };
    this.averageGpu = {
      logs: [],
      graph: []
    };
    this.averageGpuCompute = {
      logs: [],
      graph: []
    };

    this.queryCreated = false;

    this.fpsPanel = this.addPanel(new Stats.Panel('FPS', '#0ff', '#002'), 0);
    this.msPanel = this.addPanel(new Stats.Panel('CPU', '#0f0', '#020'), 1);
    this.gpuPanel = null;
    this.gpuPanelCompute = null;

    this.samplesLog = samplesLog;
    this.samplesGraph = samplesGraph;
    this.precision = precision;
    this.logsPerSecond = logsPerSecond;

    if (this.minimal) {

      this.dom.addEventListener('click', (event) => {

        event.preventDefault();
        this.showPanel(++this.mode % this.dom.children.length);

      }, false);

      this.mode = mode;
      this.showPanel(this.mode);

    } else {

      window.addEventListener('resize', () => {

        this.resizePanel(this.fpsPanel, 0);
        this.resizePanel(this.msPanel, 1);

        if (this.gpuPanel) {
          this.resizePanel(this.gpuPanel, 2);
        }
        if (this.gpuPanelCompute) {
          this.resizePanel(this.gpuPanelCompute, 3);
        }
      })
    }


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

  async init(canvasOrGL: any) {
    if (!canvasOrGL) {
      console.error('Stats: The "canvas" parameter is undefined.');
      return;
    }


    // if ((canvasOrGL as any).isWebGPURenderer && !this.threeRendererPatched) {
    // TODO Color GPU Analytic in another color than yellow to know webgpu or webgl context (blue)
    //   const canvas: any = canvasOrGL
    //   this.patchThreeRenderer(canvas as any);
    //   this.gl = canvas.getContext();
    // } else 
    if ((canvasOrGL as any).isWebGLRenderer && !this.threeRendererPatched) {
      const canvas: any = canvasOrGL
      this.patchThreeRenderer(canvas as any);
      this.gl = canvas.getContext();
    } else if (!this.gl && canvasOrGL instanceof WebGL2RenderingContext) {
      this.gl = canvasOrGL;
    }

    if (canvasOrGL.isWebGPURenderer) {

      canvasOrGL.backend.trackTimestamp = true

      if (await canvasOrGL.hasFeatureAsync('timestamp-query')) {
        this.gpuPanel = this.addPanel(new Stats.Panel('GPU', '#ff0', '#220'), 2);
        this.gpuPanelCompute = this.addPanel(new Stats.Panel('CPT', '#e1e1e1', '#212121'), 3);
        this.info = canvasOrGL.info
      }
      return;
    }
    // Check if canvasOrGL is already a WebGL2RenderingContext


    // Handle HTMLCanvasElement and OffscreenCanvas
    else if (!this.gl && canvasOrGL instanceof HTMLCanvasElement || canvasOrGL instanceof OffscreenCanvas) {
      this.gl = canvasOrGL.getContext('webgl2') as WebGL2RenderingContext;
      if (!this.gl) {
        console.error('Stats: Unable to obtain WebGL2 context.');
        return;
      }
    } else if (!this.gl) {
      console.error('Stats: Invalid input type. Expected WebGL2RenderingContext, HTMLCanvasElement, or OffscreenCanvas.');
      return;
    }

    // Get the extension
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (this.ext) {
      this.gpuPanel = this.addPanel(new Stats.Panel('GPU', '#ff0', '#220'), 2);
    }
  }


  begin() {

    if (!this.isRunningCPUProfiling) {
      this.beginProfiling('cpu-started');
    }

    if (!this.gl || !this.ext) return;

    if (this.gl && this.ext) {
      if (this.activeQuery) {
        // End the previous query if it's still active
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      }

      this.activeQuery = this.gl.createQuery();
      if (this.activeQuery !== null) {
        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.activeQuery);
      }
    }
  }



  end() {

    // Increase render count
    this.renderCount++;

    if (this.gl && this.ext && this.activeQuery) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      // Add the active query to the gpuQueries array and reset it
      this.gpuQueries.push({ query: this.activeQuery });
      this.activeQuery = null;
    }

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

  update() {

    if (this.info === undefined) {
      this.processGpuQueries();
    } else {

      this.totalGpuDuration = this.info.render.timestamp
      this.totalGpuDurationCompute = this.info.compute.timestamp
      this.addToAverage(this.totalGpuDurationCompute, this.averageGpuCompute);

    }

    this.endProfiling('cpu-started', 'cpu-finished', 'cpu-duration');

    // Calculate the total duration of CPU and GPU work for this frame
    this.addToAverage(this.totalCpuDuration, this.averageCpu);
    this.addToAverage(this.totalGpuDuration, this.averageGpu);

    this.renderCount = 0;

    // If this.totalCpuDuration is 0, it means that the CPU query was not created and stats.begin() never called/overrided
    if (this.totalCpuDuration === 0) {
      this.beginProfiling('cpu-started');
    }

    this.totalCpuDuration = 0;

    this.totalFps = 0;

    this.beginTime = this.endInternal()

  }

  endInternal() {

    this.frames++;
    const time = (performance || Date).now();

    if (time >= this.prevCpuTime + 1000 / this.logsPerSecond) {
      this.updatePanel(this.msPanel, this.averageCpu);
      this.updatePanel(this.gpuPanel, this.averageGpu);

      if (this.gpuPanelCompute) {
        this.updatePanel(this.gpuPanelCompute, this.averageGpuCompute);
      }

      this.prevCpuTime = time;
    }

    if (time >= this.prevTime + 1000) {

      const fps = (this.frames * 1000) / (time - this.prevTime);

      this.fpsPanel.update(fps, fps, 100, 100, 0);

      this.prevTime = time;
      this.frames = 0;

    }

    return time;

  }

  addToAverage(value: number, averageArray: { logs: any; graph: any; }) {

    averageArray.logs.push(value);
    if (averageArray.logs.length > this.samplesLog) {

      averageArray.logs.shift();

    }

    averageArray.graph.push(value);
    if (averageArray.graph.length > this.samplesGraph) {

      averageArray.graph.shift();

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

  updatePanel(panel: { update: any; } | null, averageArray: { logs: number[], graph: number[] }) {

    if (averageArray.logs.length > 0) {

      let sumLog = 0;
      let max = 0.01;

      for (let i = 0; i < averageArray.logs.length; i++) {

        sumLog += averageArray.logs[i];

        if (averageArray.logs[i] > max) {
          max = averageArray.logs[i];
        }

      }

      let sumGraph = 0;
      let maxGraph = 0.01;
      for (let i = 0; i < averageArray.graph.length; i++) {

        sumGraph += averageArray.graph[i];

        if (averageArray.graph[i] > maxGraph) {
          maxGraph = averageArray.graph[i];
        }

      }

      if (panel) {
        panel.update(sumLog / Math.min(averageArray.logs.length, this.samplesLog), sumGraph / Math.min(averageArray.graph.length, this.samplesGraph), max, maxGraph, this.precision);
      }

    }
  }

  get domElement() {
    // patch for some use case in threejs
    return this.dom;

  }

  get container() { // @deprecated

    console.warn('Stats: Deprecated! this.container as been replaced to this.dom ')
    return this.dom;

  }

}


export default Stats;