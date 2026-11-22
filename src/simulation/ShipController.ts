import * as THREE from 'three';
import { ShipModelRefs } from './ShipModel';
import { ControlsInput, LightningState, ShipState, WeatherParams } from './types';

/**
 * Handles arrow-key input (preventing browser scrolling), animates ship helm
 * hardware & windshield wipers, and drives the smoothly damped first-person bridge cabin camera.
 */
export class ShipController {
  public readonly input: ControlsInput = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  public wiperMode: 'AUTO' | 'ON' | 'OFF' = 'AUTO';
  public wiperSpeed = 1.0; // multiplier 0.4 .. 2.5
  public isWiperActive = false;

  private readonly helmOffset = new THREE.Vector3(0, 7.05, 2.45);
  private readonly camLocalQuat = new THREE.Quaternion();
  private readonly shipWorldQuat = new THREE.Quaternion();
  private readonly eulerScratch = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly camPosWorld = new THREE.Vector3();

  private dampedCamPitch = 0;
  private dampedCamRoll = 0;
  private dampedImpactBob = 0;
  private helmWheelAngle = 0;
  private wiperCycle = 0; // 0 = parked flat, 0..2PI = full sweep-and-return stroke

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
    elapsedTime: number,
    ship: ShipState,
    model: ShipModelRefs,
    camera: THREE.PerspectiveCamera,
    weather: WeatherParams,
    lightning: LightningState,
  ): void {
    // 1. Update Ship Root Transform
    model.root.position.set(ship.x, ship.y, ship.z);
    this.eulerScratch.set(ship.pitch, ship.yaw, ship.roll, 'YXZ');
    this.shipWorldQuat.setFromEuler(this.eulerScratch);
    model.root.quaternion.copy(this.shipWorldQuat);

    // 2. Animate Ship Helm Wheel & Engine Telegraph Lever
    const targetWheelRot = ship.rudderAngle * 3.8;
    this.helmWheelAngle = THREE.MathUtils.damp(this.helmWheelAngle, targetWheelRot, 8.0, dt);
    model.helmWheel.rotation.z = this.helmWheelAngle;

    const targetLeverAngle = THREE.MathUtils.lerp(0.62, -0.78, ship.targetThrottle);
    model.telegraphLever.rotation.x = THREE.MathUtils.damp(
      model.telegraphLever.rotation.x,
      targetLeverAngle,
      7.5,
      dt,
    );

    // 3. Dynamic Wet Deck Sheen, Windshield Rain & Bottom-Mounted Wipers
    const wetness = THREE.MathUtils.clamp(
      weather.rainIntensity * 0.9 + weather.sprayIntensity * 0.35 + ship.bowImpact * 0.25,
      0,
      1,
    );
    model.deckMaterial.roughness = THREE.MathUtils.lerp(0.72, 0.24, wetness);
    model.hullMaterial.roughness = THREE.MathUtils.lerp(0.48, 0.22, wetness);

    const glassWetness = THREE.MathUtils.clamp(
      weather.rainIntensity + weather.sprayIntensity * 0.28 + ship.bowImpact * 0.18,
      0,
      1,
    );

    const autoShouldWipe =
      weather.rainIntensity > 0.06 ||
      weather.sprayIntensity > 0.45 ||
      ship.bowImpact > 0.45;
    const wantsWipe =
      this.wiperMode === 'ON' || (this.wiperMode === 'AUTO' && autoShouldWipe);

    const autoRateBoost =
      this.wiperMode === 'AUTO' ? 0.85 + glassWetness * 0.65 : 1.0;

    if (wantsWipe) {
      this.wiperCycle += dt * 3.2 * this.wiperSpeed * autoRateBoost;
      if (this.wiperCycle >= Math.PI * 2) {
        this.wiperCycle %= Math.PI * 2;
      }
      this.isWiperActive = true;
    } else if (this.wiperCycle > 0.001) {
      // Smoothly finish the return stroke back onto the bottom sill before parking
      this.wiperCycle += dt * 3.4 * Math.max(this.wiperSpeed, 1.0);
      if (this.wiperCycle >= Math.PI * 2) {
        this.wiperCycle = 0;
        this.isWiperActive = false;
      } else {
        this.isWiperActive = true;
      }
    } else {
      this.wiperCycle = 0;
      this.isWiperActive = false;
    }

    const sweepAmount = 0.5 - 0.5 * Math.cos(this.wiperCycle);
    model.wiperLeft.rotation.z = THREE.MathUtils.lerp(-1.53, -0.18, sweepAmount);
    model.wiperRight.rotation.z = THREE.MathUtils.lerp(1.53, 0.18, sweepAmount);

    const wu = model.windshieldMat.uniforms;
    wu.uTime.value = elapsedTime;
    wu.uRainIntensity.value = glassWetness;
    wu.uWiperSweep.value = sweepAmount;
    wu.uFlashIntensity.value = lightning.flashIntensity;
    wu.uSkyTint.value.copy(weather.skyHorizonColor);

    const navGlow = THREE.MathUtils.lerp(0.75, 2.4, 1.0 - weather.sunVisibility);
    model.portLightMat.emissiveIntensity = navGlow;
    model.stbdLightMat.emissiveIntensity = navGlow;
    model.mastLightMat.emissiveIntensity = navGlow * 0.9;
    model.compassGlowMat.emissiveIntensity = 0.55 + (1.0 - weather.sunVisibility) * 0.9;

    // 4. First-Person Bridge Cabin Camera with Smooth Horizon-Stabilized Damping
    const targetPitch = ship.pitch * 0.62 - 0.068;
    const targetRoll = ship.roll * 0.52;

    this.dampedCamPitch = THREE.MathUtils.damp(this.dampedCamPitch, targetPitch, 5.5, dt);
    this.dampedCamRoll = THREE.MathUtils.damp(this.dampedCamRoll, targetRoll, 5.0, dt);

    const impactDrop = -ship.bowImpact * 0.085;
    this.dampedImpactBob = THREE.MathUtils.damp(this.dampedImpactBob, impactDrop, 9.0, dt);

    this.camPosWorld
      .copy(this.helmOffset)
      .setY(this.helmOffset.y + this.dampedImpactBob)
      .applyQuaternion(this.shipWorldQuat)
      .add(model.root.position);
    camera.position.copy(this.camPosWorld);

    this.eulerScratch.set(this.dampedCamPitch, ship.yaw, this.dampedCamRoll, 'YXZ');
    this.camLocalQuat.setFromEuler(this.eulerScratch);
    camera.quaternion.copy(this.camLocalQuat);

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
