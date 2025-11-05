import Panel from './panel.js';
const _Stats = class _Stats2 {
  constructor({
    logsPerSecond = 20,
    samplesLog = 100,
    samplesGraph = 10,
    precision = 2,
    minimal = false,
    horizontal = true,
    mode = 0,
  } = {}) {
    this.totalCpuDuration = 0;
    this.totalGpuDuration = 0;
    this.totalGpuDurationCompute = 0;
    this.totalFps = 0;
    this.activeQuery = null;
    this.gpuQueries = [];
    this.renderCount = 0;
    this.mode = mode;
    this.horizontal = horizontal;
    this.dom = document.createElement('div');
    this.dom.style.cssText =
      'position:fixed;top:0;left:0;opacity:0.9;z-index:10000;';
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
      graph: [],
    };
    this.averageGpu = {
      logs: [],
      graph: [],
    };
    this.averageGpuCompute = {
      logs: [],
      graph: [],
    };
    this.queryCreated = false;
    this.fpsPanel = this.addPanel(new _Stats2.Panel('FPS', '#0ff', '#002'), 0);
    this.msPanel = this.addPanel(new _Stats2.Panel('CPU', '#0f0', '#020'), 1);
    this.gpuPanel = null;
    this.gpuPanelCompute = null;
    this.samplesLog = samplesLog;
    this.samplesGraph = samplesGraph;
    this.precision = precision;
    this.logsPerSecond = logsPerSecond;
    if (this.minimal) {
      this.dom.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          this.showPanel(++this.mode % this.dom.children.length);
        },
        false
      );
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
      });
    }
  }
  patchThreeRenderer(renderer) {
    const originalRenderMethod = renderer.render;
    const statsInstance = this;
    renderer.render = function (scene, camera) {
      statsInstance.begin();
      originalRenderMethod.call(this, scene, camera);
      statsInstance.end();
    };
    this.threeRendererPatched = true;
  }
  resizePanel(panel, offset) {
    panel.canvas.style.position = 'absolute';
    if (this.minimal) {
      panel.canvas.style.display = 'none';
    } else {
      panel.canvas.style.display = 'block';
      if (this.horizontal) {
        panel.canvas.style.top = '0px';
        panel.canvas.style.left = (offset * panel.WIDTH) / panel.PR + 'px';
      } else {
        panel.canvas.style.left = '0px';
        panel.canvas.style.top = (offset * panel.HEIGHT) / panel.PR + 'px';
      }
    }
  }
  addPanel(panel, offset) {
    if (panel.canvas) {
      this.dom.appendChild(panel.canvas);
      this.resizePanel(panel, offset);
    }
    return panel;
  }
  showPanel(id) {
    for (let i = 0; i < this.dom.children.length; i++) {
      const child = this.dom.children[i];
      child.style.display = i === id ? 'block' : 'none';
    }
    this.mode = id;
  }
  async init(canvasOrGL) {
    if (!canvasOrGL) {
      console.error('Stats: The "canvas" parameter is undefined.');
      return;
    }
    if (canvasOrGL.isWebGLRenderer && !this.threeRendererPatched) {
      const canvas = canvasOrGL;
      this.patchThreeRenderer(canvas);
      this.gl = canvas.getContext();
    } else if (!this.gl && canvasOrGL instanceof WebGL2RenderingContext) {
      this.gl = canvasOrGL;
    }
    if (canvasOrGL.isWebGPURenderer) {
      canvasOrGL.backend.trackTimestamp = true;
      if (canvasOrGL.hasFeature('timestamp-query')) {
        this.gpuPanel = this.addPanel(
          new _Stats2.Panel('GPU', '#ff0', '#220'),
          2
        );
        this.gpuPanelCompute = this.addPanel(
          new _Stats2.Panel('CPT', '#e1e1e1', '#212121'),
          3
        );
        this.info = canvasOrGL.info;
      }
      return;
    } else if (
      (!this.gl && canvasOrGL instanceof HTMLCanvasElement) ||
      canvasOrGL instanceof OffscreenCanvas
    ) {
      this.gl = canvasOrGL.getContext('webgl2');
      if (!this.gl) {
        console.error('Stats: Unable to obtain WebGL2 context.');
        return;
      }
    } else if (!this.gl) {
      console.error(
        'Stats: Invalid input type. Expected WebGL2RenderingContext, HTMLCanvasElement, or OffscreenCanvas.'
      );
      return;
    }
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (this.ext) {
      this.gpuPanel = this.addPanel(
        new _Stats2.Panel('GPU', '#ff0', '#220'),
        2
      );
    }
  }
  begin() {
    if (!this.isRunningCPUProfiling) {
      this.beginProfiling('cpu-started');
    }
    if (!this.gl || !this.ext) return;
    if (this.gl && this.ext) {
      if (this.activeQuery) {
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      }
      this.activeQuery = this.gl.createQuery();
      if (this.activeQuery !== null) {
        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.activeQuery);
      }
    }
  }
  end() {
    this.renderCount++;
    if (this.gl && this.ext && this.activeQuery) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gpuQueries.push({ query: this.activeQuery });
      this.activeQuery = null;
    }
  }
  processGpuQueries() {
    if (!this.gl || !this.ext) return;
    this.totalGpuDuration = 0;
    this.gpuQueries.forEach((queryInfo, index) => {
      if (this.gl) {
        const available = this.gl.getQueryParameter(
          queryInfo.query,
          this.gl.QUERY_RESULT_AVAILABLE
        );
        const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
        if (available && !disjoint) {
          const elapsed = this.gl.getQueryParameter(
            queryInfo.query,
            this.gl.QUERY_RESULT
          );
          const duration = elapsed * 1e-6;
          this.totalGpuDuration += duration;
          this.gl.deleteQuery(queryInfo.query);
          this.gpuQueries.splice(index, 1);
        }
      }
    });
  }
  update() {
    if (this.info === void 0) {
      this.processGpuQueries();
    } else {
      this.totalGpuDuration = this.info.render.timestamp;
      this.totalGpuDurationCompute = this.info.compute.timestamp;
      this.addToAverage(this.totalGpuDurationCompute, this.averageGpuCompute);
    }
    this.endProfiling('cpu-started', 'cpu-finished', 'cpu-duration');
    this.addToAverage(this.totalCpuDuration, this.averageCpu);
    this.addToAverage(this.totalGpuDuration, this.averageGpu);
    this.renderCount = 0;
    if (this.totalCpuDuration === 0) {
      this.beginProfiling('cpu-started');
    }
    this.totalCpuDuration = 0;
    this.totalFps = 0;
    this.beginTime = this.endInternal();
  }
  endInternal() {
    this.frames++;
    const time = (performance || Date).now();
    if (time >= this.prevCpuTime + 1e3 / this.logsPerSecond) {
      this.updatePanel(this.msPanel, this.averageCpu);
      this.updatePanel(this.gpuPanel, this.averageGpu);
      if (this.gpuPanelCompute) {
        this.updatePanel(this.gpuPanelCompute, this.averageGpuCompute);
      }
      this.prevCpuTime = time;
    }
    if (time >= this.prevTime + 1e3) {
      const fps = (this.frames * 1e3) / (time - this.prevTime);
      this.fpsPanel.update(fps, fps, 100, 100, 0);
      this.prevTime = time;
      this.frames = 0;
    }
    return time;
  }
  addToAverage(value, averageArray) {
    averageArray.logs.push(value);
    if (averageArray.logs.length > this.samplesLog) {
      averageArray.logs.shift();
    }
    averageArray.graph.push(value);
    if (averageArray.graph.length > this.samplesGraph) {
      averageArray.graph.shift();
    }
  }
  beginProfiling(marker) {
    if (window.performance) {
      window.performance.mark(marker);
      this.isRunningCPUProfiling = true;
    }
  }
  endProfiling(startMarker, endMarker, measureName) {
    if (window.performance && endMarker && this.isRunningCPUProfiling) {
      window.performance.mark(endMarker);
      const cpuMeasure = performance.measure(
        measureName,
        startMarker,
        endMarker
      );
      this.totalCpuDuration += cpuMeasure.duration;
      this.isRunningCPUProfiling = false;
    }
  }
  updatePanel(panel, averageArray) {
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
        panel.update(
          sumLog / Math.min(averageArray.logs.length, this.samplesLog),
          sumGraph / Math.min(averageArray.graph.length, this.samplesGraph),
          max,
          maxGraph,
          this.precision
        );
      }
    }
  }
  get domElement() {
    return this.dom;
  }
  get container() {
    console.warn(
      'Stats: Deprecated! this.container as been replaced to this.dom '
    );
    return this.dom;
  }
};
_Stats.Panel = Panel;
let Stats = _Stats;
export { Stats as default };
//# sourceMappingURL=main.js.map
