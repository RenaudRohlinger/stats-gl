interface StatsPlugin {
    framework: string;  // webgl2, threejs, babylonjs
    name: string;
    fg: string;
    bg: string;
    min: number;        // minimum value
    max: number;        // maximum value
    renderer: any;      // renderer
    scene: any;         // scene
    camera: any;        // camera
    update(): number;   // returns the value to be displayed
    onBeforeRender?(): void;    // Optional, used for FBO rendering
    onAfterRender?(): void;     // Optional, used for FBO rendering
    render?(): void;    // Optional, used for FBO rendering
}
