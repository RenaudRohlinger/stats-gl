import { StatsProfiler } from '../dist/main.js';

let gl = null;
let profiler = null;
let stressEnabled = false;

self.onmessage = async (e) => {
  if (e.data.type === 'init') {
    const canvas = e.data.canvas;

    // Initialize WebGL2 context
    gl = canvas.getContext('webgl2');
    if (!gl) {
      self.postMessage({ type: 'error', message: 'WebGL2 not supported' });
      return;
    }

    // Initialize profiler
    profiler = new StatsProfiler({ trackGPU: true });
    await profiler.init(gl);

    self.postMessage({ type: 'ready' });
    requestAnimationFrame(loop);
  } else if (e.data.type === 'stress') {
    stressEnabled = e.data.enabled;
  }
};

// CPU-intensive function for worker stress
function heavyComputation() {
  let result = 0;
  for (let i = 0; i < 1000000; i++) {
    result += Math.sqrt(i) * Math.sin(i);
  }
  return result;
}

function loop() {
  if (!gl || !profiler) return;

  profiler.begin();

  // Apply stress if enabled
  if (stressEnabled) {
    heavyComputation();
  }

  // Simulate some GPU work - draw rotating colored triangles
  const time = performance.now() * 0.001;

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0.1, 0.1, 0.15, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Create a simple shader program for demo
  if (!gl.program) {
    const vs = `#version 300 es
      in vec2 position;
      uniform float time;
      void main() {
        float angle = time + float(gl_VertexID) * 0.5;
        vec2 offset = vec2(cos(angle), sin(angle)) * 0.3;
        gl_Position = vec4(position + offset, 0.0, 1.0);
      }
    `;
    const fs = `#version 300 es
      precision highp float;
      uniform float time;
      out vec4 fragColor;
      void main() {
        fragColor = vec4(
          sin(time) * 0.5 + 0.5,
          cos(time * 0.7) * 0.5 + 0.5,
          sin(time * 1.3) * 0.5 + 0.5,
          1.0
        );
      }
    `;

    const vShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vShader, vs);
    gl.compileShader(vShader);

    const fShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fShader, fs);
    gl.compileShader(fShader);

    gl.program = gl.createProgram();
    gl.attachShader(gl.program, vShader);
    gl.attachShader(gl.program, fShader);
    gl.linkProgram(gl.program);

    // Create geometry
    const positions = new Float32Array([
      0.0, 0.5,
      -0.5, -0.5,
      0.5, -0.5
    ]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posLoc = gl.getAttribLocation(gl.program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.timeLoc = gl.getUniformLocation(gl.program, 'time');
  }

  gl.useProgram(gl.program);
  gl.uniform1f(gl.timeLoc, time);

  // Draw multiple times to create some GPU load
  for (let i = 0; i < 100; i++) {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  profiler.end();
  profiler.update();

  // Send stats to main thread
  const data = profiler.getData();
  self.postMessage({ type: 'stats', ...data });

  requestAnimationFrame(loop);
}
