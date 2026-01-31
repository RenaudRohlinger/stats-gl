// WebGPU type declarations for stats-gl
// These are minimal declarations for the types used in texture capture and timestamp queries

interface GPUDevice {
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createCommandEncoder(): GPUCommandEncoder;
  createQuerySet(descriptor: GPUQuerySetDescriptor): GPUQuerySet;
  queue: GPUQueue;
  features: GPUSupportedFeatures;
}

interface GPUSupportedFeatures {
  has(feature: string): boolean;
}

interface GPUQuerySet {
  destroy(): void;
}

interface GPUQuerySetDescriptor {
  type: string;
  count: number;
}

interface GPUTexture {
  createView(): GPUTextureView;
  destroy(): void;
}

interface GPUTextureView {}

interface GPUBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GPUSampler {}

interface GPUShaderModule {}

interface GPUBindGroupLayout {}

interface GPUPipelineLayout {}

interface GPURenderPipeline {}

interface GPUBindGroup {}

interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
}

interface GPUCommandEncoder {
  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
  copyTextureToBuffer(source: GPUImageCopyTexture, destination: GPUImageCopyBuffer, copySize: GPUExtent3D): void;
  copyBufferToBuffer(source: GPUBuffer, sourceOffset: number, destination: GPUBuffer, destinationOffset: number, size: number): void;
  resolveQuerySet(querySet: GPUQuerySet, firstQuery: number, queryCount: number, destination: GPUBuffer, destinationOffset: number): void;
  finish(): GPUCommandBuffer;
}

interface GPURenderPassEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  draw(vertexCount: number): void;
  end(): void;
}

interface GPUCommandBuffer {}

interface GPUTextureDescriptor {
  size: { width: number; height: number };
  format: string;
  usage: number;
}

interface GPUBufferDescriptor {
  size: number;
  usage: number;
}

interface GPUSamplerDescriptor {
  minFilter?: string;
  magFilter?: string;
}

interface GPUShaderModuleDescriptor {
  code: string;
}

interface GPUBindGroupLayoutDescriptor {
  entries: GPUBindGroupLayoutEntry[];
}

interface GPUBindGroupLayoutEntry {
  binding: number;
  visibility: number;
  sampler?: { type: string };
  texture?: { sampleType: string };
}

interface GPUPipelineLayoutDescriptor {
  bindGroupLayouts: GPUBindGroupLayout[];
}

interface GPURenderPipelineDescriptor {
  layout: GPUPipelineLayout;
  vertex: {
    module: GPUShaderModule;
    entryPoint: string;
  };
  fragment: {
    module: GPUShaderModule;
    entryPoint: string;
    targets: { format: string }[];
  };
  primitive: {
    topology: string;
  };
}

interface GPUBindGroupDescriptor {
  layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
}

interface GPUBindGroupEntry {
  binding: number;
  resource: GPUSampler | GPUTextureView;
}

interface GPURenderPassDescriptor {
  colorAttachments: GPURenderPassColorAttachment[];
  timestampWrites?: GPURenderPassTimestampWrites;
}

interface GPURenderPassTimestampWrites {
  querySet: GPUQuerySet;
  beginningOfPassWriteIndex?: number;
  endOfPassWriteIndex?: number;
}

interface GPURenderPassColorAttachment {
  view: GPUTextureView;
  loadOp: string;
  storeOp: string;
  clearValue: { r: number; g: number; b: number; a: number };
}

interface GPUImageCopyTexture {
  texture: GPUTexture;
}

interface GPUImageCopyBuffer {
  buffer: GPUBuffer;
  bytesPerRow: number;
}

interface GPUExtent3D {
  width: number;
  height: number;
}

declare const GPUTextureUsage: {
  RENDER_ATTACHMENT: number;
  COPY_SRC: number;
};

declare const GPUBufferUsage: {
  COPY_DST: number;
  COPY_SRC: number;
  MAP_READ: number;
  QUERY_RESOLVE: number;
};

declare const GPUShaderStage: {
  FRAGMENT: number;
};

declare const GPUMapMode: {
  READ: number;
};
