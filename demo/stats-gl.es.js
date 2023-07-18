var P = Object.defineProperty;
var g = (o, t, i) => t in o ? P(o, t, { enumerable: !0, configurable: !0, writable: !0, value: i }) : o[t] = i;
var s = (o, t, i) => (g(o, typeof t != "symbol" ? t + "" : t, i), i);
class p {
  constructor(t, i, h) {
    s(this, "canvas");
    s(this, "context");
    s(this, "name");
    s(this, "fg");
    s(this, "bg");
    s(this, "PR");
    s(this, "WIDTH");
    s(this, "HEIGHT");
    s(this, "TEXT_X");
    s(this, "TEXT_Y");
    s(this, "GRAPH_X");
    s(this, "GRAPH_Y");
    s(this, "GRAPH_WIDTH");
    s(this, "GRAPH_HEIGHT");
    this.name = t, this.fg = i, this.bg = h, this.PR = Math.round(window.devicePixelRatio || 1), this.WIDTH = 90 * this.PR, this.HEIGHT = 48 * this.PR, this.TEXT_X = 3 * this.PR, this.TEXT_Y = 2 * this.PR, this.GRAPH_X = 3 * this.PR, this.GRAPH_Y = 15 * this.PR, this.GRAPH_WIDTH = 84 * this.PR, this.GRAPH_HEIGHT = 30 * this.PR, this.canvas = document.createElement("canvas"), this.canvas.width = 90 * this.PR, this.canvas.height = 48 * this.PR, this.canvas.style.width = "90px", this.canvas.style.height = "48px", this.canvas.style.cssText = "width:90px;height:48px", this.context = this.canvas.getContext("2d"), this.context && (this.context.font = "bold " + 9 * this.PR + "px Helvetica,Arial,sans-serif", this.context.textBaseline = "top", this.context.fillStyle = this.bg, this.context.fillRect(0, 0, this.WIDTH, this.HEIGHT), this.context.fillStyle = this.fg, this.context.fillText(this.name, this.TEXT_X, this.TEXT_Y), this.context.fillRect(this.GRAPH_X, this.GRAPH_Y, this.GRAPH_WIDTH, this.GRAPH_HEIGHT), this.context.fillStyle = this.bg, this.context.globalAlpha = 0.9, this.context.fillRect(this.GRAPH_X, this.GRAPH_Y, this.GRAPH_WIDTH, this.GRAPH_HEIGHT));
  }
  update(t, i, h, l, n = 0) {
    let a = 1 / 0, e = 0;
    this.context && (a = Math.min(a, t), e = Math.max(h, t), l = Math.max(l, i), this.context.fillStyle = this.bg, this.context.globalAlpha = 1, this.context.fillRect(0, 0, this.WIDTH, this.GRAPH_Y), this.context.fillStyle = this.fg, this.context.fillText(t.toFixed(n) + " " + this.name + " (" + a.toFixed(n) + "-" + parseFloat(e.toFixed(n)) + ")", this.TEXT_X, this.TEXT_Y), this.context.drawImage(this.canvas, this.GRAPH_X + this.PR, this.GRAPH_Y, this.GRAPH_WIDTH - this.PR, this.GRAPH_HEIGHT, this.GRAPH_X, this.GRAPH_Y, this.GRAPH_WIDTH - this.PR, this.GRAPH_HEIGHT), this.context.fillRect(this.GRAPH_X + this.GRAPH_WIDTH - this.PR, this.GRAPH_Y, this.PR, this.GRAPH_HEIGHT), this.context.fillStyle = this.bg, this.context.globalAlpha = 0.9, this.context.fillRect(this.GRAPH_X + this.GRAPH_WIDTH - this.PR, this.GRAPH_Y, this.PR, parseFloat((1 - i / l).toFixed(n)) * this.GRAPH_HEIGHT));
  }
}
const r = class r {
  constructor({ logsPerSecond: t = 20, samplesLog: i = 100, samplesGraph: h = 10, precision: l = 2, minimal: n = !1, mode: a = 0 } = {}) {
    s(this, "mode");
    s(this, "container");
    s(this, "minimal");
    s(this, "beginTime");
    s(this, "prevTime");
    s(this, "prevCpuTime");
    s(this, "frames");
    s(this, "averageCpu");
    s(this, "averageGpu");
    s(this, "queryCreated");
    s(this, "fpsPanel");
    s(this, "msPanel");
    s(this, "gpuPanel");
    s(this, "samplesLog");
    s(this, "samplesGraph");
    s(this, "logsPerSecond");
    s(this, "precision");
    s(this, "canvasGpu");
    s(this, "gl");
    s(this, "ext");
    s(this, "query");
    s(this, "disjoint");
    s(this, "ns");
    this.mode = a, this.container = document.createElement("div"), this.container.style.cssText = "position:fixed;top:0;left:0;opacity:0.9;z-index:10000;", n && (this.container.style.cssText += "cursor:pointer"), this.canvasGpu = null, this.gl = null, this.query = null, this.minimal = n, this.beginTime = (performance || Date).now(), this.prevTime = this.beginTime, this.prevCpuTime = this.beginTime, this.frames = 0, this.averageCpu = {
      logs: [],
      graph: []
    }, this.averageGpu = {
      logs: [],
      graph: []
    }, this.queryCreated = !1, this.fpsPanel = this.addPanel(new r.Panel("FPS", "#0ff", "#002"), 0), this.msPanel = this.addPanel(new r.Panel("CPU", "#0f0", "#020"), 1), this.gpuPanel = null, this.samplesLog = i, this.samplesGraph = h, this.precision = l, this.logsPerSecond = t, this.minimal ? (this.container.addEventListener("click", (e) => {
      e.preventDefault(), this.showPanel(++this.mode % this.container.children.length);
    }, !1), this.mode = a, this.showPanel(this.mode)) : window.addEventListener("resize", () => {
      this.resizePanel(this.fpsPanel, 0), this.resizePanel(this.msPanel, 1), this.gpuPanel && this.resizePanel(this.gpuPanel, 2);
    });
  }
  resizePanel(t, i) {
    this.minimal ? t.canvas.style.display = "none" : (t.canvas.style.display = "block", window.innerWidth < 700 ? (t.canvas.style.left = "0px", t.canvas.style.top = i * t.HEIGHT / t.PR + "px") : (t.canvas.style.top = "0px", t.canvas.style.left = i * t.WIDTH / t.PR + "px"));
  }
  addPanel(t, i) {
    return t.canvas && (this.container.appendChild(t.canvas), this.resizePanel(t, i)), t;
  }
  showPanel(t) {
    for (let i = 0; i < this.container.children.length; i++) {
      const h = this.container.children[i];
      h.style.display = i === t ? "block" : "none";
    }
    this.mode = t;
  }
  init(t) {
    this.canvasGpu = t, this.canvasGpu && (this.gl = this.canvasGpu.getContext("webgl2"), this.ext = this.gl ? this.gl.getExtension("EXT_disjoint_timer_query_webgl2") : null, this.ext && (this.gpuPanel = this.addPanel(new r.Panel("GPU", "#ff0", "#220"), 2)));
  }
  begin() {
    if (this.beginProfiling("cpu-started"), !(!this.gl || !this.ext)) {
      if (this.query) {
        const t = this.gl.getQueryParameter(this.query, this.gl.QUERY_RESULT_AVAILABLE);
        if (this.disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT), t && !this.disjoint) {
          this.ns = this.gl.getQueryParameter(this.query, this.gl.QUERY_RESULT);
          const i = this.ns * 1e-6;
          (t || this.disjoint) && (this.gl.deleteQuery(this.query), this.query = null), t && this.addToAverage(i, this.averageGpu);
        }
      }
      this.query || (this.queryCreated = !0, this.query = this.gl.createQuery(), this.query && this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query));
    }
  }
  end() {
    this.beginTime = this.endInternal(), this.endProfiling("cpu-started", "cpu-finished", "cpu-duration", this.averageCpu), !(!this.gl || !this.ext) && this.queryCreated && this.gl.getQuery(this.ext.TIME_ELAPSED_EXT, this.gl.CURRENT_QUERY) && this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
  }
  endInternal() {
    this.frames++;
    const t = (performance || Date).now();
    if (t >= this.prevCpuTime + 1e3 / this.logsPerSecond && (this.updatePanel(this.msPanel, this.averageCpu), this.updatePanel(this.gpuPanel, this.averageGpu), this.prevCpuTime = t), t >= this.prevTime + 1e3) {
      const i = this.frames * 1e3 / (t - this.prevTime);
      this.fpsPanel.update(i, i, 100, 100, 0), this.prevTime = t, this.frames = 0;
    }
    return t;
  }
  addToAverage(t, i) {
    i.logs.push(t), i.logs.length > this.samplesLog && i.logs.shift(), i.graph.push(t), i.graph.length > this.samplesGraph && i.graph.shift();
  }
  beginProfiling(t) {
    window.performance && window.performance.mark(t);
  }
  endProfiling(t, i, h, l) {
    if (window.performance && i) {
      window.performance.mark(i);
      const n = performance.measure(h, t, i);
      this.addToAverage(n.duration, l);
    }
  }
  updatePanel(t, i) {
    if (i.logs.length > 0) {
      let h = 0, l = 0.01;
      for (let e = 0; e < i.logs.length; e++)
        h += i.logs[e], i.logs[e] > l && (l = i.logs[e]);
      let n = 0, a = 0.01;
      for (let e = 0; e < i.graph.length; e++)
        n += i.graph[e], i.graph[e] > a && (a = i.graph[e]);
      t && t.update(h / Math.min(i.logs.length, this.samplesLog), n / Math.min(i.graph.length, this.samplesGraph), l, a, this.precision);
    }
  }
};
s(r, "Panel");
let c = r;
c.Panel = p;
export {
  c as default
};
