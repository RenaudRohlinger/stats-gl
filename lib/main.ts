import { FBOPanel } from "./fbopanel";
import Panel from "./panel";

export interface AverageArray {
  logs: number[];
  graph: number[];
}


class Stats {
  mode: number;
  panelOffset: number;
  plugins: StatsPlugin[];
  container: HTMLDivElement;
  minimal: boolean;
  horizontal: boolean;
  beginTime: number;
  prevTime: number;
  prevCpuTime: number;
  frames: number;
  averageCpu: AverageArray;
  averageGpu: AverageArray;
  queryCreated: boolean;
  fpsPanel: Panel;
  static Panel: any;
  msPanel: Panel;
  gpuPanel: Panel | null;
  samplesLog: number;
  samplesGraph: number;
  logsPerSecond: number;
  precision: number;
  canvasGpu: HTMLCanvasElement | null;
  gl: WebGL2RenderingContext | null;
  private ext: any;
  private query: WebGLQuery | null;
  private disjoint: any;
  private ns: any;
  private panels: Panel[];
  disabled: boolean;

  constructor({ logsPerSecond = 20, samplesLog = 100, samplesGraph = 10, precision = 2, minimal = false, horizontal = true, mode = 0, plugins = [] }: { logsPerSecond?: number, samplesLog?: number, samplesGraph?: number, precision?: number, minimal?: boolean, horizontal?: boolean, mode?: number, plugins?: StatsPlugin[] } = {}) {

    this.panelOffset = 0;
    this.plugins = plugins;

    this.disabled = false
    this.mode = mode;
    this.horizontal = horizontal;
    this.container = document.createElement( 'div' );
    this.container.style.cssText = 'position:fixed;top:0;left:0;opacity:0.9;z-index:10000;';

    if ( minimal ) {

      this.container.style.cssText += 'cursor:pointer';

    }

    this.canvasGpu = null;
    this.gl = null;
    this.query =  null;

    this.minimal = minimal;

    this.beginTime = ( performance || Date ).now();
    this.prevTime = this.beginTime;
    this.prevCpuTime = this.beginTime;
    this.frames = 0;
    this.averageCpu = {
      logs: [],
      graph: []
    };
    this.averageGpu = {
      logs: [],
      graph: []
    };

    this.queryCreated = false;
    this.panels = [];

    this.fpsPanel = this.addPanel( new Stats.Panel( 'FPS', '#0ff', '#002' ) );
    this.msPanel = this.addPanel( new Stats.Panel( 'CPU', '#0f0', '#020' ) );
    this.gpuPanel = null;

    this.samplesLog = samplesLog;
    this.samplesGraph = samplesGraph;
    this.precision = precision;
    this.logsPerSecond = logsPerSecond;

    if ( this.minimal ) {

      this.container.addEventListener( 'click', ( event ) => {

        event.preventDefault();
        this.showPanel( ++ this.mode % this.container.children.length );

      }, false );

      this.mode = mode;
      this.showPanel( this.mode );

    } else {

      window.addEventListener('resize', () =>{
        
        this.resizePanels()
      
      })
      this.resizePanels()

    }

  }

  addPlugin(plugin: StatsPlugin) {
    // if (plugin.framework === "webgl2") {

        let panel;
        if (plugin.render) {
            // if a render function is provided, use FBOPanel
            // This is where you would pass in the framework-specific renderer, scene, camera.
            panel = new FBOPanel(this, plugin.name, plugin.fg, plugin.bg, plugin.renderer, plugin.scene, plugin.camera, plugin.render, plugin.onBeforeRender, plugin.onAfterRender);
        } else {
            panel = new Panel(plugin.name, plugin.fg, plugin.bg);
        }
        // Store a reference of the plugin in the panel to update it
        (panel as any).plugin = plugin;

        this.addPanel(panel);


    // }
  }


  resizePanels() {
    
    for( let i = 0; i < this.panels.length; i ++ ) {
      const panel = this.panels[i];
        panel.canvas.style.position = 'absolute';

        if ( this.minimal ) {

          panel.canvas.style.display = 'none';
    
        } else {

          panel.canvas.style.display = 'block';

          if (this.horizontal) {
            panel.X = panel.WIDTH * i  / panel.PR;
            panel.Y = 0

          } else {
            panel.X = 0
            panel.Y = panel.HEIGHT * i  / panel.PR;
          }

          panel.canvas.style.left = panel.X + 'px'
          panel.canvas.style.top =  panel.Y + 'px'
        }
    }
}
    
  addPanel(panel: Panel) {

  
    if(panel.canvas) {

      this.container.appendChild(panel.canvas);
    }
    panel.index = this.panelOffset;
    this.panelOffset++;

    this.panels.push(panel);

    this.resizePanels();

    return panel;

  }

  showPanel( id: number ) {

    for ( let i = 0; i < this.container.children.length; i ++ ) {
      const child = this.container.children[i] as HTMLElement;

      child.style.display = i === id ? 'block' : 'none';

    }

    this.mode = id;

  }

  init( canvas: any ) {

    this.canvasGpu = canvas;
    if ( ! this.canvasGpu ) return;
    this.gl = this.canvasGpu.getContext( 'webgl2' );
    this.ext = this.gl ? this.gl.getExtension( 'EXT_disjoint_timer_query_webgl2' ) : null;
    if ( this.ext ) {

      this.gpuPanel = this.addPanel( new Stats.Panel( 'GPU', '#ff0', '#220' ) );

    }
        
    // Instantiate the plugins
    this.plugins.forEach(plugin => this.addPlugin(plugin));
  }

  begin() {
    if (this.disabled) return

    this.beginProfiling( 'cpu-started' );
    if ( ! this.gl || ! this.ext ) return;


    if ( this.query ) {

      const available = this.gl.getQueryParameter( this.query, this.gl.QUERY_RESULT_AVAILABLE );
      this.disjoint = this.gl.getParameter( this.ext.GPU_DISJOINT_EXT );

      if ( available && ! this.disjoint ) {

        this.ns = this.gl.getQueryParameter( this.query, this.gl.QUERY_RESULT );
        const ms = this.ns * 1e-6;

        if ( available || this.disjoint ) {

          this.gl.deleteQuery( this.query );
          this.query = null;

        }

        if ( available ) {

          this.addToAverage( ms, this.averageGpu );


          for (let i = 0; i < this.panels.length; i++) {
            const panel = this.panels[i];
    
            if (panel && (panel as any).plugin) {
              // If this panel is from a plugin, use the plugin's update method
              if ((panel as any).plugin.render) {
                (panel as FBOPanel).renderBufferDirect();
              }
              continue;
            }
      
          }
        }

      }

    }

    if ( ! this.query ) {

      this.queryCreated = true;
      this.query = this.gl.createQuery();

      if ( this.query ) {
        this.gl.beginQuery( this.ext.TIME_ELAPSED_EXT, this.query );
      }

    }

  }

  end() {
    if (this.disabled) return

    this.beginTime = this.endInternal()

    this.endProfiling( 'cpu-started', 'cpu-finished', 'cpu-duration', this.averageCpu );

    if ( ! this.gl || ! this.ext ) return;


    if ( this.queryCreated && this.gl.getQuery( this.ext.TIME_ELAPSED_EXT, this.gl.CURRENT_QUERY ) ) {

      this.gl.endQuery( this.ext.TIME_ELAPSED_EXT );

    }

  
  }

  endInternal() {

    this.frames ++;
    const time = ( performance || Date ).now();

    if (time >= this.prevCpuTime + 1000 / this.logsPerSecond) {
      this.updatePanel( this.msPanel, this.averageCpu );
      this.updatePanel( this.gpuPanel, this.averageGpu );



      for (let i = 0; i < this.panels.length; i++) {
        const panel = this.panels[i];

        if (panel && (panel as any).plugin) {
          // If this panel is from a plugin, use the plugin's update method
          if (!(panel as any).plugin.render) {
            const value = (panel as any).plugin.update();
            panel.update(value, value, 100, 100, this.precision);
          }
          continue;
        }
  
      }

      this.prevCpuTime = time;
    }

    if ( time >= this.prevTime + 1000 ) {

      const fps = ( this.frames * 1000 ) / ( time - this.prevTime );

      this.fpsPanel.update(fps, fps, 100, 100, 0);

      this.prevTime = time;
      this.frames = 0;

    }

    return time;

  }

  addToAverage( value: number, averageArray: { logs: any; graph: any; } ) {

    averageArray.logs.push( value );
    if ( averageArray.logs.length > this.samplesLog ) {

      averageArray.logs.shift();

    }

    averageArray.graph.push( value );
    if ( averageArray.graph.length > this.samplesGraph ) {

      averageArray.graph.shift();

    }

  }

  beginProfiling( marker: string ) {

    if ( window.performance ) {

      window.performance.mark( marker );

    }

  }

  endProfiling( startMarker: string | PerformanceMeasureOptions | undefined, endMarker: string | undefined, measureName: string, averageArray: {logs: number[], graph: number[]} ) {

    if ( window.performance && endMarker ) {

      window.performance.mark( endMarker );
      const cpuMeasure = performance.measure( measureName, startMarker, endMarker );
      this.addToAverage( cpuMeasure.duration, averageArray );

    }

  }

  updatePanel(panel: { update: any; } | null, averageArray: {logs: number[], graph: number[]}) {

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
        panel.update(sumLog / Math.min(averageArray.logs.length,this.samplesLog), sumGraph / Math.min(averageArray.graph.length,this.samplesGraph), max, maxGraph, this.precision);
      }

    }
  }


}

Stats.Panel = Panel

export default Stats;