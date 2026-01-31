// Texture capture worker demo
// Renders to FBOs and captures them for transfer to main thread

import { StatsProfiler } from '../lib/profiler.ts';

let gl = null;
let profiler = null;
let canvasWidth = 512;
let canvasHeight = 512;

// FBOs
let colorFbo = null;
let lumaFbo = null;
let colorTexture = null;
let lumaTexture = null;
const fboSize = 512;

// Blit program for rendering to canvas
let blitProgram = null;
let blitTexLoc = null;

// Shaders
let plasmaProgram = null;
let lumaProgram = null;
let plasmaTimeLoc = null;
let lumaColorTexLoc = null;
let quadBuffer = null;

let startTime = 0;

// Stress test state
let stressEnabled = false;

// Heavy computation function (1M iterations)
// Note: We assign to self to prevent tree-shaking
function heavyComputation() {
  let result = 0;
  for (let i = 0; i < 1000000; i++) {
    result += Math.sqrt(i) * Math.sin(i);
  }
  self.__stressResult = result;
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function createProgram(gl, vertSource, fragSource) {
  const vert = createShader(gl, gl.VERTEX_SHADER, vertSource);
  const frag = createShader(gl, gl.FRAGMENT_SHADER, fragSource);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function init(canvas) {
  canvasWidth = canvas.width;
  canvasHeight = canvas.height;
  gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) {
    console.error('WebGL2 not supported');
    return;
  }

  // Initialize profiler
  profiler = new StatsProfiler({ trackGPU: true });
  profiler.init(gl);

  // Create color FBO
  colorTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colorTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fboSize, fboSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  colorFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, colorFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);

  // Create luma FBO
  lumaTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lumaTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fboSize, fboSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  lumaFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, lumaFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lumaTexture, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Create shaders
  const vertSource = `#version 300 es
    in vec2 position;
    out vec2 vUv;
    void main() {
      vUv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const plasmaFragSource = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;
    uniform float time;

    void main() {
      float x = vUv.x * 10.0;
      float y = vUv.y * 10.0;
      float t = time * 2.0;

      float v1 = sin(x + t);
      float v2 = sin(y + t);
      float v3 = sin(x + y + t);
      float v4 = sin(sqrt(x*x + y*y) + t);

      float v = (v1 + v2 + v3 + v4) * 0.25;

      vec3 color = vec3(
        sin(v * 3.14159) * 0.5 + 0.5,
        sin(v * 3.14159 + 2.094) * 0.5 + 0.5,
        sin(v * 3.14159 + 4.188) * 0.5 + 0.5
      );

      fragColor = vec4(color, 1.0);
    }
  `;

  const lumaFragSource = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;
    uniform sampler2D colorTex;

    void main() {
      vec3 color = texture(colorTex, vUv).rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      fragColor = vec4(vec3(luma), 1.0);
    }
  `;

  const blitFragSource = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;
    uniform sampler2D tex;

    void main() {
      fragColor = texture(tex, vUv);
    }
  `;

  plasmaProgram = createProgram(gl, vertSource, plasmaFragSource);
  lumaProgram = createProgram(gl, vertSource, lumaFragSource);
  blitProgram = createProgram(gl, vertSource, blitFragSource);

  plasmaTimeLoc = gl.getUniformLocation(plasmaProgram, 'time');
  lumaColorTexLoc = gl.getUniformLocation(lumaProgram, 'colorTex');
  blitTexLoc = gl.getUniformLocation(blitProgram, 'tex');

  // Quad buffer
  quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  startTime = performance.now();

  // Start render loop
  requestAnimationFrame(render);
}

async function render() {
  const time = (performance.now() - startTime) * 0.001;

  profiler.begin();

  // Run heavy computation if stress test is enabled (inside profiler timing)
  if (stressEnabled) {
    heavyComputation();
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // 1. Render plasma to color FBO
  gl.bindFramebuffer(gl.FRAMEBUFFER, colorFbo);
  gl.viewport(0, 0, fboSize, fboSize);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(plasmaProgram);
  gl.uniform1f(plasmaTimeLoc, time);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // 2. Render luminance pass
  gl.bindFramebuffer(gl.FRAMEBUFFER, lumaFbo);
  gl.viewport(0, 0, fboSize, fboSize);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(lumaProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, colorTexture);
  gl.uniform1i(lumaColorTexLoc, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // 3. Blit color FBO to canvas (default framebuffer)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvasWidth, canvasHeight);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(blitProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, colorTexture);
  gl.uniform1i(blitTexLoc, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  profiler.end();
  profiler.update();

  // Capture textures and send to main thread
  const colorBitmap = await profiler.captureTexture({
    framebuffer: colorFbo,
    width: fboSize,
    height: fboSize
  });

  const lumaBitmap = await profiler.captureTexture({
    framebuffer: lumaFbo,
    width: fboSize,
    height: fboSize
  });

  // Send stats data
  const statsData = profiler.getData();
  self.postMessage({ type: 'stats', data: statsData });

  // Send texture bitmaps (transferable)
  if (colorBitmap) {
    self.postMessage(
      { type: 'texture', name: 'Color', bitmap: colorBitmap, width: fboSize, height: fboSize },
      [colorBitmap]
    );
  }

  if (lumaBitmap) {
    self.postMessage(
      { type: 'texture', name: 'Luma', bitmap: lumaBitmap, width: fboSize, height: fboSize },
      [lumaBitmap]
    );
  }

  requestAnimationFrame(render);
}

// Handle messages from main thread
self.onmessage = (e) => {
  if (e.data.type === 'init') {
    init(e.data.canvas);
  } else if (e.data.type === 'stress') {
    stressEnabled = e.data.enabled;
  }
};