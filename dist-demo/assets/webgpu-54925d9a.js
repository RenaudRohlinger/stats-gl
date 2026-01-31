import{S as q}from"./main-a231d0d0.js";async function T(){const t=document.querySelector("#gpucanvas");if(!navigator.gpu){document.body.innerHTML='<div class="error-message">WebGPU is not supported in this browser.<br>Try Chrome 113+ or Edge 113+.</div>';return}const i=await navigator.gpu.requestAdapter();if(!i){document.body.innerHTML='<div class="error-message">Failed to get WebGPU adapter.</div>';return}const u=i.features.has("timestamp-query"),h=u?["timestamp-query"]:[],e=await i.requestDevice({requiredFeatures:h});u||console.warn("Stats-GL: timestamp-query not supported, GPU timing will not be available");const c=t.getContext("webgpu"),d=navigator.gpu.getPreferredCanvasFormat();c.configure({device:e,format:d,alphaMode:"opaque"});const o=new q({trackGPU:!0,trackHz:!0});await o.init(e),document.body.appendChild(o.dom);const p=e.createShaderModule({code:`
            struct Uniforms {
              rotation: f32,
              aspect: f32,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            struct VertexOutput {
              @builtin(position) position: vec4f,
              @location(0) uv: vec2f,
            }

            @vertex
            fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
              // Triangle vertices
              var positions = array<vec2f, 3>(
                vec2f(0.0, 1.0),      // top
                vec2f(-0.866, -0.5),  // bottom left
                vec2f(0.866, -0.5)    // bottom right
              );

              var uvs = array<vec2f, 3>(
                vec2f(0.5, 0.0),  // top
                vec2f(0.0, 1.0),  // bottom left
                vec2f(1.0, 1.0)   // bottom right
              );

              let pos = positions[vertexIndex];
              let uv = uvs[vertexIndex];

              // Apply rotation and aspect ratio
              let scale = min(1.0, uniforms.aspect) * 0.5;
              let c = cos(uniforms.rotation);
              let s = sin(uniforms.rotation);
              let rotated = vec2f(
                pos.x * c - pos.y * s,
                pos.x * s + pos.y * c
              ) * scale;

              var output: VertexOutput;
              output.position = vec4f(rotated.x / uniforms.aspect, rotated.y, 0.0, 1.0);
              output.uv = uv;
              return output;
            }

            @fragment
            fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
              // Create RGB from UV coordinates
              return vec4f(uv.x, uv.y, 1.0 - (uv.x + uv.y) * 0.5, 1.0);
            }
          `}),f=e.createBuffer({size:8,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),l=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"uniform"}}]}),x=e.createPipelineLayout({bindGroupLayouts:[l]}),P=e.createRenderPipeline({layout:x,vertex:{module:p,entryPoint:"vertexMain"},fragment:{module:p,entryPoint:"fragmentMain",targets:[{format:d}]},primitive:{topology:"triangle-list"}}),w=e.createBindGroup({layout:l,entries:[{binding:0,resource:{buffer:f}}]});let m=0,v=0;function g(y=0){const G=(y-v)*.001;v=y,m+=G;const b=window.devicePixelRatio||1,n=Math.floor(t.clientWidth*b),a=Math.floor(t.clientHeight*b);(t.width!==n||t.height!==a)&&(t.width=n,t.height=a);const U=n/a,M=new Float32Array([m,U]);e.queue.writeBuffer(f,0,M);const s=e.createCommandEncoder();o.begin();const r=s.beginRenderPass({colorAttachments:[{view:c.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:{r:.1,g:.1,b:.1,a:1}}],timestampWrites:o.getTimestampWrites()});r.setPipeline(P),r.setBindGroup(0,w),r.draw(3),r.end(),o.end(s),e.queue.submit([s.finish()]),o.update(),requestAnimationFrame(g)}g()}T().catch(t=>{console.error("WebGPU initialization failed:",t),document.body.innerHTML=`<div class="error-message">WebGPU initialization failed:<br>${t.message}</div>`});
