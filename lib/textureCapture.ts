// Texture capture utilities for WebGPU and WebGL2

export interface TextureCaptureSource {
  // WebGL2
  framebuffer?: WebGLFramebuffer;
  width?: number;
  height?: number;
  // WebGPU
  gpuTexture?: GPUTexture;
  // Three.js WebGLRenderTarget
  isWebGLRenderTarget?: boolean;
  // Three.js RenderTarget (WebGPU)
  isRenderTarget?: boolean;
  texture?: any;
  __webglFramebuffer?: WebGLFramebuffer;
}

export interface CapturedPixels {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

// Default preview dimensions (matches full PANEL size for texture panels)
const DEFAULT_PREVIEW_WIDTH = 90;
const DEFAULT_PREVIEW_HEIGHT = 48;

// =============================================================================
// WebGL2 Texture Capture - PBO + fence async readback (no pipeline stall)
// =============================================================================

interface PendingReadWebGL {
  pbo: WebGLBuffer;
  fence: WebGLSync;
}

export class TextureCaptureWebGL {
  private gl: WebGL2RenderingContext;
  private previewFbo: WebGLFramebuffer | null = null;
  private previewTexture: WebGLTexture | null = null;
  private pixels: Uint8ClampedArray;
  private previewWidth: number;
  private previewHeight: number;
  private pending: Map<string, PendingReadWebGL> = new Map();
  private pboPool: WebGLBuffer[] = [];
  // Reused ImageData per source for the ImageBitmap (worker transfer) path
  private imageDataCache: Map<string, ImageData> = new Map();

  constructor(gl: WebGL2RenderingContext, width = DEFAULT_PREVIEW_WIDTH, height = DEFAULT_PREVIEW_HEIGHT) {
    this.gl = gl;
    this.previewWidth = width;
    this.previewHeight = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.initResources();
  }

  /**
   * Resize preview dimensions
   */
  resize(width: number, height: number): void {
    if (width === this.previewWidth && height === this.previewHeight) return;

    this.previewWidth = width;
    this.previewHeight = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.imageDataCache.clear();

    // Recreate resources with new dimensions (PBOs are size-dependent)
    this.dispose();
    this.initResources();
  }

  private initResources(): void {
    const gl = this.gl;

    // Create preview texture and FBO for downscaling
    this.previewTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.previewTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.previewWidth, this.previewHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.previewFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.previewFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.previewTexture, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Poll-based capture: issues an async readback (blit + PBO readPixels + fence)
   * and returns the PREVIOUS readback for this source once its fence signals.
   * Never blocks the GPU pipeline; results lag one capture tick.
   *
   * The returned pixel buffer is reused across calls - consume immediately.
   */
  public captureSync(
    source: WebGLFramebuffer | null,
    sourceWidth: number,
    sourceHeight: number,
    sourceId: string = 'default'
  ): CapturedPixels | null {
    const gl = this.gl;
    let result: CapturedPixels | null = null;

    // 1. Harvest the previous readback if its fence signaled
    const pending = this.pending.get(sourceId);
    if (pending) {
      const status = gl.getSyncParameter(pending.fence, gl.SYNC_STATUS);
      if (status !== gl.SIGNALED) {
        // GPU not done yet - don't queue more work for this source
        return null;
      }

      gl.deleteSync(pending.fence);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pending.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.pboPool.push(pending.pbo);
      this.pending.delete(sourceId);

      result = { pixels: this.pixels, width: this.previewWidth, height: this.previewHeight };
    }

    // 2. Issue the next readback
    const prevReadFbo = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const prevDrawFbo = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.previewFbo);
    // Inverted destination Y flips the image during the blit, so the readback
    // is already top-down and needs no CPU flip
    gl.blitFramebuffer(
      0, 0, sourceWidth, sourceHeight,
      0, this.previewHeight, this.previewWidth, 0,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR
    );

    const byteLength = this.previewWidth * this.previewHeight * 4;
    let pbo = this.pboPool.pop() ?? null;
    if (!pbo) {
      pbo = gl.createBuffer();
      if (pbo) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLength, gl.STREAM_READ);
      }
    } else {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    }

    if (pbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.previewFbo);
      // With a PIXEL_PACK buffer bound this is asynchronous
      gl.readPixels(0, 0, this.previewWidth, this.previewHeight, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (fence) {
        this.pending.set(sourceId, { pbo, fence });
      } else {
        this.pboPool.push(pbo);
      }
    }

    // Restore state
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevReadFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDrawFbo);

    return result;
  }

  /**
   * ImageBitmap capture (for worker transfer via postMessage).
   * Prefer captureSync() + PanelTexture.updatePixels() on the main thread.
   */
  public async capture(
    source: WebGLFramebuffer | null,
    sourceWidth: number,
    sourceHeight: number,
    sourceId: string = 'default'
  ): Promise<ImageBitmap | null> {
    const result = this.captureSync(source, sourceWidth, sourceHeight, sourceId);
    if (!result) return null;

    let imageData = this.imageDataCache.get(sourceId);
    if (!imageData || imageData.width !== result.width || imageData.height !== result.height) {
      imageData = new ImageData(result.width, result.height);
      this.imageDataCache.set(sourceId, imageData);
    }
    imageData.data.set(result.pixels);

    return createImageBitmap(imageData);
  }

  public removeSource(sourceId: string): void {
    const pending = this.pending.get(sourceId);
    if (pending) {
      this.gl.deleteSync(pending.fence);
      this.pboPool.push(pending.pbo);
      this.pending.delete(sourceId);
    }
    this.imageDataCache.delete(sourceId);
  }

  public dispose(): void {
    const gl = this.gl;
    for (const pending of this.pending.values()) {
      gl.deleteSync(pending.fence);
      gl.deleteBuffer(pending.pbo);
    }
    this.pending.clear();
    for (const pbo of this.pboPool) {
      gl.deleteBuffer(pbo);
    }
    this.pboPool.length = 0;
    this.imageDataCache.clear();
    if (this.previewFbo) {
      gl.deleteFramebuffer(this.previewFbo);
      this.previewFbo = null;
    }
    if (this.previewTexture) {
      gl.deleteTexture(this.previewTexture);
      this.previewTexture = null;
    }
  }
}

// =============================================================================
// WebGPU Texture Capture - batched blits, per-source staging, cached bind groups
// =============================================================================

export interface CaptureBatchEntry {
  key: string;
  texture: GPUTexture;
}

export interface CaptureBatchResult extends CapturedPixels {
  key: string;
}

export class TextureCaptureWebGPU {
  private device: GPUDevice;
  private previewTexture: GPUTexture | null = null;
  private previewView: any | null = null; // GPUTextureView
  private blitPipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private initialized = false;
  private previewWidth: number;
  private previewHeight: number;
  // Per-source resources, reused across captures
  private stagingBuffers: Map<string, GPUBuffer> = new Map();
  private pixelBuffers: Map<string, Uint8ClampedArray> = new Map();
  private imageDataCache: Map<string, ImageData> = new Map();
  // Bind groups cached per source texture; entries die with the texture
  private bindGroupCache: WeakMap<GPUTexture, GPUBindGroup> = new WeakMap();

  constructor(device: GPUDevice, width = DEFAULT_PREVIEW_WIDTH, height = DEFAULT_PREVIEW_HEIGHT) {
    this.device = device;
    this.previewWidth = width;
    this.previewHeight = height;
  }

  /**
   * Resize preview dimensions
   */
  resize(width: number, height: number): void {
    if (width === this.previewWidth && height === this.previewHeight) return;

    this.previewWidth = width;
    this.previewHeight = height;

    // Size-dependent resources are recreated lazily
    if (this.previewTexture) this.previewTexture.destroy();
    this.previewTexture = null;
    this.previewView = null;
    for (const buffer of this.stagingBuffers.values()) {
      if ((buffer as any).mapState === 'unmapped') buffer.destroy();
    }
    this.stagingBuffers.clear();
    this.pixelBuffers.clear();
    this.imageDataCache.clear();

    if (this.initialized) {
      this.createSizeResources();
    }
  }

  private get bytesPerRow(): number {
    return Math.ceil(this.previewWidth * 4 / 256) * 256;
  }

  private createSizeResources(): void {
    this.previewTexture = this.device.createTexture({
      size: { width: this.previewWidth, height: this.previewHeight },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    this.previewView = this.previewTexture.createView();
  }

  private initResources(): void {
    if (this.initialized) return;

    const device = this.device;

    this.createSizeResources();

    // Create sampler
    this.sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear'
    });

    // Create blit shader
    const shaderModule = device.createShaderModule({
      code: `
        @group(0) @binding(0) var texSampler: sampler;
        @group(0) @binding(1) var texInput: texture_2d<f32>;

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) uv: vec2f
        }

        @vertex
        fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
          var positions = array<vec2f, 3>(
            vec2f(-1.0, -1.0),
            vec2f(3.0, -1.0),
            vec2f(-1.0, 3.0)
          );
          var uvs = array<vec2f, 3>(
            vec2f(0.0, 1.0),
            vec2f(2.0, 1.0),
            vec2f(0.0, -1.0)
          );

          var output: VertexOutput;
          output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
          output.uv = uvs[vertexIndex];
          return output;
        }

        @fragment
        fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
          return textureSample(texInput, texSampler, uv);
        }
      `
    });

    // Create bind group layout
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
      ]
    });

    // Create pipeline
    this.blitPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba8unorm' }]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.initialized = true;
  }

  private getBindGroup(texture: GPUTexture): GPUBindGroup {
    let bindGroup = this.bindGroupCache.get(texture);
    if (!bindGroup) {
      bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout!,
        entries: [
          { binding: 0, resource: this.sampler! },
          { binding: 1, resource: texture.createView() }
        ]
      });
      this.bindGroupCache.set(texture, bindGroup);
    }
    return bindGroup;
  }

  private getStagingBuffer(key: string): GPUBuffer {
    let buffer = this.stagingBuffers.get(key);
    if (!buffer) {
      buffer = this.device.createBuffer({
        size: this.bytesPerRow * this.previewHeight,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      this.stagingBuffers.set(key, buffer);
    }
    return buffer;
  }

  /**
   * Capture several sources with a single command submission.
   * Per-source pixel buffers are reused across calls - consume immediately.
   */
  public async captureBatch(entries: CaptureBatchEntry[]): Promise<CaptureBatchResult[]> {
    this.initResources();

    if (!this.previewTexture || !this.blitPipeline || entries.length === 0) {
      return [];
    }

    const device = this.device;
    const bytesPerRow = this.bytesPerRow;
    const commandEncoder = device.createCommandEncoder();
    const jobs: Array<{ key: string; buffer: GPUBuffer }> = [];

    for (const { key, texture } of entries) {
      const buffer = this.getStagingBuffer(key);
      if ((buffer as any).mapState !== 'unmapped') continue; // previous readback in flight

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: this.previewView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 }
        }]
      });
      renderPass.setPipeline(this.blitPipeline);
      renderPass.setBindGroup(0, this.getBindGroup(texture));
      renderPass.draw(3);
      renderPass.end();

      // Commands execute in order: this copy completes before the next pass
      // overwrites the shared preview texture
      commandEncoder.copyTextureToBuffer(
        { texture: this.previewTexture },
        { buffer, bytesPerRow },
        { width: this.previewWidth, height: this.previewHeight }
      );

      jobs.push({ key, buffer });
    }

    if (jobs.length === 0) return [];

    device.queue.submit([commandEncoder.finish()]);

    const width = this.previewWidth;
    const height = this.previewHeight;

    const results = await Promise.all(jobs.map(async ({ key, buffer }) => {
      try {
        await buffer.mapAsync(GPUMapMode.READ);
      } catch (_) {
        return null; // buffer destroyed (resize/dispose) while mapping
      }

      let pixels = this.pixelBuffers.get(key);
      if (!pixels || pixels.length !== width * height * 4) {
        pixels = new Uint8ClampedArray(width * height * 4);
        this.pixelBuffers.set(key, pixels);
      }

      const data = new Uint8Array(buffer.getMappedRange());
      for (let y = 0; y < height; y++) {
        const srcOffset = y * bytesPerRow;
        const dstOffset = y * width * 4;
        pixels.set(data.subarray(srcOffset, srcOffset + width * 4), dstOffset);
      }
      buffer.unmap();

      return { key, pixels, width, height };
    }));

    return results.filter((r): r is CaptureBatchResult => r !== null);
  }

  /**
   * Single-source ImageBitmap capture (for worker transfer via postMessage).
   * Prefer captureBatch() + PanelTexture.updatePixels() on the main thread.
   */
  public async capture(source: GPUTexture, sourceId: string = 'default'): Promise<ImageBitmap | null> {
    const results = await this.captureBatch([{ key: sourceId, texture: source }]);
    if (results.length === 0) return null;

    const { pixels, width, height } = results[0];

    let imageData = this.imageDataCache.get(sourceId);
    if (!imageData || imageData.width !== width || imageData.height !== height) {
      imageData = new ImageData(width, height);
      this.imageDataCache.set(sourceId, imageData);
    }
    imageData.data.set(pixels);

    return createImageBitmap(imageData);
  }

  public removeSource(sourceId: string): void {
    const buffer = this.stagingBuffers.get(sourceId);
    if (buffer && (buffer as any).mapState === 'unmapped') {
      buffer.destroy();
    }
    this.stagingBuffers.delete(sourceId);
    this.pixelBuffers.delete(sourceId);
    this.imageDataCache.delete(sourceId);
  }

  public dispose(): void {
    if (this.previewTexture) this.previewTexture.destroy();
    this.previewTexture = null;
    this.previewView = null;
    for (const buffer of this.stagingBuffers.values()) {
      if ((buffer as any).mapState === 'unmapped') buffer.destroy();
    }
    this.stagingBuffers.clear();
    this.pixelBuffers.clear();
    this.imageDataCache.clear();
    this.blitPipeline = null;
    this.sampler = null;
    this.bindGroupLayout = null;
    this.initialized = false;
  }
}

// =============================================================================
// Three.js helper to extract native handles
// =============================================================================

export interface ThreeTextureSource {
  // WebGLRenderTarget
  isWebGLRenderTarget?: boolean;
  __webglFramebuffer?: WebGLFramebuffer;
  width?: number;
  height?: number;
  // WebGPU RenderTarget
  isRenderTarget?: boolean;
  texture?: { isTexture?: boolean };
}

export interface ThreeRendererBackend {
  device?: GPUDevice;
  get?: (texture: any) => { texture?: GPUTexture };
}

export function extractWebGLSource(
  target: ThreeTextureSource,
  gl: WebGL2RenderingContext
): { framebuffer: WebGLFramebuffer; width: number; height: number } | null {
  if (target.isWebGLRenderTarget && target.__webglFramebuffer) {
    return {
      framebuffer: target.__webglFramebuffer,
      width: target.width || 1,
      height: target.height || 1
    };
  }
  return null;
}

export function extractWebGPUSource(
  target: ThreeTextureSource,
  backend: ThreeRendererBackend
): GPUTexture | null {
  if (target.isRenderTarget && target.texture && backend.get) {
    const textureData = backend.get(target.texture);
    return textureData?.texture || null;
  }
  return null;
}

export { DEFAULT_PREVIEW_WIDTH, DEFAULT_PREVIEW_HEIGHT };
