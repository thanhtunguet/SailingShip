import * as THREE from 'three';
import { WaveField, WaveSample } from './WaveField';
import { ControlsInput, ShipState, WeatherParams } from './types';

const MAX_FORWARD_SPEED = 11.5; // m/s (~22.3 knots)
const MAX_RUDDER_ANGLE = 0.56; // ~32 degrees

/**
 * Hydrodynamic & wave-coupled 6-DOF vessel physics.
 * Evaluates 5 hull points on the shared Gerstner WaveField so the bow,
 * heave, pitch, and roll remain locked to the rendered ocean surface.
 */
export class ShipPhysics {
  public readonly state: ShipState = {
    x: 0,
    y: 0.1,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    forwardSpeed: 6.2, // Start moving forward at moderate cruising speed
    lateralSpeed: 0,
    yawRate: 0,
    throttle: 0.56,
    targetThrottle: 0.56,
    rudderAngle: 0,
    bowSubmersion: 0,
    bowImpact: 0,
  };

  private heaveVel = 0;
  private pitchVel = 0;
  private rollVel = 0;
  private prevBowSubmersion = 0;

  // Pre-allocated sample struct (zero GC in loop)
  private readonly sample: WaveSample = {
    height: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
  };

  public update(
    dt: number,
    elapsedTime: number,
    input: ControlsInput,
    waveField: WaveField,
    weather: WeatherParams,
  ): ShipState {
    const s = this.state;

    // 1. Engine Throttle Control (Arrow Up / Down)
    const throttleRate = 0.36;
    if (input.up) {
      s.targetThrottle = Math.min(1.0, s.targetThrottle + throttleRate * dt);
    }
    if (input.down) {
      s.targetThrottle = Math.max(0.0, s.targetThrottle - throttleRate * 1.15 * dt);
    }
    // Engine spool inertia
    s.throttle = THREE.MathUtils.damp(s.throttle, s.targetThrottle, 1.35, dt);

    // 2. Rudder Angle Control (Arrow Left / Right)
    const rudderRate = 0.78;
    if (input.left && !input.right) {
      s.rudderAngle = Math.min(MAX_RUDDER_ANGLE, s.rudderAngle + rudderRate * dt);
    } else if (input.right && !input.left) {
      s.rudderAngle = Math.max(-MAX_RUDDER_ANGLE, s.rudderAngle - rudderRate * dt);
    } else {
      // Natural hydrodynamic rudder centering when helmsman releases wheel
      s.rudderAngle = THREE.MathUtils.damp(s.rudderAngle, 0, 1.65, dt);
    }

    // 3. Forward Thrust, Hydrodynamic Drag & Wave Slope Resistance
    const thrustAccel = s.throttle * 1.85;
    const dragAccel = 0.045 * s.forwardSpeed + 0.01 * s.forwardSpeed * Math.abs(s.forwardSpeed);
    const waveSlopeDrag = Math.max(0, Math.sin(s.pitch)) * 1.35;

    // Headwind / tailwind resistance
    const cosYaw = Math.cos(s.yaw);
    const sinYaw = Math.sin(s.yaw);
    const fwdX = -sinYaw;
    const fwdZ = -cosYaw;
    const rightX = cosYaw;
    const rightZ = -sinYaw;

    const windVecX = Math.cos(weather.windAngle) * weather.windSpeed;
    const windVecZ = Math.sin(weather.windAngle) * weather.windSpeed;
    const windAlongFwd = windVecX * fwdX + windVecZ * fwdZ;
    const windAlongRight = windVecX * rightX + windVecZ * rightZ;

    const windFwdAccel = windAlongFwd * Math.abs(windAlongFwd) * 0.00055;
    const netFwdAccel = thrustAccel - dragAccel - waveSlopeDrag + windFwdAccel;
    s.forwardSpeed = THREE.MathUtils.clamp(
      s.forwardSpeed + netFwdAccel * dt,
      0,
      MAX_FORWARD_SPEED,
    );

    // Smooth snap to full stop when throttle is zeroed and coasting below 0.04 m/s
    if (s.targetThrottle < 0.01 && s.throttle < 0.02 && s.forwardSpeed < 0.05) {
      s.forwardSpeed = 0;
    }

    // 4. Rudder Steering & Wind Weathervaning
    // Rudder effectiveness scales with water flow over the rudder blade
    const speedAuthority = THREE.MathUtils.clamp(s.forwardSpeed / 5.5, 0, 1.35);
    const propWash = s.throttle * 0.08 * (s.forwardSpeed > 0.2 ? 1 : 0.35);
    const steerAuthority = Math.min(1.4, speedAuthority + propWash);

    const targetYawRate = s.rudderAngle * 0.24 * steerAuthority;
    // Crosswind creates subtle yaw drift torque that player must counter-steer in storms
    const windYawTorque = windAlongRight * weather.windSpeed * 0.00011;
    s.yawRate = THREE.MathUtils.damp(s.yawRate, targetYawRate + windYawTorque, 2.2, dt);
    s.yaw += s.yawRate * dt;

    // 5. Wind-Induced Lateral Leeway Drift
    const targetLateralSpeed =
      windAlongRight * Math.abs(windAlongRight) * 0.0042 - s.yawRate * s.forwardSpeed * 0.14;
    s.lateralSpeed = THREE.MathUtils.damp(s.lateralSpeed, targetLateralSpeed, 1.4, dt);

    // Advance World Position along ship heading + leeway drift
    const newCos = Math.cos(s.yaw);
    const newSin = Math.sin(s.yaw);
    const moveFwdX = -newSin;
    const moveFwdZ = -newCos;
    const moveRightX = newCos;
    const moveRightZ = -newSin;

    s.x += (moveFwdX * s.forwardSpeed + moveRightX * s.lateralSpeed) * dt;
    s.z += (moveFwdZ * s.forwardSpeed + moveRightZ * s.lateralSpeed) * dt;

    // 6. 5-Point Gerstner Wave Sampling for Hull Buoyancy
    const sampleWorld = (lx: number, lz: number): number => {
      const wx = s.x + lx * newCos + lz * newSin;
      const wz = s.z - lx * newSin + lz * newCos;
      waveField.sampleAt(wx, wz, elapsedTime, this.sample);
      return this.sample.height;
    };

    const hBow = sampleWorld(0, -21.0);
    const hBowTip = sampleWorld(0, -25.2);
    const hMidPort = sampleWorld(-4.2, -1.5);
    const hMidStbd = sampleWorld(4.2, -1.5);
    const hSternPort = sampleWorld(-3.6, 17.0);
    const hSternStbd = sampleWorld(3.6, 17.0);

    const hMid = (hMidPort + hMidStbd) * 0.5;
    const hStern = (hSternPort + hSternStbd) * 0.5;

    // Weighted buoyancy center height
    const targetHeave = hBow * 0.24 + hMid * 0.48 + hStern * 0.28 - 0.18;

    // Wave-induced target pitch (+ = bow up) and roll (+ = starboard down)
    const targetPitch = Math.atan2(hBow - hStern, 38.0) * 0.92;
    const waveRoll =
      Math.atan2((hMidPort + hSternPort) * 0.5 - (hMidStbd + hSternStbd) * 0.5, 7.8) * 1.05;

    // Crosswind heeling + centrifugal turn heel
    const windHeel = windAlongRight * weather.windSpeed * 0.00018;
    const turnHeel = -s.yawRate * s.forwardSpeed * 0.022;
    const targetRoll = waveRoll + windHeel + turnHeel;

    // Second-order damped spring dynamics for realistic vessel mass & inertia
    const heaveStiffness = 7.2;
    const heaveDamping = 3.6;
    const heaveAcc = (targetHeave - s.y) * heaveStiffness - this.heaveVel * heaveDamping;
    this.heaveVel += heaveAcc * dt;
    s.y += this.heaveVel * dt;

    const pitchStiffness = 5.4;
    const pitchDamping = 3.1;
    const pitchAcc = (targetPitch - s.pitch) * pitchStiffness - this.pitchVel * pitchDamping;
    this.pitchVel += pitchAcc * dt;
    s.pitch += this.pitchVel * dt;

    const rollStiffness = 4.6;
    const rollDamping = 2.55;
    const rollAcc = (targetRoll - s.roll) * rollStiffness - this.rollVel * rollDamping;
    this.rollVel += rollAcc * dt;
    s.roll += this.rollVel * dt;

    // 7. Bow Submersion & Wave Slam Impact (drives spray & bow wake intensity)
    const bowDeckHeightWorld = s.y + Math.sin(s.pitch) * 25.2;
    const bowWaterlineWorld = bowDeckHeightWorld + 1.4; // hull waterline reference at bow
    s.bowSubmersion = Math.max(0, hBowTip - (bowWaterlineWorld - 1.4));

    const submersionRate = Math.max(0, (s.bowSubmersion - this.prevBowSubmersion) / Math.max(dt, 0.001));
    this.prevBowSubmersion = s.bowSubmersion;

    const rawImpact = THREE.MathUtils.clamp(
      submersionRate * 0.28 * (0.3 + s.forwardSpeed * 0.1) + s.bowSubmersion * 0.25,
      0,
      1.2,
    );
    s.bowImpact = THREE.MathUtils.damp(s.bowImpact, rawImpact, 5.0, dt);

    return s;
  }
}
