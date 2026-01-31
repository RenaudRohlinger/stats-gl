import{S as p}from"./main-a231d0d0.js";const t=document.querySelector("#glcanvas"),f=window.devicePixelRatio||1;function d(){t.width=Math.floor(t.clientWidth*f),t.height=Math.floor(t.clientHeight*f)}d();window.addEventListener("resize",d);const e=t.getContext("webgl2",{antialias:!0,alpha:!1}),o=new p({trackGPU:!0,trackHz:!0});await o.init(t);document.body.appendChild(o.dom);const r=256,c=e.createTexture();e.bindTexture(e.TEXTURE_2D,c);e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,r,r,0,e.RGBA,e.UNSIGNED_BYTE,null);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);const E=e.createFramebuffer();e.bindFramebuffer(e.FRAMEBUFFER,E);e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,c,0);const _=e.createTexture();e.bindTexture(e.TEXTURE_2D,_);e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,r,r,0,e.RGBA,e.UNSIGNED_BYTE,null);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);const T=e.createFramebuffer();e.bindFramebuffer(e.FRAMEBUFFER,T);e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,_,0);o.addTexturePanel("Color");o.addTexturePanel("Luma");o.setTextureWebGL("Color",E,r,r);o.setTextureWebGL("Luma",T,r,r);e.bindFramebuffer(e.FRAMEBUFFER,null);const s=e.createShader(e.VERTEX_SHADER);e.shaderSource(s,`#version 300 es
            in vec2 position;
            out vec2 vUv;
            void main() {
              vUv = position * 0.5 + 0.5;
              gl_Position = vec4(position, 0.0, 1.0);
            }
          `);e.compileShader(s);const l=e.createShader(e.FRAGMENT_SHADER);e.shaderSource(l,`#version 300 es
            precision highp float;
            in vec2 vUv;
            out vec4 fragColor;
            uniform float time;

            void main() {
              float x = vUv.x * 10.0;
              float y = vUv.y * 10.0;
              float t = time * 2.0;

              float v1 = sin(x + t);
              float v2 = sin(y + t);
              float v3 = sin(x + y + t);
              float v4 = sin(sqrt(x*x + y*y) + t);

              float v = (v1 + v2 + v3 + v4) * 0.25;

              vec3 color = vec3(
                sin(v * 3.14159) * 0.5 + 0.5,
                sin(v * 3.14159 + 2.094) * 0.5 + 0.5,
                sin(v * 3.14159 + 4.188) * 0.5 + 0.5
              );

              fragColor = vec4(color, 1.0);
            }
          `);e.compileShader(l);const a=e.createProgram();e.attachShader(a,s);e.attachShader(a,l);e.linkProgram(a);const x=e.getUniformLocation(a,"time"),R=e.createShader(e.VERTEX_SHADER);e.shaderSource(R,`#version 300 es
            in vec2 position;
            out vec2 vUv;
            void main() {
              vUv = position * 0.5 + 0.5;
              gl_Position = vec4(position, 0.0, 1.0);
            }
          `);e.compileShader(R);const m=e.createShader(e.FRAGMENT_SHADER);e.shaderSource(m,`#version 300 es
            precision highp float;
            in vec2 vUv;
            out vec4 fragColor;
            uniform sampler2D colorTex;

            void main() {
              vec3 color = texture(colorTex, vUv).rgb;
              // ITU-R BT.709 luminance coefficients
              float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
              fragColor = vec4(vec3(luma), 1.0);
            }
          `);e.compileShader(m);const n=e.createProgram();e.attachShader(n,R);e.attachShader(n,m);e.linkProgram(n);const g=e.getUniformLocation(n,"colorTex"),v=e.createShader(e.VERTEX_SHADER);e.shaderSource(v,`#version 300 es
            in vec2 position;
            out vec2 vUv;
            uniform float aspect;
            void main() {
              vUv = position * 0.5 + 0.5;
              vec2 pos = position * 0.4;
              pos.x /= aspect;
              gl_Position = vec4(pos, 0.0, 1.0);
            }
          `);e.compileShader(v);const u=e.createShader(e.FRAGMENT_SHADER);e.shaderSource(u,`#version 300 es
            precision highp float;
            in vec2 vUv;
            out vec4 fragColor;
            uniform sampler2D tex;
            void main() {
              fragColor = texture(tex, vUv);
            }
          `);e.compileShader(u);const i=e.createProgram();e.attachShader(i,v);e.attachShader(i,u);e.linkProgram(i);const S=e.getUniformLocation(i,"aspect"),b=e.getUniformLocation(i,"tex"),P=new Float32Array([-1,-1,1,-1,-1,1,1,1]),A=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,A);e.bufferData(e.ARRAY_BUFFER,P,e.STATIC_DRAW);e.getAttribLocation(a,"position");let D=performance.now();function U(){const F=(performance.now()-D)*.001,h=t.width/t.height;o.begin(),e.bindBuffer(e.ARRAY_BUFFER,A),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.bindFramebuffer(e.FRAMEBUFFER,E),e.viewport(0,0,r,r),e.clearColor(0,0,0,1),e.clear(e.COLOR_BUFFER_BIT),e.useProgram(a),e.uniform1f(x,F),e.drawArrays(e.TRIANGLE_STRIP,0,4),e.bindFramebuffer(e.FRAMEBUFFER,T),e.viewport(0,0,r,r),e.clearColor(0,0,0,1),e.clear(e.COLOR_BUFFER_BIT),e.useProgram(n),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,c),e.uniform1i(g,0),e.drawArrays(e.TRIANGLE_STRIP,0,4),e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,t.width,t.height),e.clearColor(.1,.1,.1,1),e.clear(e.COLOR_BUFFER_BIT),e.useProgram(i),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,c),e.uniform1i(b,0),e.uniform1f(S,h),e.drawArrays(e.TRIANGLE_STRIP,0,4),o.end(),o.update(),requestAnimationFrame(U)}U();
