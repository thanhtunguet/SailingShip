import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LightningSystem } from './LightningSystem';
import { OceanRenderer } from './OceanRenderer';
import { ParticleEffects } from './ParticleEffects';
import { ShipController } from './ShipController';
import { ShipModelRefs, buildShipModel } from './ShipModel';
import { ShipPhysics } from './ShipPhysics';
import { SkyAndAtmosphere } from './SkyAndAtmosphere';
import { WaveField } from './WaveField';
import { WeatherSystem } from './WeatherSystem';

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

/**
 * Top-level real-time ocean simulation orchestrator.
 * Owns WebGL2 renderer, scene graph, delta-time loop, software-WebGL pacing,
 * resize handling, and clean resource teardown.
 */
export class SimulationManager {
  private readonly container: HTMLElement;
  private readonly isSoftwareGl: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly envTexture: THREE.Texture;

  private readonly weatherSystem: WeatherSystem;
  private readonly waveField: WaveField;
  private readonly lightningSystem: LightningSystem;
  private readonly skyAndAtmosphere: SkyAndAtmosphere;
  private readonly oceanRenderer: OceanRenderer;
  private readonly shipModel: ShipModelRefs;
  private readonly shipPhysics: ShipPhysics;
  private readonly shipController: ShipController;
  private readonly particleEffects: ParticleEffects;

  private frameId = 0;
  private disposed = false;
  private elapsedSimTime = 0;
  private readonly resizeObserver: ResizeObserver;
  private readonly onContextLostBound: (e: Event) => void;
  private readonly onContextRestoredBound: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, width / Math.max(height, 1), 0.15, 7000);

    // Studio/sky environment reflection map for brass, stainless steel, and glass
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envTexture = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.65;
    roomEnv.dispose();
    pmremGenerator.dispose();

    // Instantiate modular simulation systems
    this.weatherSystem = new WeatherSystem();
    this.waveField = new WaveField();
    this.lightningSystem = new LightningSystem(this.scene);
    this.skyAndAtmosphere = new SkyAndAtmosphere(this.scene, this.isSoftwareGl);
    this.oceanRenderer = new OceanRenderer(this.scene, this.waveField);
    this.shipModel = buildShipModel(this.renderer, this.isSoftwareGl);
    this.scene.add(this.shipModel.root);

    this.shipPhysics = new ShipPhysics();
    this.shipController = new ShipController();
    this.particleEffects = new ParticleEffects(this.scene);

    // Initial synchronous tick so frame 0 has accurate ship/wave/camera alignment
    this.stepSimulation(0.016);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Resize handling
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.handleResize);

    // WebGL context recovery
    this.onContextLostBound = (e: Event) => {
      e.preventDefault();
      this.stopLoop();
    };
    this.onContextRestoredBound = () => {
      if (!this.disposed) {
        this.clock.getDelta();
        this.startLoop();
      }
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLostBound);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestoredBound);

    this.clock.start();
    this.startLoop();
  }

  private handleResize = (): void => {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    if (width <= 0 || height <= 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
  };

  private startLoop(): void {
    this.stopLoop();
    this.tick();
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
  }

  private tick = (): void => {
    if (this.disposed) return;

    const rawDelta = this.clock.getDelta();
    // Clamp delta so tab switching never causes a physics explosion
    const dt = Math.min(Math.max(rawDelta, 0.001), 0.05);

    this.stepSimulation(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private stepSimulation(dt: number): void {
    this.elapsedSimTime += dt;

    // 1. Update autonomous weather state machine
    const weather = this.weatherSystem.update(dt, this.elapsedSimTime);

    // 2. Snap ocean grid to 2.0m increments near ship & compute double-precision Gerstner phases
    const [originX, originZ] = this.oceanRenderer.getSnappedOrigin(
      this.shipPhysics.state.x,
      this.shipPhysics.state.z,
    );
    this.waveField.update(dt, this.elapsedSimTime, weather, originX, originZ);

    // 3. Step ship hydrodynamics & 5-point Gerstner buoyancy
    const shipState = this.shipPhysics.update(
      dt,
      this.elapsedSimTime,
      this.shipController.input,
      this.waveField,
      weather,
    );

    // 4. Update lightning flashes & bolts
    const lightning = this.lightningSystem.update(
      dt,
      weather,
      shipState.x,
      shipState.z,
      shipState.yaw,
    );

    // 5. Update sky dome, clouds, sun & fog
    this.skyAndAtmosphere.update(
      dt,
      this.elapsedSimTime,
      weather,
      lightning,
      shipState.x,
      shipState.z,
      this.renderer,
    );

    // 6. Update ocean uniforms & ship wake
    this.oceanRenderer.update(
      this.elapsedSimTime,
      originX,
      originZ,
      shipState,
      weather,
      this.skyAndAtmosphere.sunDirection,
      this.skyAndAtmosphere.fog.color,
      lightning,
    );

    // 7. Update ship visual model, helm hardware, & damped first-person camera
    this.shipController.update(dt, shipState, this.shipModel, this.camera, weather);

    // 8. Update wind-driven rain & bow/sea spray particles
    this.particleEffects.update(dt, this.camera, shipState, weather, lightning);
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();

    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLostBound);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestoredBound);

    this.shipController.dispose();
    this.particleEffects.dispose(this.scene);
    this.lightningSystem.dispose(this.scene);
    this.skyAndAtmosphere.dispose(this.scene);
    this.oceanRenderer.dispose(this.scene);
    this.shipModel.dispose();
    this.scene.remove(this.shipModel.root);
    this.envTexture.dispose();

    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
