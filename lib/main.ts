import Panel from "./panel";

export interface AverageArray {
  logs: number[];
  graph: number[];
}


class Stats {
  mode: number;
  container: HTMLDivElement;
  minimal: boolean;
  beginTime: number;
  prevTime: any;
  frames: number;
  averageCpu: AverageArray;
  averageGpu: AverageArray;
  averageFps: AverageArray;
  queryCreated: boolean;
  fpsPanel: Panel;
  static Panel: any;
  msPanel: Panel;
  gpuPanel: Panel | null;
  samplesLog: number;
  samplesGraph: number;
  precision: number;
  canvasGpu: HTMLCanvasElement | null;
  gl: WebGL2RenderingContext | null;
  ext: any;
  query: WebGLQuery | null;
  disjoint: any;
  ns: any;

  constructor( { samplesLog = 100, samplesGraph = 10, precision = 2, minimal = false } = {} ) {

    this.mode = 0;
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
    this.frames = 0;
    this.averageCpu = {
      logs: [],
      graph: []
    };
    this.averageGpu = {
      logs: [],
      graph: []
    };
    this.averageFps = {
      logs: [],
      graph: []
    };

    this.queryCreated = false;

    this.fpsPanel = this.addPanel( new Stats.Panel( 'FPS', '#0ff', '#002' ) );
    this.msPanel = this.addPanel( new Stats.Panel( 'CPU', '#0f0', '#020' ) );
    this.gpuPanel = null;

    this.samplesLog = samplesLog;
    this.samplesGraph = samplesGraph;
    this.precision = precision;

    if ( this.minimal ) {

      this.container.addEventListener( 'click', ( event ) => {

        event.preventDefault();
        this.showPanel( ++ this.mode % this.container.children.length );

      }, false );
      this.mode = 0;
      this.showPanel( this.mode );

    }

  }

  addPanel(panel: Panel) {

    if(panel.canvas) {

      this.container.appendChild(panel.canvas);
    
      if ( this.minimal ) {

        panel.canvas.style.display = 'none';

      } else {

        panel.canvas.style.display = 'block';
        panel.canvas.style.left = ( this.container.children.length - 1 ) * panel.WIDTH + 'px';
      }

    }

    return panel;

  }

  showPanel( id: number ) {

    for ( let i = 0; i < this.container.children.length; i ++ ) {
      const child = this.container.children[i] as HTMLElement;

      child.style.display = i === id ? 'block' : 'none';

    }

    this.mode = id;

  }

  begin() {

    this.beginTime = ( performance || Date ).now();

  }

  initGpu( canvas: any ) {

    this.canvasGpu = canvas;
    if ( ! this.canvasGpu ) return;
    this.gl = this.canvasGpu.getContext( 'webgl2' );
    this.ext = this.gl ? this.gl.getExtension( 'EXT_disjoint_timer_query_webgl2' ) : null;
    if ( this.ext ) {

      this.gpuPanel = this.addPanel( new Stats.Panel( 'GPU', '#ff0', '#220' ) );

    }

  }

  startGpu() {

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

  endGpu() {

    this.endProfiling( 'cpu-started', 'cpu-finished', 'cpu-duration', this.averageCpu );

    if ( ! this.gl || ! this.ext ) return;


    if ( this.queryCreated && this.gl.getQuery( this.ext.TIME_ELAPSED_EXT, this.gl.CURRENT_QUERY ) ) {

      this.gl.endQuery( this.ext.TIME_ELAPSED_EXT );

    }

  }

  end() {

    this.frames ++;
    const time = ( performance || Date ).now();

    this.updatePanel( this.msPanel, this.averageCpu );
    this.updatePanel( this.gpuPanel, this.averageGpu );

    if ( time >= this.prevTime + 1000 ) {

      const fps = ( this.frames * 1000 ) / ( time - this.prevTime );

      this.addToAverage( fps, this.averageFps );

      console.log(this.averageFps)
      this.updatePanel( this.fpsPanel, this.averageFps );

      this.prevTime = time;
      this.frames = 0;

    }

    return time;

  }

  update() {

    this.beginTime = this.end();

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
        panel.update(sumLog / this.samplesLog, sumGraph / this.samplesGraph, max, maxGraph, this.precision);
      }

    }
  }


}

Stats.Panel = Panel

export default Stats;