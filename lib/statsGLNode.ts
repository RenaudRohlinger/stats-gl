/**
 * TSL Node capture utilities for stats-gl
 *
 * For WebGPU TSL node capture with proper Node integration, use the addon:
 *   import { statsGL } from 'stats-gl/addons/StatsGLNode.js';
 *
 * This file provides a simpler capture system that doesn't require
 * extending Three.js Node class.
 */

interface StatsGLNodeData {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  canvasTarget: any;
  quad: any;
  material: any;
  node: any;
}

/**
 * Manages TSL node capture for stats-gl (used internally)
 */
export class StatsGLCapture {
  nodes: Map<string, StatsGLNodeData> = new Map();
  width = 90;
  height = 48;
  private THREE: any;

  constructor(THREE: any, width = 90, height = 48) {
    this.THREE = THREE;
    this.width = width;
    this.height = height;
  }

  /**
   * Update capture dimensions (e.g., on resize)
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    // Update all existing nodes
    for (const [name, data] of this.nodes) {
      if (data.canvas instanceof HTMLCanvasElement) {
        data.canvas.width = width;
        data.canvas.height = height;
      } else if (data.canvas instanceof OffscreenCanvas) {
        // OffscreenCanvas can't be resized - recreate
        const newCanvas = new OffscreenCanvas(width, height);
        data.canvas = newCanvas;
        data.canvasTarget.setCanvas?.(newCanvas);
      }
      data.canvasTarget.setSize(width, height);
    }
  }

  register(name: string, targetNode: any): StatsGLNodeData {
    if (this.nodes.has(name)) return this.nodes.get(name)!;

    const { CanvasTarget, NodeMaterial, QuadMesh, NoToneMapping, LinearSRGBColorSpace } = this.THREE;
    const { renderOutput, vec3, vec4 } = this.THREE;

    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(this.width, this.height)
      : document.createElement('canvas');
    if (canvas instanceof HTMLCanvasElement) {
      canvas.width = this.width;
      canvas.height = this.height;
    }

    const canvasTarget = new CanvasTarget(canvas);
    canvasTarget.setSize(this.width, this.height);

    const material = new NodeMaterial();
    material.outputNode = renderOutput(
      vec4(vec3(targetNode), 1),
      NoToneMapping,
      LinearSRGBColorSpace
    );

    const quad = new QuadMesh(material);
    const data: StatsGLNodeData = { canvas, canvasTarget, quad, material, node: targetNode };
    this.nodes.set(name, data);
    return data;
  }

  async capture(name: string, renderer: any): Promise<ImageBitmap | null> {
    const data = this.nodes.get(name);
    if (!data) return null;

    try {
      data.quad.render(renderer, data.canvasTarget);
      return await createImageBitmap(data.canvas);
    } catch (e) {
      return null;
    }
  }

  remove(name: string): void {
    const data = this.nodes.get(name);
    if (data) {
      // Dispose material if it has dispose method
      if (data.material && data.material.dispose) {
        data.material.dispose();
      }
      // Remove canvas from DOM if attached
      if (data.canvas instanceof HTMLCanvasElement && data.canvas.parentNode) {
        data.canvas.parentNode.removeChild(data.canvas);
      }
      this.nodes.delete(name);
    }
  }

  /**
   * Dispose all capture resources
   */
  dispose(): void {
    // Copy keys to array to avoid modifying map while iterating
    const names = Array.from(this.nodes.keys());
    for (const name of names) {
      this.remove(name);
    }
    this.nodes.clear();
  }
}
