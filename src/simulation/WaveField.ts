import * as THREE from 'three';
import { GerstnerWaveComponent, WeatherParams } from './types';

export const WAVE_COUNT = 8;
const TWO_PI = Math.PI * 2;
const GRAVITY = 9.81;

export interface WaveSample {
  height: number;
  normalX: number;
  normalY: number;
  normalZ: number;
}

/**
 * Deterministic 8-component trochoidal Gerstner wave spectrum shared between
 * GPU ocean vertex/fragment shaders and CPU ship buoyancy physics.
 *
 * Horizontal displacement per wave i: s_i * A_i * dir_i * cos(phase_i)
 * Vertical displacement per wave i:   A_i * sin(phase_i)
 * Slope factor ka_i = k_i * A_i, and Jacobian safety enforces sum(s_i * ka_i) <= 0.80.
 */
export class WaveField {
  private readonly baseWaves: GerstnerWaveComponent[];

  // Smoothed active parameters evaluated on CPU & packed for GPU
  public readonly dirX = new Float64Array(WAVE_COUNT);
  public readonly dirZ = new Float64Array(WAVE_COUNT);
  public readonly waveNumber = new Float64Array(WAVE_COUNT); // k = 2pi / L
  public readonly amplitude = new Float64Array(WAVE_COUNT);
  public readonly steepness = new Float64Array(WAVE_COUNT); // s_i (trochoid orbit ratio)
  public readonly omega = new Float64Array(WAVE_COUNT); // angular frequency sqrt(g*k)

  // Reusable GPU uniform arrays (vec4[8])
  // uWaveA[i] = (dirX, dirZ, k, amplitude)
  // uWaveB[i] = (steepness, phaseAtOrigin, 0, 0)
  public readonly uWaveA: THREE.Vector4[] = [];
  public readonly uWaveB: THREE.Vector4[] = [];

  private setEnvelopePhaseA = 0.4;
  private setEnvelopePhaseB = 1.7;

  constructor() {
    this.baseWaves = [
      {
        dirX: 0,
        dirZ: 0,
        wavelength: 148.0,
        baseAmplitude: 1.55,
        baseSteepness: 0.85,
        speedMultiplier: 1.0,
        windAlignment: 0.28,
        baseAngle: -0.52,
      },
      {
        dirX: 0,
        dirZ: 0,
        wavelength: 96.0,
        baseAmplitude: 1.05,
        baseSteepness: 0.82,
        speedMultiplier: 1.02,
        windAlignment: 0.48,
        baseAngle: 0.31,
      },
      {
        dirX: 0,
        dirZ: 0,
        wavelength: 61.0,
        baseAmplitude: 0.72,
        baseSteepness: 0.78,
        speedMultiplier: 1.04,
        windAlignment: 0.72,
        baseAngle: -0.19,
      },
      {
        dirX: 0,
        dirZ: 0,
        wavelength: 39.5,
        baseAmplitude: 0.46,
        baseSteepness: 0.74,
        speedMultiplier: 1.06,
        windAlignment: 0.85,
        baseAngle: 0.49,
      },
      {
        dirX: 0,
        dirZ: 0,
        wavelength: 25.8,
        baseAmplitude: 0.28,
        baseSteepness: 0.68,
        speedMultiplier: 1.08,
        windAlignment: 0.92,
        baseAngle: -0.74,
      },
      {
        dirX: 0,
        dirZ: 0,
        wavelength: 16.5,
        baseAmplitude: 0.16,
        baseSteepness: 0.62,
        speedMultiplier: 1.1,
        windAlignment: 0.96,
        baseAngle: 0.14,
      },
      {
        dirX: 0,
        dirZ: 0,
        wavelength: 10.6,
        baseAmplitude: 0.095,
        baseSteepness: 0.56,
        speedMultiplier: 1.14,
        windAlignment: 1.0,
        baseAngle: -0.44,
      },
      {
        dirX: 0,
        dirZ: 0,
        wavelength: 6.8,
        baseAmplitude: 0.052,
        baseSteepness: 0.5,
        speedMultiplier: 1.18,
        windAlignment: 1.0,
        baseAngle: 0.68,
      },
    ];

    for (let i = 0; i < WAVE_COUNT; i++) {
      this.uWaveA.push(new THREE.Vector4());
      this.uWaveB.push(new THREE.Vector4());
    }
  }

  public update(
    dt: number,
    elapsedTime: number,
    weather: WeatherParams,
    originX: number,
    originZ: number,
  ): void {
    this.setEnvelopePhaseA += dt * 0.13;
    this.setEnvelopePhaseB += dt * 0.058;

    // Natural wave-set groups (larger swell packets followed by calmer intervals)
    const setMod =
      1.0 +
      0.16 * Math.sin(this.setEnvelopePhaseA) +
      0.1 * Math.cos(this.setEnvelopePhaseB);

    const ampScale = weather.waveAmplitudeScale * setMod;
    const steepScale = weather.waveSteepnessScale;
    const chopNorm = THREE.MathUtils.clamp(weather.waveChoppiness / 1.5, 0, 1);

    let totalSlopeSteepness = 0;

    for (let i = 0; i < WAVE_COUNT; i++) {
      const w = this.baseWaves[i];
      const targetAngle = this.lerpAngle(
        w.baseAngle,
        weather.windAngle + (i % 2 === 0 ? 0.15 : -0.19),
        w.windAlignment,
      );
      const meander = Math.sin(elapsedTime * 0.028 + i * 1.9) * 0.085;
      const angle = targetAngle + meander;

      this.dirX[i] = Math.cos(angle);
      this.dirZ[i] = Math.sin(angle);

      const k = TWO_PI / w.wavelength;
      this.waveNumber[i] = k;

      const chopBias = i >= 4 ? THREE.MathUtils.lerp(0.6, 1.38, chopNorm) : 1.0;
      const a = w.baseAmplitude * ampScale * chopBias;
      this.amplitude[i] = a;

      const s = THREE.MathUtils.clamp(w.baseSteepness * steepScale, 0.05, 1.0);
      this.steepness[i] = s;

      totalSlopeSteepness += s * k * a;
      this.omega[i] = Math.sqrt(GRAVITY * k) * w.speedMultiplier;
    }

    // Prevent wave crests from ever folding over (Jacobian > 0.2)
    const maxSlopeSum = 0.78;
    const slopeScale =
      totalSlopeSteepness > maxSlopeSum ? maxSlopeSum / totalSlopeSteepness : 1.0;

    for (let i = 0; i < WAVE_COUNT; i++) {
      const s = this.steepness[i] * slopeScale;
      this.steepness[i] = s;

      const k = this.waveNumber[i];
      const a = this.amplitude[i];
      const dx = this.dirX[i];
      const dz = this.dirZ[i];
      const w = this.omega[i];

      // Double-precision phase offset at snapped ocean grid origin
      let phase = (dx * originX + dz * originZ) * k - w * elapsedTime;
      phase = ((phase % TWO_PI) + TWO_PI) % TWO_PI;

      this.uWaveA[i].set(dx, dz, k, a);
      this.uWaveB[i].set(s, phase, 0, 0);
    }
  }

  /**
   * Evaluates exact displaced Gerstner wave height and surface normal at world (worldX, worldZ).
   * Uses 2-iteration fixed-point inversion so CPU ship buoyancy tracks horizontal Gerstner crest shift.
   */
  public sampleAt(worldX: number, worldZ: number, elapsedTime: number, out: WaveSample): void {
    let rx = worldX;
    let rz = worldZ;

    for (let iter = 0; iter < 2; iter++) {
      let dispX = 0;
      let dispZ = 0;
      for (let i = 0; i < WAVE_COUNT; i++) {
        const sa = this.steepness[i] * this.amplitude[i];
        const k = this.waveNumber[i];
        const dx = this.dirX[i];
        const dz = this.dirZ[i];

        const phase = (dx * rx + dz * rz) * k - this.omega[i] * elapsedTime;
        const c = Math.cos(phase);
        dispX += sa * dx * c;
        dispZ += sa * dz * c;
      }
      rx = worldX - dispX;
      rz = worldZ - dispZ;
    }

    let y = 0;
    let nx = 0;
    let ny = 1;
    let nz = 0;

    for (let i = 0; i < WAVE_COUNT; i++) {
      const a = this.amplitude[i];
      const k = this.waveNumber[i];
      const dx = this.dirX[i];
      const dz = this.dirZ[i];
      const s = this.steepness[i];

      const phase = (dx * rx + dz * rz) * k - this.omega[i] * elapsedTime;
      const sinP = Math.sin(phase);
      const cosP = Math.cos(phase);

      y += a * sinP;
      const ka = k * a;
      nx -= dx * ka * cosP;
      nz -= dz * ka * cosP;
      ny -= s * ka * sinP;
    }

    const invLen = 1 / Math.hypot(nx, ny, nz);
    out.height = y;
    out.normalX = nx * invLen;
    out.normalY = ny * invLen;
    out.normalZ = nz * invLen;
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = ((b - a + Math.PI) % TWO_PI) - Math.PI;
    if (diff < -Math.PI) diff += TWO_PI;
    return a + diff * t;
  }
}
