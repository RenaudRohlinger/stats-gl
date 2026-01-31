/**
 * StatsGLNode - TSL Node capture for stats-gl (WebGPU only)
 * Works in both main thread and Web Workers.
 *
 * Main Thread Usage:
 *   import { statsGL } from 'stats-gl/addons/StatsGLNode.js';
 *   someNode.toStatsGL('Name', stats);
 *
 * Worker Usage:
 *   import { flushCaptures } from 'stats-gl/addons/StatsGLNode.js';
 *   someNode.toStatsGL('Name');  // No stats needed in worker
 *   const captures = await flushCaptures(renderer);
 *   for (const { name, bitmap } of captures) {
 *     self.postMessage({ type: 'texture', name, bitmap }, [bitmap]);
 *   }
 */

import { addMethodChaining, nodeObject, vec3, vec4 } from 'three/tsl';
import { CanvasTarget, LinearSRGBColorSpace, NodeMaterial, NoToneMapping, QuadMesh, RendererUtils } from 'three/webgpu';

// Detect worker environment
const isWorker = typeof document === 'undefined';

/**
 * Capture data for TSL node rendering
 */
class CaptureData {
  constructor(name, node, stats, callback) {
    this.name = name;
    this.node = node;
    this.stats = stats;
    this.callback = callback;
    this.canvas = null;
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

      // Create canvas (OffscreenCanvas in workers, regular canvas in main thread)
      if (isWorker) {
        this.canvas = new OffscreenCanvas(this.size, this.size);
      } else {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.canvas.height = this.size;
      }

      // Create canvas target
      this.canvasTarget = new CanvasTarget(this.canvas);
      this.canvasTarget.setPixelRatio(isWorker ? 1 : (window.devicePixelRatio || 1));
      this.canvasTarget.setSize(this.size, this.size, false);

      // Create material - use vec4(vec3(node), 1) like Inspector does
      let output = vec4(vec3(captureNode), 1);
      output = output.context({ inspector: true });

      this.material = new NodeMaterial();
      this.material.outputNode = output;

      this.quad = new QuadMesh(this.material);

      // Create panel if not in worker and stats is provided
      if (!isWorker && this.stats && !this.stats.texturePanels.has(this.name)) {
        this.stats.addTexturePanel(this.name);
      }

      this.initialized = true;
      return true;
    } catch (e) {
      console.warn('StatsGL: Failed to initialize capture for', this.name, e);
      return false;
    }
  }

  async capture(renderer) {
    if (!this.initialized && !this.init(renderer)) return null;

    try {
      // Save renderer state
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

      // Create bitmap from canvas
      const bitmap = await createImageBitmap(this.canvas);

      // In main thread with stats, update panel directly
      if (!isWorker && this.stats) {
        const panel = this.stats.texturePanels.get(this.name);
        if (panel) {
          panel.updateTexture(bitmap);
        }
        return null; // Panel updated directly
      }

      // In worker or without stats, return bitmap
      return bitmap;
    } catch (e) {
      console.warn('StatsGL: Failed to capture for', this.name, e);
      return null;
    }
  }

  dispose() {
    if (this.material && this.material.dispose) {
      this.material.dispose();
    }
    if (!isWorker && this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.canvasTarget = null;
    this.quad = null;
    this.material = null;
    this.initialized = false;
  }
}

// Global registry for worker captures (when no stats instance)
const globalCaptures = new Map();

/**
 * Register a TSL node for capture. Returns the original node unchanged.
 *
 * @param {Node} node - The node to capture
 * @param {string} name - Panel name/label
 * @param {Stats|null} [stats=null] - Stats instance (optional in workers)
 * @param {Function|null} [callback=null] - Optional callback to transform the node for capture
 * @returns {Node} The original node (passthrough)
 */
export function statsGL(node, name, stats = null, callback = null) {
  node = nodeObject(node);

  const captureData = new CaptureData(name, node, stats, callback);

  if (stats) {
    // Main thread with stats - register on stats instance
    if (!stats._statsGLCaptures) {
      stats._statsGLCaptures = new Map();
    }
    stats._statsGLCaptures.set(name, captureData);
  } else {
    // Worker or no stats - use global registry
    globalCaptures.set(name, captureData);
  }

  return node;
}

/**
 * Capture all registered nodes and update panels (main thread with stats).
 * @param {Stats} stats - Stats instance
 * @param {WebGPURenderer} renderer - The renderer
 */
export function captureStatsGLNodes(stats, renderer) {
  const captures = stats._statsGLCaptures;
  if (!captures || captures.size === 0) return;

  for (const captureData of captures.values()) {
    captureData.capture(renderer);
  }
}

/**
 * Flush all captures and return ImageBitmaps (for workers or manual handling).
 * @param {WebGPURenderer} renderer - The renderer
 * @returns {Promise<Array<{name: string, bitmap: ImageBitmap}>>}
 */
export async function flushCaptures(renderer) {
  const results = [];

  for (const [name, captureData] of globalCaptures) {
    const bitmap = await captureData.capture(renderer);
    if (bitmap) {
      results.push({ name, bitmap });
    }
  }

  return results;
}

/**
 * Remove a registered capture
 * @param {Stats|null} stats - Stats instance (null for global/worker captures)
 * @param {string} name - Name of the capture to remove
 */
export function removeStatsGL(stats, name) {
  const captures = stats ? stats._statsGLCaptures : globalCaptures;
  if (!captures) return;

  const captureData = captures.get(name);
  if (captureData) {
    captureData.dispose();
    captures.delete(name);
  }
}

/**
 * Dispose all registered captures
 * @param {Stats|null} stats - Stats instance (null for global/worker captures)
 */
export function disposeStatsGLCaptures(stats) {
  const captures = stats ? stats._statsGLCaptures : globalCaptures;
  if (!captures) return;

  for (const captureData of captures.values()) {
    captureData.dispose();
  }
  captures.clear();
}

/**
 * Get list of registered capture names
 * @param {Stats|null} stats - Stats instance (null for global/worker captures)
 * @returns {string[]}
 */
export function getCaptureNames(stats) {
  const captures = stats ? stats._statsGLCaptures : globalCaptures;
  return captures ? Array.from(captures.keys()) : [];
}

// Register method chaining for TSL nodes
addMethodChaining('toStatsGL', statsGL);
