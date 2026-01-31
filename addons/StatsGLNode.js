/**
 * StatsGLNode - TSL Node capture for stats-gl (WebGPU only)
 *
 * Usage:
 *   import { statsGL } from 'stats-gl/addons/StatsGLNode.js';
 *   import { addMethodChaining } from 'three/tsl';
 *
 *   addMethodChaining('toStatsGL', statsGL);
 *
 *   // Simple capture:
 *   someNode.toStatsGL('Name', stats);
 *
 *   // With callback for transformed capture:
 *   depthNode.toStatsGL('Depth', stats, () => linearDepthNode);
 */

import { addMethodChaining, nodeObject, vec3, vec4 } from 'three/tsl';
import { CanvasTarget, LinearSRGBColorSpace, NodeMaterial, NoToneMapping, QuadMesh, RendererUtils } from 'three/webgpu';

/**
 * Capture data stored on stats instance
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

      // Create canvas
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = this.size;

      // Create canvas target (must set pixelRatio before size)
      this.canvasTarget = new CanvasTarget(this.canvas);
      this.canvasTarget.setPixelRatio(window.devicePixelRatio);
      this.canvasTarget.setSize(this.size, this.size);

      // Create material - use vec4(vec3(node), 1) like Inspector does
      // For testing: use vec4(1, 0, 0, 1) for red
      let output = vec4(vec3(captureNode), 1);
      // Mark as inspector context
      output = output.context({ inspector: true });

      this.material = new NodeMaterial();
      this.material.outputNode = output;

      this.quad = new QuadMesh(this.material);

      // Create panel if not exists
      if (!this.stats.texturePanels.has(this.name)) {
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
    if (!this.initialized && !this.init(renderer)) return;

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

      // Create bitmap from canvas
      const bitmap = await createImageBitmap(this.canvas);
      const panel = this.stats.texturePanels.get(this.name);
      if (panel) {
        panel.updateTexture(bitmap);
      }
    } catch (e) {
      console.warn('StatsGL: Failed to capture for', this.name, e);
    }
  }

  dispose() {
    if (this.material && this.material.dispose) {
      this.material.dispose();
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.canvasTarget = null;
    this.quad = null;
    this.material = null;
    this.initialized = false;
  }
}

/**
 * Register a TSL node for capture. Returns the original node unchanged.
 * Capture happens in stats.update() after the main render.
 *
 * @param {Node} node - The node to capture
 * @param {string} name - Panel name/label
 * @param {Stats} stats - Stats instance (must have called stats.init(renderer))
 * @param {Function|null} [callback=null] - Optional callback to transform the node for capture
 * @returns {Node} The original node (passthrough)
 */
export function statsGL(node, name, stats, callback = null) {
  node = nodeObject(node);

  // Create capture data
  const captureData = new CaptureData(name, node, stats, callback);

  // Register with stats
  if (!stats._statsGLCaptures) {
    stats._statsGLCaptures = new Map();
  }
  stats._statsGLCaptures.set(name, captureData);

  // Return original node unchanged - this is a side effect only
  return node;
}

/**
 * Call this in stats.update() to capture all registered nodes.
 * The renderer must be passed from stats.init().
 */
export function captureStatsGLNodes(stats, renderer) {
  const captures = stats._statsGLCaptures;
  if (!captures || captures.size === 0) return;

  for (const captureData of captures.values()) {
    captureData.capture(renderer);
  }
}

/**
 * Remove a registered TSL node capture
 * @param {Stats} stats - Stats instance
 * @param {string} name - Name of the capture to remove
 */
export function removeStatsGL(stats, name) {
  const captures = stats._statsGLCaptures;
  if (!captures) return;

  const captureData = captures.get(name);
  if (captureData) {
    captureData.dispose();
    captures.delete(name);
  }
}

/**
 * Dispose all registered TSL node captures
 * @param {Stats} stats - Stats instance
 */
export function disposeStatsGLCaptures(stats) {
  const captures = stats._statsGLCaptures;
  if (!captures) return;

  for (const captureData of captures.values()) {
    captureData.dispose();
  }
  captures.clear();
}



// User sets up chaining for TSL nodes
addMethodChaining('toStatsGL', statsGL);
