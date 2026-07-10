import assert from 'node:assert/strict';

import { WebGPUCoordinateSystem } from 'three';
import { smoothstep, vec4 } from 'three/tsl';
import WGSLNodeBuilder from '../node_modules/three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js';

class TestOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
}

globalThis.OffscreenCanvas = TestOffscreenCanvas;
globalThis.createImageBitmap = async () => ({});

const {
  flushCaptures,
  removeStatsGL,
  statsGL
} = await import('../addons/StatsGLNode.js');

function createRenderer(onRender) {
  let canvasTarget = null;

  return {
    autoClear: true,
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getCanvasTarget: () => canvasTarget,
    getClearAlpha: () => 1,
    getClearColor: (target) => target.set(0x000000),
    getMRT: () => null,
    getPixelRatio: () => 1,
    getRenderObjectFunction: () => null,
    getRenderTarget: () => null,
    getScissorTest: () => false,
    render: (quad) => onRender(quad.material.outputNode),
    setCanvasTarget: (target) => { canvasTarget = target; },
    setClearColor: () => {},
    setMRT: () => {},
    setPixelRatio: () => {},
    setRenderObjectFunction: () => {},
    setRenderTarget: () => {},
    setScissorTest: () => {}
  };
}

async function captureOutput(node, name) {
  let outputNode = null;
  const renderer = createRenderer((output) => { outputNode = output; });

  statsGL(node, name);

  try {
    await flushCaptures(renderer);
  } finally {
    removeStatsGL(null, name);
  }

  assert.ok(outputNode, `${name} did not produce a capture output node`);
  return outputNode;
}

function generateFragmentSnippet(node) {
  const builder = new WGSLNodeBuilder(null, { coordinateSystem: WebGPUCoordinateSystem });

  for (const stage of ['setup', 'analyze']) {
    builder.setBuildStage(stage);
    builder.setShaderStage('fragment');
    node.build(builder, 'vec4');
  }

  builder.setBuildStage('generate');
  builder.setShaderStage('fragment');
  return node.build(builder, 'vec4');
}

const source = vec4(0.1, 0.2, 0.3, 0.4);
const scalarSplit = source.r;
const scalarMath = smoothstep(0.02, 0.08, scalarSplit);
const scalarOperator = scalarSplit.add(0.1);
const vector = source.rgb;

const splitSnippet = generateFragmentSnippet(await captureOutput(scalarSplit, 'scalar split'));
assert.doesNotMatch(splitSnippet, /vec3<[^>]+>/);
assert.equal(splitSnippet.match(/\.x/g)?.length, 3, splitSnippet);
assert.match(splitSnippet, /, 1\.0 \)$/);

for (const [name, node] of [
  ['scalar math', scalarMath],
  ['scalar operator', scalarOperator]
]) {
  const snippet = generateFragmentSnippet(await captureOutput(node, name));
  const match = snippet.match(/^vec4<[^>]+>\(\s*([^,\s]+),\s*\1,\s*\1,\s*1\.0\s*\)$/);
  assert.ok(match, `${name} was not expanded to grayscale: ${snippet}`);
}

const vectorSnippet = generateFragmentSnippet(await captureOutput(vector, 'vector'));
assert.match(vectorSnippet, /\.xyz,\s*1\.0\s*\)$/);

console.log('StatsGLNode scalar capture tests passed.');
