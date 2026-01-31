self.onerror = function ( ev ) {

	console.error( '[worker] ❌ Global error:', {
		message: ev.message,
		filename: ev.filename,
		lineno: ev.lineno,
		colno: ev.colno,
		error: ev.error,
		event: ev
	} );
	// Forward to main thread since Worker error event may have limited info
	self.postMessage( {
		type: 'worker-error',
		error: ev.error ? String( ev.error ) : String( ev ),
		source: ev.filename,
		lineno: ev.lineno,
		colno: ev.colno,
	} );

};

self.onunhandledrejection = ( event ) => {

	console.error( '[worker] ❌ Unhandled rejection:', event.reason );
	// Forward to main thread
	self.postMessage( {
		type: 'worker-error',
		error: String( event.reason ),
		source: 'unhandled-rejection',
	} );

};

/**
 * MRT Worker - Three.js WebGPU rendering with PostProcessing in a Web Worker
 *
 * Handles:
 * - WebGPU rendering via OffscreenCanvas
 * - PostProcessing with MRT (output/normal/diffuse/position/depth)
 * - TSL Node capture via .toStatsGL()
 * - Camera sync from main thread
 * - Stats profiling data sent to main thread
 */

import {
  color,
  diffuseColor,
  directionToColor,
  Fn,
  mix,
  mrt,
  normalView,
  output,
  pass,
  positionWorld,
  screenUV,
  step
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { flushCaptures } from '../addons/StatsGLNodeWorker.js';
import { StatsProfiler } from '../dist/main.js';

let renderer = null;
let scene = null;
let camera = null;
let mixer = null;
let postProcessing = null;
let profiler = null;
let clock = null;

// Camera matrix received from main thread
let pendingCameraMatrix = null;

self.onmessage = async (e) => {
  switch (e.data.type) {
    case 'init':
      await init(e.data.canvas, e.data.width, e.data.height);
      break;
    case 'camera':
      pendingCameraMatrix = e.data.matrix;
      break;
    case 'resize':
      resize(e.data.width, e.data.height);
      break;
  }
};

async function init(canvas, width, height) {
  clock = new THREE.Clock();

  // Initialize WebGPU renderer with OffscreenCanvas
  renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true
  });
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // Scene setup
  scene = new THREE.Scene();
  scene.backgroundNode = screenUV.y.mix(color(0x87ceeb), color(0x4a90d9));

  // Camera
  camera = new THREE.PerspectiveCamera(40, width / height, 1, 100);
  camera.position.set(5, 2, 8);

  // Lights
  scene.add(new THREE.AmbientLight(0xf1f1ff, 1.5));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(5, 10, 5);
  scene.add(light);

  // Initialize renderer (required for WebGPU)
  await renderer.init();

  // Initialize profiler
  profiler = new StatsProfiler({ trackGPU: true });
  await profiler.init(renderer);

  // PostProcessing setup with MRT
  const scenePass = pass(scene, camera, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter
  });

  scenePass.setMRT(
    mrt({
      output: output,
      normal: directionToColor(normalView),
      diffuse: diffuseColor,
      position: positionWorld
    })
  );

  // Optimize textures
  const normalTexture = scenePass.getTexture('normal');
  const diffuseTexture = scenePass.getTexture('diffuse');
  const positionTexture = scenePass.getTexture('position');

  normalTexture.type = diffuseTexture.type = THREE.UnsignedByteType;

  // PostProcessing output with split-screen view
  postProcessing = new THREE.PostProcessing(renderer);
  postProcessing.outputColorTransform = false;
  postProcessing.outputNode = Fn(() => {
    const outputTex = scenePass.getTextureNode('output');
    const normalTex = scenePass.getTextureNode('normal');
    const diffuseTex = scenePass.getTextureNode('diffuse');
    const positionTex = scenePass.getTextureNode('position');
    const depthTex = scenePass.getTextureNode('depth');

    // Register TSL nodes for capture using .toStatsGL()
    diffuseTex.toStatsGL('Diffuse');
    normalTex.toStatsGL('Normal');
    positionTex.toStatsGL('Position');
    scenePass.getLinearDepthNode().toStatsGL('Depth');

    // Split-screen: Diffuse / Normal / Final / Position / Depth
    const dif = mix(diffuseTex, normalTex, step(0.2, screenUV.x));
    const nor = mix(dif, outputTex.renderOutput(), step(0.4, screenUV.x));
    const fin = mix(nor, positionTex, step(0.6, screenUV.x));
    const dep = mix(fin, depthTex, step(0.8, screenUV.x));

    return dep;
  })();

  // Load model
  const loader = new GLTFLoader();
  loader.load(
    '/Flamingo.glb',
    (gltf) => {
      const model = gltf.scene;
      model.position.set(1, 1, 0);
      model.scale.set(0.025, 0.025, 0.025);
      scene.add(model);

      mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(gltf.animations[0]).play();

      // Notify main thread we're ready
      self.postMessage({ type: 'ready' });

      // Start render loop
      renderer.setAnimationLoop(render);
    },
    undefined,
    (error) => {
      console.error('Error loading model:', error);
      self.postMessage({ type: 'error', message: error.message });
    }
  );
}

function resize(width, height) {
  if (!renderer || !camera) return;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

async function render() {
  if (!renderer || !postProcessing) return;

  const delta = clock.getDelta();

  // Update animation
  if (mixer) {
    mixer.update(delta);
  }

  // Apply camera matrix from main thread (OrbitControls)
  if (pendingCameraMatrix) {
    camera.matrixWorld.fromArray(pendingCameraMatrix);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    // Extract position from matrix for proper rendering
    camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
    pendingCameraMatrix = null;
  }

  profiler.begin();

  // Render via PostProcessing
  postProcessing.render();
  renderer.resolveTimestampsAsync( THREE.TimestampQuery.RENDER )

  profiler.end();
  profiler.update();

  // Send stats data to main thread
  const statsData = profiler.getData();
  self.postMessage({ type: 'stats', data: statsData });

  // Flush TSL node captures and send to main thread
  const captures = await flushCaptures(renderer);
  for (const { name, bitmap } of captures) {
    self.postMessage(
      {
        type: 'texture',
        name,
        bitmap,
        width: renderer.domElement.width,
        height: renderer.domElement.height
      },
      [bitmap] // Transfer bitmap for efficiency
    );
  }
}


