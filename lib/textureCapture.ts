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

// Default preview dimensions (matches full PANEL size for texture panels)
const DEFAULT_PREVIEW_WIDTH = 90;
const DEFAULT_PREVIEW_HEIGHT = 48;

// =============================================================================
// WebGL2 Texture Capture with PBO double-buffering
// =============================================================================

export class TextureCaptureWebGL {
  private gl: WebGL2RenderingContext;
  private previewFbo: WebGLFramebuffer | null = null;
  private previewTexture: WebGLTexture | null = null;
  private pixels: Uint8Array;
  private flippedPixels: Uint8Array;
  private previewWidth: number;
  private previewHeight: number;

  constructor(gl: WebGL2RenderingContext, width = DEFAULT_PREVIEW_WIDTH, height = DEFAULT_PREVIEW_HEIGHT) {
    this.gl = gl;
    this.previewWidth = width;
    this.previewHeight = height;
    this.pixels = new Uint8Array(width * height * 4);
    this.flippedPixels = new Uint8Array(width * height * 4);
    this.initResources();
  }

  /**
   * Resize preview dimensions
   */
  resize(width: number, height: number): void {
    if (width === this.previewWidth && height === this.previewHeight) return;

    this.previewWidth = width;
    this.previewHeight = height;
    this.pixels = new Uint8Array(width * height * 4);
    this.flippedPixels = new Uint8Array(width * height * 4);

    // Recreate resources with new dimensions
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

  public async capture(
    source: WebGLFramebuffer | null,
    sourceWidth: number,
    sourceHeight: number,
    _sourceId: string = 'default'
  ): Promise<ImageBitmap | null> {
    const gl = this.gl;

    // Save current state
    const prevReadFbo = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const prevDrawFbo = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);

    // Blit source to preview FBO with LINEAR filtering (downscale)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.previewFbo);
    gl.blitFramebuffer(
      0, 0, sourceWidth, sourceHeight,
      0, 0, this.previewWidth, this.previewHeight,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR
    );

    // Synchronous read - fine for small preview
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.previewFbo);
    gl.readPixels(0, 0, this.previewWidth, this.previewHeight, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);

    // Restore state
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevReadFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDrawFbo);

    // Flip Y axis (WebGL has origin at bottom-left)
    const flipped = this.flipY(this.pixels, this.previewWidth, this.previewHeight);
    const imageData = new ImageData(new Uint8ClampedArray(flipped), this.previewWidth, this.previewHeight);

    return createImageBitmap(imageData);
  }

  private flipY(pixels: Uint8Array, width: number, height: number): Uint8Array {
    const rowSize = width * 4;
    for (let y = 0; y < height; y++) {
      const srcOffset = y * rowSize;
      const dstOffset = (height - 1 - y) * rowSize;
      this.flippedPixels.set(pixels.subarray(srcOffset, srcOffset + rowSize), dstOffset);
    }
    return this.flippedPixels;
  }

  public removeSource(_sourceId: string): void {
    // No per-source state in sync mode
  }

  public dispose(): void {
    const gl = this.gl;
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
// WebGPU Texture Capture with blit pipeline and staging buffer
// =============================================================================

export class TextureCaptureWebGPU {
  private device: GPUDevice;
  private previewTexture: GPUTexture | null = null;
  private stagingBuffer: GPUBuffer | null = null;
  private blitPipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private initialized = false;
  private previewWidth: number;
  private previewHeight: number;
  private pixelsBuffer: Uint8ClampedArray;

  constructor(device: GPUDevice, width = DEFAULT_PREVIEW_WIDTH, height = DEFAULT_PREVIEW_HEIGHT) {
    this.device = device;
    this.previewWidth = width;
    this.previewHeight = height;
    this.pixelsBuffer = new Uint8ClampedArray(width * height * 4);
  }

  /**
   * Resize preview dimensions
   */
  resize(width: number, height: number): void {
    if (width === this.previewWidth && height === this.previewHeight) return;

    this.previewWidth = width;
    this.previewHeight = height;
    this.pixelsBuffer = new Uint8ClampedArray(width * height * 4);

    // Dispose texture and buffer (they need new dimensions)
    if (this.previewTexture) this.previewTexture.destroy();
    if (this.stagingBuffer) this.stagingBuffer.destroy();
    this.previewTexture = null;
    this.stagingBuffer = null;

    // Recreate on next capture
    if (this.initialized) {
      this.createSizeResources();
    }
  }

  private createSizeResources(): void {
    const device = this.device;

    // Create preview texture
    this.previewTexture = device.createTexture({
      size: { width: this.previewWidth, height: this.previewHeight },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });

    // Create staging buffer for readback
    const bytesPerRow = Math.ceil(this.previewWidth * 4 / 256) * 256;
    this.stagingBuffer = device.createBuffer({
      size: bytesPerRow * this.previewHeight,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }

  private async initResources(): Promise<void> {
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

  public async capture(source: GPUTexture): Promise<ImageBitmap | null> {
    await this.initResources();

    if (!this.previewTexture || !this.stagingBuffer || !this.blitPipeline || !this.sampler || !this.bindGroupLayout) {
      return null;
    }

    const device = this.device;

    // Create bind group for source texture
    const bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: source.createView() }
      ]
    });

    // Blit source to preview texture
    const commandEncoder = device.createCommandEncoder();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.previewTexture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }]
    });

    renderPass.setPipeline(this.blitPipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(3);
    renderPass.end();

    // Copy to staging buffer
    const bytesPerRow = Math.ceil(this.previewWidth * 4 / 256) * 256;
    commandEncoder.copyTextureToBuffer(
      { texture: this.previewTexture },
      { buffer: this.stagingBuffer, bytesPerRow },
      { width: this.previewWidth, height: this.previewHeight }
    );

    device.queue.submit([commandEncoder.finish()]);

    // Map and read staging buffer
    await this.stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(this.stagingBuffer.getMappedRange());

    // Copy data (accounting for row alignment) into pre-allocated buffer
    for (let y = 0; y < this.previewHeight; y++) {
      const srcOffset = y * bytesPerRow;
      const dstOffset = y * this.previewWidth * 4;
      this.pixelsBuffer.set(data.subarray(srcOffset, srcOffset + this.previewWidth * 4), dstOffset);
    }

    this.stagingBuffer.unmap();

    // ImageData needs its own Uint8ClampedArray - create from pre-allocated buffer
    const imageData = new ImageData(new Uint8ClampedArray(this.pixelsBuffer), this.previewWidth, this.previewHeight);
    return createImageBitmap(imageData);
  }

  public dispose(): void {
    if (this.previewTexture) this.previewTexture.destroy();
    if (this.stagingBuffer) this.stagingBuffer.destroy();
    this.previewTexture = null;
    this.stagingBuffer = null;
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
