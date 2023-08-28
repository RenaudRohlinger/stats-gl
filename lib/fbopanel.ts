import Panel from "./panel";
import { WebGLRenderTarget, LinearFilter, RGBAFormat } from 'three';
import { PlaneGeometry, ShaderMaterial, OrthographicCamera, Mesh, Scene } from 'three';

class FBOPanel extends Panel {
    renderer: any;
    scene: any;
    camera: any;
    stats: any;
    fbo: WebGLRenderTarget | WebGLFramebuffer | null = null;

    // For displaying FBO's content
    displayScene: Scene | undefined;
    displayCamera: OrthographicCamera | undefined;
    displayMesh: Mesh | undefined;
    onBeforeRender: (() => void) = () => {};
    onAfterRender: (() => void) = () => {};
    render: (() => void);
    constructor(stats: any, name: string, fg: string, bg: string, renderer: any, scene: any, camera: any, render: any = () => { this.renderer.render(this.scene, this.camera); }, onBeforeRender: any = () => {}, onAfterRender: any = () => {}) {
        super(name, fg, bg);
        this.stats = stats;
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        this.init();

        this.onBeforeRender = onBeforeRender.bind(this);
        this.onAfterRender = onAfterRender.bind(this);
        this.render = render.bind(this);

        this.context?.clearRect(0, 0, this.WIDTH, this.HEIGHT);
    }
    init() {

        if (this.renderer.isWebGLRenderer) {
            this.fbo = new WebGLRenderTarget(this.WIDTH, this.HEIGHT, {
                minFilter: LinearFilter,
                magFilter: LinearFilter,
                format: RGBAFormat
            });

            this.initDisplay()

        } else if (this.renderer instanceof WebGL2RenderingContext) {
            this.fbo = this.renderer.createFramebuffer();
            const texture = this.renderer.createTexture();
            this.renderer.bindTexture(this.renderer.TEXTURE_2D, texture);
            this.renderer.texImage2D(this.renderer.TEXTURE_2D, 0, this.renderer.RGBA, this.WIDTH, this.HEIGHT, 0, this.renderer.RGBA, this.renderer.UNSIGNED_BYTE, null);
            this.renderer.bindFramebuffer(this.renderer.FRAMEBUFFER, this.fbo);
            this.renderer.framebufferTexture2D(this.renderer.FRAMEBUFFER, this.renderer.COLOR_ATTACHMENT0, this.renderer.TEXTURE_2D, texture, 0);
        }
    }


    initDisplay() {
        this.displayScene = new Scene();
        this.displayCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const geometry = new PlaneGeometry(2, 2);

        // Shader material that simply samples the texture and renders it
        const material = new ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = texture2D(tDiffuse, vUv);
                }
            `,
        });

        this.displayMesh = new Mesh(geometry, material);
        this.displayScene.add(this.displayMesh);
    }


    resize(width: number, height: number) {
        // Resize the FBO here based on its type
        if (this.fbo instanceof WebGLRenderTarget) {
            this.fbo.setSize(width, height);
        } else if (this.fbo instanceof WebGLFramebuffer && this.renderer instanceof WebGL2RenderingContext) {
            // Resize for webgl2 would be more involved as you'll need to rebind and reattach the texture to the FBO.
            // The below is a basic approach, but you might need to extend it based on your needs.
            const texture = this.renderer.createTexture();
            this.renderer.bindTexture(this.renderer.TEXTURE_2D, texture);
            this.renderer.texImage2D(this.renderer.TEXTURE_2D, 0, this.renderer.RGBA, width, height, 0, this.renderer.RGBA, this.renderer.UNSIGNED_BYTE, null);
            this.renderer.bindFramebuffer(this.renderer.FRAMEBUFFER, this.fbo);
            this.renderer.framebufferTexture2D(this.renderer.FRAMEBUFFER, this.renderer.COLOR_ATTACHMENT0, this.renderer.TEXTURE_2D, texture, 0);
        }
    }

    renderBufferDirect() {
        if (this.renderer && this.displayMesh && this.fbo && this.displayScene && this.displayCamera) {
            this.stats.disabled = true;

            this.onBeforeRender()

            this.renderer.setRenderTarget(this.fbo);
            this.render()

            const shader = this.displayMesh.material as ShaderMaterial;
            shader.uniforms.tDiffuse.value = this.fbo.texture;

            this.renderer.setRenderTarget(null);  // render to screen
    
            this.renderer.render(this.displayScene, this.displayCamera);
    
            this.onAfterRender()

            this.context.fillStyle = this.bg;
            this.context.fillRect(0, 0, this.WIDTH, this.HEIGHT);


            const sourceAspectRatio = this.renderer.domElement.width / this.renderer.domElement.height;

            let targetWidth, targetHeight;

            const width = this.WIDTH;
            const height = this.HEIGHT;
            const targetAspectRatio = this.WIDTH / this.HEIGHT;

            if (sourceAspectRatio > targetAspectRatio) {
                // Width is the limiting factor
                targetWidth = width;
                targetHeight = width / sourceAspectRatio;
            } else {
                // Height is the limiting factor
                targetHeight = height;
                targetWidth = height * sourceAspectRatio;
            }

            const offsetX = (width - targetWidth) * 0.5;
            const offsetY = (height - targetHeight) * 0.5;

            this.context.drawImage(this.renderer.domElement, offsetX, offsetY, targetWidth, targetHeight);


            this.context.font = 'bold ' + (9 * this.PR) + 'px Helvetica,Arial,sans-serif';
            this.context.textBaseline = 'top';

            this.context.fillStyle = this.bg;
            this.context.globalAlpha = 0.8;
            this.context.fillRect(0, 0, this.WIDTH, this.GRAPH_Y);
            this.context.globalAlpha = 1;

            this.context.fillStyle = this.fg;
            this.context.fillText(this.name, this.TEXT_X, this.TEXT_Y);

            // this.context.fillRect(this.GRAPH_X, this.GRAPH_Y, this.GRAPH_WIDTH, this.GRAPH_HEIGHT);

    
            this.stats.disabled = false;
        }
    }
}
export { FBOPanel };