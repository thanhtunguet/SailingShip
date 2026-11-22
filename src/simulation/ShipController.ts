import * as THREE from 'three';
import { ShipModelRefs } from './ShipModel';
import { ControlsInput, ShipState, WeatherParams } from './types';

/**
 * Handles arrow-key input (preventing browser scrolling), animates ship helm
 * hardware, and drives the smoothly damped first-person bridge camera.
 */
export class ShipController {
  public readonly input: ControlsInput = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  private readonly helmOffset = new THREE.Vector3(0, 6.95, 2.6);
  private readonly camLocalQuat = new THREE.Quaternion();
  private readonly shipWorldQuat = new THREE.Quaternion();
  private readonly eulerScratch = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly camPosWorld = new THREE.Vector3();

  private dampedCamPitch = 0;
  private dampedCamRoll = 0;
  private dampedImpactBob = 0;
  private helmWheelAngle = 0;

  private readonly handleKeyDownBound: (e: KeyboardEvent) => void;
  private readonly handleKeyUpBound: (e: KeyboardEvent) => void;
  private readonly clearInputsBound: () => void;

  constructor() {
    this.handleKeyDownBound = this.onKeyDown.bind(this);
    this.handleKeyUpBound = this.onKeyUp.bind(this);
    this.clearInputsBound = this.clearInputs.bind(this);

    window.addEventListener('keydown', this.handleKeyDownBound, { passive: false });
    window.addEventListener('keyup', this.handleKeyUpBound, { passive: false });
    window.addEventListener('blur', this.clearInputsBound);
    document.addEventListener('visibilitychange', this.clearInputsBound);
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.code) {
      case 'ArrowUp':
        e.preventDefault();
        this.input.up = true;
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.input.down = true;
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.input.left = true;
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.input.right = true;
        break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'ArrowUp':
        e.preventDefault();
        this.input.up = false;
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.input.down = false;
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.input.left = false;
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.input.right = false;
        break;
    }
  }

  private clearInputs(): void {
    this.input.up = false;
    this.input.down = false;
    this.input.left = false;
    this.input.right = false;
  }

  public update(
    dt: number,
    ship: ShipState,
    model: ShipModelRefs,
    camera: THREE.PerspectiveCamera,
    weather: WeatherParams,
  ): void {
    // 1. Update Ship Root Transform
    model.root.position.set(ship.x, ship.y, ship.z);
    this.eulerScratch.set(ship.pitch, ship.yaw, ship.roll, 'YXZ');
    this.shipWorldQuat.setFromEuler(this.eulerScratch);
    model.root.quaternion.copy(this.shipWorldQuat);

    // 2. Animate Ship Helm Wheel & Engine Telegraph Lever
    const targetWheelRot = ship.rudderAngle * 3.8; // multiple wheel spokes turn per rudder sweep
    this.helmWheelAngle = THREE.MathUtils.damp(this.helmWheelAngle, targetWheelRot, 8.0, dt);
    model.helmWheel.rotation.z = this.helmWheelAngle;

    // Engine telegraph tilts forward (-X) as throttle increases
    const targetLeverAngle = THREE.MathUtils.lerp(0.62, -0.78, ship.targetThrottle);
    model.telegraphLever.rotation.x = THREE.MathUtils.damp(
      model.telegraphLever.rotation.x,
      targetLeverAngle,
      7.5,
      dt,
    );

    // 3. Dynamic Wet Deck Sheen & Storm Navigation Light Intensity
    const wetness = THREE.MathUtils.clamp(
      weather.rainIntensity * 0.9 + weather.sprayIntensity * 0.35 + ship.bowImpact * 0.25,
      0,
      1,
    );
    model.deckMaterial.roughness = THREE.MathUtils.lerp(0.72, 0.24, wetness);
    model.hullMaterial.roughness = THREE.MathUtils.lerp(0.48, 0.22, wetness);

    const navGlow = THREE.MathUtils.lerp(0.75, 2.4, 1.0 - weather.sunVisibility);
    model.portLightMat.emissiveIntensity = navGlow;
    model.stbdLightMat.emissiveIntensity = navGlow;
    model.mastLightMat.emissiveIntensity = navGlow * 0.9;
    model.compassGlowMat.emissiveIntensity = 0.55 + (1.0 - weather.sunVisibility) * 0.9;

    // 4. First-Person Helm Camera with Smooth Horizon-Stabilized Damping
    // Camera follows ship yaw directly, and smoothly damps pitch/roll with
    // natural human inner-ear stabilization (~62% pitch, ~52% roll coupling)
    // so the bow rises/plunges dynamically while avoiding harsh camera jitter.
    const targetPitch = ship.pitch * 0.62 - 0.075; // slight downward gaze toward bow & horizon
    const targetRoll = ship.roll * 0.52;

    this.dampedCamPitch = THREE.MathUtils.damp(this.dampedCamPitch, targetPitch, 5.5, dt);
    this.dampedCamRoll = THREE.MathUtils.damp(this.dampedCamRoll, targetRoll, 5.0, dt);

    const impactDrop = -ship.bowImpact * 0.085;
    this.dampedImpactBob = THREE.MathUtils.damp(this.dampedImpactBob, impactDrop, 9.0, dt);

    // Compute world camera position attached to ship helm deck
    this.camPosWorld
      .copy(this.helmOffset)
      .setY(this.helmOffset.y + this.dampedImpactBob)
      .applyQuaternion(this.shipWorldQuat)
      .add(model.root.position);
    camera.position.copy(this.camPosWorld);

    this.eulerScratch.set(this.dampedCamPitch, ship.yaw, this.dampedCamRoll, 'YXZ');
    this.camLocalQuat.setFromEuler(this.eulerScratch);
    camera.quaternion.copy(this.camLocalQuat);

    // Subtle speed-linked FOV breathing (58 deg -> 61.5 deg)
    const targetFov = 58.0 + (ship.forwardSpeed / 11.5) * 3.5;
    if (Math.abs(camera.fov - targetFov) > 0.02) {
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 2.5, dt);
      camera.updateProjectionMatrix();
    }
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDownBound);
    window.removeEventListener('keyup', this.handleKeyUpBound);
    window.removeEventListener('blur', this.clearInputsBound);
    document.removeEventListener('visibilitychange', this.clearInputsBound);
  }
}
