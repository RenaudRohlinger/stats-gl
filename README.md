# stats-gl
[![Version](https://img.shields.io/npm/v/stats-gl?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/stats-gl)
[![Version](https://img.shields.io/npm/dw/stats-gl?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/stats-gl)

> **For AI/LLM users:** See [llms.txt](./llms.txt) for a condensed API reference.

WebGL/WebGPU Performance Monitor with real-time FPS, CPU, and GPU timing. Supports Three.js, native WebGL2/WebGPU, Web Workers, and texture preview panels.

[Live Demo](https://stats.renaudrohlinger.com/)


https://github.com/RenaudRohlinger/stats-gl/assets/15867665/3fdafff4-1357-4872-9baf-0629dbaf9d8c


### Note: To support GPU monitoring on Safari you need to enable Timer Queries under WebKit Feature Flags > WebGL Timer Queries

## Installation

```bash
npm install stats-gl
```

## Quick Start

### Three.js (WebGL or WebGPU)

```js
import Stats from 'stats-gl';
import * as THREE from 'three';

const stats = new Stats({ trackGPU: true });
document.body.appendChild(stats.dom);

const renderer = new THREE.WebGLRenderer(); // or WebGPURenderer
stats.init(renderer);

function animate() {
  renderer.render(scene, camera); // or renderAsync for WebGPU
  stats.update();
}
renderer.setAnimationLoop(animate);
```

### Native WebGL2

```js
import Stats from 'stats-gl';

const stats = new Stats({ trackGPU: true });
const canvas = document.querySelector('#canvas');
stats.init(canvas);
document.body.appendChild(stats.dom);

function animate() {
  stats.begin();
  // ... your WebGL draw calls ...
  stats.end();
  stats.update();
  requestAnimationFrame(animate);
}
animate();
```

### Native WebGPU

```js
import Stats from 'stats-gl';

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
const context = canvas.getContext('webgpu');

const stats = new Stats({ trackGPU: true });
stats.init(device); // Pass the GPUDevice
document.body.appendChild(stats.dom);

function animate() {
  stats.begin();

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [...],
    timestampWrites: stats.getTimestampWrites() // Enable GPU timing
  });
  // ... your draw calls ...
  pass.end();

  stats.end(encoder); // Pass encoder to resolve timestamps
  device.queue.submit([encoder.finish()]);

  stats.update();
  requestAnimationFrame(animate);
}
animate();
```

### React Three Fiber

A `<StatsGl />` component is available through [@react-three/drei](https://github.com/pmndrs/drei):

```jsx
import { Canvas } from '@react-three/fiber'
import { StatsGl } from '@react-three/drei'

const Scene = () => (
  <Canvas>
    <StatsGl />
  </Canvas>
)
```

### Tresjs (Vue)

A `<StatsGl />` component is available through [cientos](https://cientos.tresjs.org/guide/misc/stats-gl.html):

```vue
<script setup lang="ts">
import { TresCanvas } from '@tresjs/core'
import { StatsGl } from '@tresjs/cientos'
</script>

<template>
  <TresCanvas>
    <StatsGl />
  </TresCanvas>
</template>
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `trackFPS` | boolean | `true` | Enable built-in FPS and CPU panels |
| `trackGPU` | boolean | `false` | Enable GPU timing (requires extension support) |
| `trackHz` | boolean | `false` | Enable refresh rate detection |
| `trackCPT` | boolean | `false` | Enable Three.js compute shader timing (WebGPU only) |
| `logsPerSecond` | number | `4` | How often to update text display |
| `graphsPerSecond` | number | `30` | How often to update graphs |
| `samplesLog` | number | `40` | Number of samples for text averaging |
| `samplesGraph` | number | `10` | Number of samples for graph averaging |
| `precision` | number | `2` | Decimal places for CPU/GPU values |
| `minimal` | boolean | `false` | Minimal mode - click to cycle panels |
| `horizontal` | boolean | `true` | Horizontal panel layout |
| `mode` | number | `0` | Initial panel (0=FPS, 1=CPU, 2=GPU) |

## Web Worker / OffscreenCanvas

stats-gl supports rendering in a Web Worker using OffscreenCanvas. Use `StatsProfiler` in the worker to collect timing data, and send it to the main thread where `Stats` displays it.

**Worker (offscreen rendering):**
```js
import { StatsProfiler } from 'stats-gl';

const profiler = new StatsProfiler({ trackGPU: true });

self.onmessage = async (e) => {
  if (e.data.type === 'init') {
    const canvas = e.data.canvas;
    const gl = canvas.getContext('webgl2');
    await profiler.init(gl);
    requestAnimationFrame(loop);
  }
};

function loop() {
  profiler.begin();
  // ... your rendering code ...
  profiler.end();
  profiler.update();

  // Send timing data to main thread
  self.postMessage({ type: 'stats', ...profiler.getData() });
  requestAnimationFrame(loop);
}
```

**Main thread:**
```js
import Stats from 'stats-gl';

const stats = new Stats({ trackGPU: true });
document.body.appendChild(stats.dom);

const canvas = document.getElementById('canvas');
const offscreen = canvas.transferControlToOffscreen();

const worker = new Worker('worker.js', { type: 'module' });
worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);

worker.onmessage = (e) => {
  if (e.data.type === 'stats') {
    stats.setData(e.data);
  }
};

function loop() {
  stats.update();
  requestAnimationFrame(loop);
}
loop();
```

### StatsProfiler API

`StatsProfiler` is a headless version of `Stats` designed for workers:

- `init(canvas | device)` - Initialize with WebGL context, OffscreenCanvas, or GPUDevice
- `begin()` / `end(encoder?)` - Wrap your render calls (pass encoder for native WebGPU)
- `getTimestampWrites()` - Get timestampWrites config for native WebGPU render pass
- `update()` - Process timing data
- `getData()` - Returns `{ fps, cpu, gpu, gpuCompute }`
- `captureTexture(source, sourceId)` - Capture texture to ImageBitmap for transfer

### Stats.setData()

Use `stats.setData(data)` to feed external timing data into the Stats UI. When set, `update()` uses this data instead of internal timing.

## Texture Preview Panels

Display render target previews alongside performance metrics. Supports both WebGL and WebGPU.

### Three.js Usage

```js
const stats = new Stats({ trackGPU: true });
stats.init(renderer);

// Create a texture panel
const panel = stats.addTexturePanel('GBuffer');

// Set texture source (WebGLRenderTarget or WebGPU RenderTarget)
const renderTarget = new THREE.WebGLRenderTarget(width, height);
stats.setTexture('GBuffer', renderTarget);

// In render loop - textures update automatically
function animate() {
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  stats.update();
}
```

### Worker Texture Transfer

```js
// Worker - capture and transfer texture
const bitmap = await profiler.captureTexture(renderTarget, 'gbuffer');
self.postMessage(
  { type: 'texture', name: 'GBuffer', bitmap, width, height },
  [bitmap]
);

// Main thread - receive and display
worker.onmessage = (e) => {
  if (e.data.type === 'texture') {
    stats.setTextureBitmap(e.data.name, e.data.bitmap, e.data.width, e.data.height);
  }
};
```

### Texture Panel API

- `stats.addTexturePanel(name)` - Create a new texture preview panel
- `stats.setTexture(name, source)` - Set Three.js RenderTarget source
- `stats.setTextureWebGL(name, framebuffer, width, height)` - Set raw WebGL framebuffer
- `stats.setTextureBitmap(name, bitmap, width?, height?)` - Set ImageBitmap (for workers)
- `stats.removeTexturePanel(name)` - Remove a texture panel

## TSL Node Capture (WebGPU)

Capture any Three.js TSL node for live preview. Works with MRT, post-processing, and custom shaders.

### Main Thread Usage

```js
import Stats from 'stats-gl';
import { statsGL } from 'stats-gl/addons/StatsGLNode.js';
import { addMethodChaining } from 'three/tsl';

// Enable .toStatsGL() method on TSL nodes
addMethodChaining('toStatsGL', statsGL);

const stats = new Stats({ trackGPU: true });
stats.init(renderer);
document.body.appendChild(stats.dom);

// In your PostProcessing setup:
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({
  output,
  normal: directionToColor(normalView),
  diffuse: diffuseColor
}));

// Register nodes for capture - panels are created automatically
scenePass.getTextureNode('diffuse').toStatsGL('Diffuse', stats);
scenePass.getTextureNode('normal').toStatsGL('Normal', stats);
scenePass.getLinearDepthNode().toStatsGL('Depth', stats);
```

### Web Worker Usage

The same `StatsGLNode.js` addon works in Web Workers with OffscreenCanvas:

**Worker:**
```js
import { StatsProfiler } from 'stats-gl';
import { flushCaptures } from 'stats-gl/addons/StatsGLNode.js';

const profiler = new StatsProfiler({ trackGPU: true });
await profiler.init(renderer);

// Register nodes (no stats instance needed in worker)
diffuseNode.toStatsGL('Diffuse');
normalNode.toStatsGL('Normal');
depthNode.toStatsGL('Depth');

async function render() {
  profiler.begin();
  postProcessing.render();
  profiler.end();
  profiler.update();

  // Send stats to main thread
  self.postMessage({ type: 'stats', data: profiler.getData() });

  // Capture and transfer TSL nodes as ImageBitmaps
  const captures = await flushCaptures(renderer);
  for (const { name, bitmap } of captures) {
    self.postMessage({ type: 'texture', name, bitmap }, [bitmap]);
  }
}
```

**Main Thread:**
```js
import Stats from 'stats-gl';

const stats = new Stats({ trackGPU: true });
document.body.appendChild(stats.dom);

// Create panels for worker captures
stats.addTexturePanel('Diffuse');
stats.addTexturePanel('Normal');
stats.addTexturePanel('Depth');

worker.onmessage = (e) => {
  if (e.data.type === 'stats') stats.setData(e.data.data);
  if (e.data.type === 'texture') {
    stats.setTextureBitmap(e.data.name, e.data.bitmap);
  }
};
```

### Transform Callback

Use a callback to transform the node before capture (e.g., linearize depth):

```js
depthNode.toStatsGL('Depth', stats, (node) => linearizeDepth(node));
```

## Custom Panels

Add custom metrics panels:

```js
const customPanel = stats.addPanel(new Stats.Panel('COUNT', '#ff0', '#220'));

function animate() {
  // Update with value and max
  customPanel.update(currentValue, maxValue, 2); // 2 decimal places
  customPanel.updateGraph(currentValue, maxValue);
  stats.update();
}
```

## API Reference

### Default Export: Stats

Main class with DOM rendering.

```js
import Stats from 'stats-gl';

const stats = new Stats(options);
stats.init(renderer);           // Initialize with Three.js renderer, canvas, or GPUDevice
stats.begin();                  // Start timing (auto-called for Three.js)
stats.end(encoder?);            // End timing (pass encoder for native WebGPU)
stats.update();                 // Update display
stats.setData(data);            // Set external timing data
stats.getTimestampWrites();     // Get timestampWrites for native WebGPU render pass
stats.dispose();                // Clean up resources
```

### Named Exports

```js
import Stats, {
  StatsProfiler,           // Headless profiler for workers
  PanelTexture,            // Texture preview panel class
  TextureCaptureWebGL,     // WebGL texture capture utility
  TextureCaptureWebGPU,    // WebGPU texture capture utility
  StatsGLCapture           // Addon capture helper
} from 'stats-gl';

// TSL Node capture addon (WebGPU only, works in main thread and workers)
import { statsGL, flushCaptures } from 'stats-gl/addons/StatsGLNode.js';
```

## Contributing

Contributions to stats-gl are welcome. Please report any issues or bugs you encounter.

## License

This project is licensed under the MIT License.

## Maintainers

- [@onirenaud](https://twitter.com/onirenaud)
- [@utsuboco](https://twitter.com/utsuboco)
