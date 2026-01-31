/**
 * StatsGLNodeWorker - TSL Node capture for stats-gl in Web Workers (WebGPU only)
 *
 * Usage:
 *   import { statsGLWorker, flushCaptures } from 'stats-gl/addons/StatsGLNodeWorker.js';
 *   import { addMethodChaining } from 'three/tsl';
 *
 *   addMethodChaining('toStatsGL', statsGLWorker);
 *
 *   // Simple capture (name only, no stats instance needed):
 *   someNode.toStatsGL('Name');
 *
 *   // With callback for transformed capture:
 *   depthNode.toStatsGL('Depth', null, () => linearDepthNode);
 *
 *   // In render loop after postProcessing.render():
 *   const captures = await flushCaptures(renderer);
 *   for (const { name, bitmap } of captures) {
 *     self.postMessage({ type: 'texture', name, bitmap }, [bitmap]);
 *   }
 */

import { addMethodChaining, nodeObject, vec3, vec4 } from 'three/tsl';
import { CanvasTarget, LinearSRGBColorSpace, NodeMaterial, NoToneMapping, QuadMesh, RendererUtils } from 'three/webgpu';

/**
 * Capture data for worker environment (uses OffscreenCanvas)
 */
class WorkerCaptureData {
  constructor(name, node, callback) {
    this.name = name;
    this.node = node;
    this.callback = callback;
    this.canvas = null;        // OffscreenCanvas
    this.canvasTarget = null;
    this.quad = null;
    this.material = null;
    this.initialized = false;
    this.size = 90;
  }

  init(renderer) {
    if (this.initialized) return true;

    try {
      // Determine which node to capture
      let captureNode = this.node;
      if (this.callback !== null) {
        captureNode = this.callback(this.node);
      }
      captureNode = nodeObject(captureNode);

      // Create OffscreenCanvas (worker-compatible)
      this.canvas = new OffscreenCanvas(this.size, this.size);

      // Create canvas target - set pixelRatio to 1 for workers (no window.devicePixelRatio)
      // Pass false for updateStyle since OffscreenCanvas has no style property
      this.canvasTarget = new CanvasTarget(this.canvas);
      this.canvasTarget.setPixelRatio(1);
      this.canvasTarget.setSize(this.size, this.size, false);

      // Create material - use vec4(vec3(node), 1) like Inspector does
      let output = vec4(vec3(captureNode), 1);
      // Mark as inspector context
      output = output.context({ inspector: true });

      this.material = new NodeMaterial();
      this.material.outputNode = output;

      this.quad = new QuadMesh(this.material);

      this.initialized = true;
      return true;
    } catch (e) {
      console.warn('StatsGLWorker: Failed to initialize capture for', this.name, e);
      return false;
    }
  }

  async capture(renderer) {
    if (!this.initialized && !this.init(renderer)) return null;

    try {
      // Save renderer state (like Inspector's Viewer does)
      const previousCanvasTarget = renderer.getCanvasTarget();
      const state = RendererUtils.resetRendererState(renderer);

      // Set rendering parameters
      renderer.toneMapping = NoToneMapping;
      renderer.outputColorSpace = LinearSRGBColorSpace;

      // Set our canvas target
      renderer.setCanvasTarget(this.canvasTarget);

      // Render the quad
      this.quad.render(renderer);

      // Restore original canvas target and state
      renderer.setCanvasTarget(previousCanvasTarget);
      RendererUtils.restoreRendererState(renderer, state);

      // Create bitmap from OffscreenCanvas for transfer
      return await createImageBitmap(this.canvas);
    } catch (e) {
      console.warn('StatsGLWorker: Failed to capture for', this.name, e);
      return null;
    }
  }

  dispose() {
    if (this.material && this.material.dispose) {
      this.material.dispose();
    }
    this.canvas = null;
    this.canvasTarget = null;
    this.quad = null;
    this.material = null;
    this.initialized = false;
  }
}

// Global registry of captures for worker environment
const workerCaptures = new Map();

/**
 * Register a TSL node for capture in worker environment. Returns the original node unchanged.
 *
 * @param {Node} node - The node to capture
 * @param {string} name - Panel name/label
 * @param {null} _stats - Unused (for API compatibility with main thread version)
 * @param {Function|null} [callback=null] - Optional callback to transform the node for capture
 * @returns {Node} The original node (passthrough)
 */
export function statsGLWorker(node, name, _stats = null, callback = null) {
  node = nodeObject(node);

  // Create capture data
  const captureData = new WorkerCaptureData(name, node, callback);

  // Register in global map
  workerCaptures.set(name, captureData);

  // Return original node unchanged - this is a side effect only
  return node;
}

/**
 * Flush all pending captures and return ImageBitmaps for transfer to main thread.
 * Call this after your render loop.
 *
 * @param {WebGPURenderer} renderer - The WebGPU renderer
 * @returns {Promise<Array<{name: string, bitmap: ImageBitmap}>>} Array of captures ready for postMessage
 */
export async function flushCaptures(renderer) {
  const results = [];

  for (const [name, captureData] of workerCaptures) {
    const bitmap = await captureData.capture(renderer);
    if (bitmap) {
      results.push({ name, bitmap });
    }
  }

  return results;
}

/**
 * Remove a registered capture
 * @param {string} name - Name of the capture to remove
 */
export function removeCapture(name) {
  const captureData = workerCaptures.get(name);
  if (captureData) {
    captureData.dispose();
    workerCaptures.delete(name);
  }
}

/**
 * Dispose all registered captures
 */
export function disposeAllCaptures() {
  for (const captureData of workerCaptures.values()) {
    captureData.dispose();
  }
  workerCaptures.clear();
}

/**
 * Get list of registered capture names
 * @returns {string[]} Array of capture names
 */
export function getCaptureNames() {
  return Array.from(workerCaptures.keys());
}

// Register method chaining for TSL nodes
addMethodChaining('toStatsGL', statsGLWorker);
