import { StatsCore, StatsCoreOptions, StatsData } from './core';
import {
  TextureCaptureWebGL,
  TextureCaptureWebGPU,
  extractWebGLSource,
  extractWebGPUSource,
  ThreeTextureSource
} from './textureCapture';

export interface StatsProfilerOptions extends StatsCoreOptions {}

export class StatsProfiler extends StatsCore {
  private textureCaptureWebGL: TextureCaptureWebGL | null = null;
  private textureCaptureWebGPU: TextureCaptureWebGPU | null = null;

  constructor(options: StatsProfilerOptions = {}) {
    super(options);
  }

  public update(): void {
    this.endProfiling('cpu-started', 'cpu-finished', 'cpu-duration');

    if (!this.info) {
      this.processGpuQueries();
    } else {
      this.processWebGPUTimestamps();
    }

    const fps = this.calculateFps();
    this.addToAverage(fps, this.averageFps);

    this.updateAverages();
    this.resetCounters();
  }

  public getData(): StatsData {
    return super.getData();
  }

  /**
   * Capture a texture/render target to ImageBitmap for transfer to main thread
   * @param source - Three.js RenderTarget, GPUTexture, or WebGLFramebuffer with dimensions
   * @param sourceId - Unique identifier for this texture source (for per-source PBO buffering)
   * @returns ImageBitmap suitable for postMessage transfer
   */
  public async captureTexture(
    source: ThreeTextureSource | { framebuffer: WebGLFramebuffer; width: number; height: number } | any,
    sourceId: string = 'default'
  ): Promise<ImageBitmap | null> {
    // Handle WebGL sources
    if (this.gl) {
      if (!this.textureCaptureWebGL) {
        this.textureCaptureWebGL = new TextureCaptureWebGL(this.gl);
      }

      // Three.js WebGLRenderTarget
      if ((source as ThreeTextureSource).isWebGLRenderTarget) {
        const webglSource = extractWebGLSource(source as ThreeTextureSource, this.gl);
        if (webglSource) {
          return this.textureCaptureWebGL.capture(
            webglSource.framebuffer,
            webglSource.width,
            webglSource.height,
            sourceId
          );
        }
      }

      // Raw framebuffer with dimensions
      if (source.framebuffer && source.width && source.height) {
        return this.textureCaptureWebGL.capture(
          source.framebuffer,
          source.width,
          source.height,
          sourceId
        );
      }
    }

    // Handle WebGPU sources
    if (this.gpuDevice) {
      if (!this.textureCaptureWebGPU) {
        this.textureCaptureWebGPU = new TextureCaptureWebGPU(this.gpuDevice);
      }

      // Three.js WebGPU RenderTarget
      if ((source as ThreeTextureSource).isRenderTarget && this.gpuBackend) {
        const gpuTexture = extractWebGPUSource(source as ThreeTextureSource, this.gpuBackend);
        if (gpuTexture) {
          return this.textureCaptureWebGPU.capture(gpuTexture);
        }
      }

      // Raw GPUTexture
      if (source && typeof source.createView === 'function') {
        return this.textureCaptureWebGPU.capture(source);
      }
    }

    return null;
  }

  /**
   * Dispose texture capture resources
   */
  public disposeTextureCapture(): void {
    if (this.textureCaptureWebGL) {
      this.textureCaptureWebGL.dispose();
      this.textureCaptureWebGL = null;
    }
    if (this.textureCaptureWebGPU) {
      this.textureCaptureWebGPU.dispose();
      this.textureCaptureWebGPU = null;
    }
  }

  /**
   * Dispose of all resources
   */
  public override dispose(): void {
    this.disposeTextureCapture();
    super.dispose();
  }
}
