import * as THREE from 'three';
import {
  StormCellState,
  WeatherControlMode,
  WeatherOverrides,
  WeatherParams,
  WeatherState,
} from './types';

function cloneParams(p: WeatherParams): WeatherParams {
  return {
    ...p,
    sunColor: p.sunColor.clone(),
    skyZenithColor: p.skyZenithColor.clone(),
    skyHorizonColor: p.skyHorizonColor.clone(),
    hemiSkyColor: p.hemiSkyColor.clone(),
    hemiGroundColor: p.hemiGroundColor.clone(),
    fogColor: p.fogColor.clone(),
    waterDeepColor: p.waterDeepColor.clone(),
    waterShallowColor: p.waterShallowColor.clone(),
  };
}

const WEATHER_PROFILES: Record<WeatherState, WeatherParams> = {
  CALM_OCEAN: {
    windSpeed: 5.5,
    windAngle: 0.45,
    waveAmplitudeScale: 0.36,
    waveSteepnessScale: 0.56,
    waveChoppiness: 0.28,
    foamIntensity: 0.18,
    sprayIntensity: 0.0,
    rainIntensity: 0.0,
    cloudCoverage: 0.32,
    cloudDarkness: 0.08,
    fogDensity: 0.00026,
    sunVisibility: 0.96,
    sunElevation: 0.31,
    sunAzimuth: -0.48,
    sunColor: new THREE.Color('#ffe4bd'),
    skyZenithColor: new THREE.Color('#1c4e80'),
    skyHorizonColor: new THREE.Color('#9fc2dc'),
    hemiSkyColor: new THREE.Color('#8ec1e6'),
    hemiGroundColor: new THREE.Color('#132c3d'),
    fogColor: new THREE.Color('#98bcd4'),
    waterDeepColor: new THREE.Color('#041c2c'),
    waterShallowColor: new THREE.Color('#0e5263'),
    lightningRate: 0.0,
    exposure: 1.08,
  },
  STRONG_WIND: {
    windSpeed: 16.5,
    windAngle: 0.78,
    waveAmplitudeScale: 0.96,
    waveSteepnessScale: 0.84,
    waveChoppiness: 1.08,
    foamIntensity: 0.88,
    sprayIntensity: 0.55,
    rainIntensity: 0.05,
    cloudCoverage: 0.68,
    cloudDarkness: 0.38,
    fogDensity: 0.00062,
    sunVisibility: 0.45,
    sunElevation: 0.27,
    sunAzimuth: -0.35,
    sunColor: new THREE.Color('#e8d9c8'),
    skyZenithColor: new THREE.Color('#2c445c'),
    skyHorizonColor: new THREE.Color('#778c9e'),
    hemiSkyColor: new THREE.Color('#7b94a8'),
    hemiGroundColor: new THREE.Color('#12232f'),
    fogColor: new THREE.Color('#728799'),
    waterDeepColor: new THREE.Color('#041724'),
    waterShallowColor: new THREE.Color('#0c3f4d'),
    lightningRate: 0.0,
    exposure: 1.02,
  },
  ROUGH_SEAS: {
    windSpeed: 22.8,
    windAngle: 1.05,
    waveAmplitudeScale: 1.54,
    waveSteepnessScale: 0.95,
    waveChoppiness: 1.48,
    foamIntensity: 1.34,
    sprayIntensity: 1.08,
    rainIntensity: 0.22,
    cloudCoverage: 0.85,
    cloudDarkness: 0.66,
    fogDensity: 0.00096,
    sunVisibility: 0.16,
    sunElevation: 0.24,
    sunAzimuth: -0.22,
    sunColor: new THREE.Color('#c2ccd6'),
    skyZenithColor: new THREE.Color('#1d2b38'),
    skyHorizonColor: new THREE.Color('#536473'),
    hemiSkyColor: new THREE.Color('#5f7282'),
    hemiGroundColor: new THREE.Color('#0c1821'),
    fogColor: new THREE.Color('#4f606e'),
    waterDeepColor: new THREE.Color('#03121c'),
    waterShallowColor: new THREE.Color('#09323d'),
    lightningRate: 0.3,
    exposure: 0.96,
  },
  SEVERE_THUNDERSTORM: {
    windSpeed: 29.0,
    windAngle: 1.32,
    waveAmplitudeScale: 2.08,
    waveSteepnessScale: 1.0,
    waveChoppiness: 1.78,
    foamIntensity: 1.65,
    sprayIntensity: 1.45,
    rainIntensity: 0.96,
    cloudCoverage: 0.98,
    cloudDarkness: 0.94,
    fogDensity: 0.00168,
    sunVisibility: 0.02,
    sunElevation: 0.22,
    sunAzimuth: -0.15,
    sunColor: new THREE.Color('#7b8fa6'),
    skyZenithColor: new THREE.Color('#0b1118'),
    skyHorizonColor: new THREE.Color('#24313d'),
    hemiSkyColor: new THREE.Color('#354759'),
    hemiGroundColor: new THREE.Color('#070f16'),
    fogColor: new THREE.Color('#23303b'),
    waterDeepColor: new THREE.Color('#020c14'),
    waterShallowColor: new THREE.Color('#07242e'),
    lightningRate: 7.2,
    exposure: 0.92,
  },
  STORM_RECOVERY: {
    windSpeed: 10.2,
    windAngle: 0.62,
    waveAmplitudeScale: 0.84,
    waveSteepnessScale: 0.72,
    waveChoppiness: 0.56,
    foamIntensity: 0.62,
    sprayIntensity: 0.22,
    rainIntensity: 0.06,
    cloudCoverage: 0.52,
    cloudDarkness: 0.26,
    fogDensity: 0.00045,
    sunVisibility: 0.74,
    sunElevation: 0.29,
    sunAzimuth: -0.58,
    sunColor: new THREE.Color('#ffdca8'),
    skyZenithColor: new THREE.Color('#224b73'),
    skyHorizonColor: new THREE.Color('#8eaec4'),
    hemiSkyColor: new THREE.Color('#84aec9'),
    hemiGroundColor: new THREE.Color('#102736'),
    fogColor: new THREE.Color('#88a8bd'),
    waterDeepColor: new THREE.Color('#041928'),
    waterShallowColor: new THREE.Color('#0d4959'),
    lightningRate: 0.0,
    exposure: 1.05,
  },
};

const DURATION_RANGES: Record<WeatherState, [number, number]> = {
  CALM_OCEAN: [120, 220],
  STRONG_WIND: [120, 230],
  ROUGH_SEAS: [130, 260],
  SEVERE_THUNDERSTORM: [120, 210],
  STORM_RECOVERY: [90, 165],
};

const TRANSITION_TABLE: Record<WeatherState, Array<{ state: WeatherState; weight: number }>> = {
  CALM_OCEAN: [
    { state: 'STRONG_WIND', weight: 0.72 },
    { state: 'ROUGH_SEAS', weight: 0.18 },
    { state: 'CALM_OCEAN', weight: 0.1 },
  ],
  STRONG_WIND: [
    { state: 'ROUGH_SEAS', weight: 0.45 },
    { state: 'CALM_OCEAN', weight: 0.37 },
    { state: 'SEVERE_THUNDERSTORM', weight: 0.18 },
  ],
  ROUGH_SEAS: [
    { state: 'STRONG_WIND', weight: 0.36 },
    { state: 'SEVERE_THUNDERSTORM', weight: 0.34 },
    { state: 'STORM_RECOVERY', weight: 0.3 },
  ],
  SEVERE_THUNDERSTORM: [{ state: 'STORM_RECOVERY', weight: 1.0 }],
  STORM_RECOVERY: [
    { state: 'CALM_OCEAN', weight: 0.65 },
    { state: 'STRONG_WIND', weight: 0.35 },
  ],
};

/**
 * Autonomous long-duration weather state machine with weighted transitions,
 * interactive overrides (weather preset, wind, clouds), and localized Storm Ahead cells.
 */
export class WeatherSystem {
  public currentState: WeatherState = 'CALM_OCEAN';
  public targetState: WeatherState = 'CALM_OCEAN';

  public readonly overrides: WeatherOverrides = {
    mode: 'AUTO',
    windSpeed: null,
    windAngle: null,
    cloudCoverage: null,
    cloudDarkness: null,
  };

  public readonly stormCell: StormCellState = {
    active: false,
    x: 0,
    z: 0,
    radius: 560,
    intensity: 0,
    proximity: 0,
    angularRadius: 0.5,
    bearingDir: new THREE.Vector3(0, 0, -1),
    distance: 1000,
  };

  private fromParams: WeatherParams;
  private toParams: WeatherParams;
  private readonly baseActive: WeatherParams;
  public readonly active: WeatherParams;

  private phaseTimer = 0;
  private phaseDuration = 150;
  private isTransitioning = false;
  private transitionTimer = 0;
  private transitionDuration = 35;

  private targetWindAngleOffset = 0;
  private fromWindAngleOffset = 0;
  private gustTime = 0;
  private stormLifeAge = 0;
  private stormMaxLife = 240;
  private stormDriftVx = 0;
  private stormDriftVz = 0;

  // Smoothly damped manual overrides
  private smoothedWindSpeed = 5.5;
  private smoothedWindAngle = 0.45;
  private smoothedCloudCov = 0.32;
  private smoothedCloudDark = 0.08;

  constructor() {
    this.fromParams = cloneParams(WEATHER_PROFILES.CALM_OCEAN);
    this.toParams = cloneParams(WEATHER_PROFILES.CALM_OCEAN);
    this.baseActive = cloneParams(WEATHER_PROFILES.CALM_OCEAN);
    this.active = cloneParams(WEATHER_PROFILES.CALM_OCEAN);
    this.phaseDuration = this.randomRange(105, 165);
  }

  public setMode(mode: WeatherControlMode): void {
    this.overrides.mode = mode;
    if (mode !== 'AUTO' && (mode !== this.targetState || !this.isTransitioning && mode !== this.currentState)) {
      this.startTransitionTo(mode, 10.0);
    }
  }

  public setWindSpeedOverride(speed: number | null): void {
    this.overrides.windSpeed = speed;
  }

  public setWindAngleOverride(angleRad: number | null): void {
    this.overrides.windAngle = angleRad;
  }

  public setCloudCoverageOverride(coverage: number | null): void {
    this.overrides.cloudCoverage = coverage;
  }

  public setCloudDarknessOverride(darkness: number | null): void {
    this.overrides.cloudDarkness = darkness;
  }

  public clearOverrides(): void {
    this.overrides.mode = 'AUTO';
    this.overrides.windSpeed = null;
    this.overrides.windAngle = null;
    this.overrides.cloudCoverage = null;
    this.overrides.cloudDarkness = null;
  }

  public hasManualOverrides(): boolean {
    return (
      this.overrides.mode !== 'AUTO' ||
      this.overrides.windSpeed !== null ||
      this.overrides.windAngle !== null ||
      this.overrides.cloudCoverage !== null ||
      this.overrides.cloudDarkness !== null
    );
  }

  /**
   * Spawns a localized thunderstorm squall cell ~780m ahead of the ship's bow.
   * Visible immediately on the forward horizon with dark clouds, rain shaft,
   * and lightning; intensifies waves/rain/wind as the ship sails into it.
   */
  public spawnStormAhead(shipX: number, shipZ: number, shipYaw: number): void {
    const fwdX = -Math.sin(shipYaw);
    const fwdZ = -Math.cos(shipYaw);
    const spawnDist = 780;

    this.stormCell.active = true;
    this.stormCell.x = shipX + fwdX * spawnDist;
    this.stormCell.z = shipZ + fwdZ * spawnDist;
    this.stormCell.radius = 520;
    this.stormCell.intensity = 0.08;
    this.stormCell.proximity = 0;
    this.stormLifeAge = 0;
    this.stormMaxLife = 260;

    // Slow approach + cross drift so the squall feels alive on the ocean
    this.stormDriftVx = -fwdX * 2.2 + Math.cos(this.active.windAngle) * 1.6;
    this.stormDriftVz = -fwdZ * 2.2 + Math.sin(this.active.windAngle) * 1.6;
  }

  public update(dt: number, elapsedTime: number, shipX = 0, shipZ = 0): WeatherParams {
    this.gustTime += dt;

    // 1. State Machine Progression
    if (!this.isTransitioning) {
      if (this.overrides.mode === 'AUTO') {
        this.phaseTimer += dt;
        if (this.phaseTimer >= this.phaseDuration) {
          const next = this.pickWeightedNextState(this.currentState);
          this.startTransitionTo(next, this.randomRange(24, 52));
        }
      }
    } else {
      this.transitionTimer += dt;
      const rawT = THREE.MathUtils.clamp(
        this.transitionTimer / this.transitionDuration,
        0,
        1,
      );
      const t = rawT * rawT * rawT * (rawT * (rawT * 6 - 15) + 10);
      this.interpolateParams(this.fromParams, this.toParams, t, this.baseActive);

      if (rawT >= 1) {
        this.isTransitioning = false;
        this.currentState = this.targetState;
        this.fromParams = cloneParams(this.toParams);
        this.fromWindAngleOffset = this.targetWindAngleOffset;
        this.phaseTimer = 0;
        const [minD, maxD] = DURATION_RANGES[this.currentState];
        this.phaseDuration = this.randomRange(minD, maxD);
      }
    }

    // Copy base state into active before applying gusts, overrides, and storm cell
    this.copyParams(this.baseActive, this.active);

    // 2. Continuous Wind Gusts & Sun Drift
    const gust =
      0.11 * Math.sin(this.gustTime * 0.27) +
      0.07 * Math.sin(this.gustTime * 0.63 + 1.4) +
      0.04 * Math.cos(this.gustTime * 1.15);

    const baseWind = this.isTransitioning
      ? this.baseActive.windSpeed
      : this.fromParams.windSpeed;
    const autoWindSpeed = Math.max(2.0, baseWind * (1.0 + gust));

    const windShift =
      Math.sin(elapsedTime * 0.017) * 0.16 +
      Math.cos(elapsedTime * 0.009 + 2.1) * 0.11;
    const baseWindAngle = this.isTransitioning
      ? this.baseActive.windAngle
      : this.fromParams.windAngle + this.fromWindAngleOffset;
    const autoWindAngle = baseWindAngle + windShift;

    const sunCycle = Math.sin(elapsedTime * 0.0055);
    const baseElev = this.isTransitioning
      ? this.baseActive.sunElevation
      : this.fromParams.sunElevation;
    this.active.sunElevation = THREE.MathUtils.clamp(
      baseElev + sunCycle * 0.06,
      0.13,
      0.55,
    );

    const baseAz = this.isTransitioning
      ? this.baseActive.sunAzimuth
      : this.fromParams.sunAzimuth;
    this.active.sunAzimuth = baseAz + elapsedTime * 0.0018;

    // 3. Smoothly Apply User Overrides (Wind & Clouds)
    const targetWindSpd =
      this.overrides.windSpeed !== null
        ? Math.max(2.0, this.overrides.windSpeed * (1.0 + gust * 0.65))
        : autoWindSpeed;
    this.smoothedWindSpeed = THREE.MathUtils.damp(this.smoothedWindSpeed, targetWindSpd, 2.5, dt);
    this.active.windSpeed = this.smoothedWindSpeed;

    // When user raises wind speed manually, couple wave chop/foam/spray realistically
    if (this.overrides.windSpeed !== null) {
      const windNorm = THREE.MathUtils.clamp((this.smoothedWindSpeed - 4) / 26, 0, 1);
      this.active.waveAmplitudeScale = THREE.MathUtils.lerp(
        this.active.waveAmplitudeScale,
        0.38 + windNorm * 1.68,
        0.72,
      );
      this.active.waveChoppiness = THREE.MathUtils.lerp(
        this.active.waveChoppiness,
        0.28 + windNorm * 1.48,
        0.78,
      );
      this.active.foamIntensity = THREE.MathUtils.lerp(
        this.active.foamIntensity,
        0.18 + windNorm * 1.42,
        0.78,
      );
      this.active.sprayIntensity = THREE.MathUtils.lerp(
        this.active.sprayIntensity,
        Math.max(0, (windNorm - 0.25) * 1.85),
        0.75,
      );
    }

    const targetWindAng =
      this.overrides.windAngle !== null ? this.overrides.windAngle : autoWindAngle;
    this.smoothedWindAngle = this.lerpAngle(
      this.smoothedWindAngle,
      targetWindAng,
      1 - Math.exp(-3.0 * dt),
    );
    this.active.windAngle = this.smoothedWindAngle;

    const targetCloudCov =
      this.overrides.cloudCoverage !== null
        ? this.overrides.cloudCoverage
        : this.baseActive.cloudCoverage;
    this.smoothedCloudCov = THREE.MathUtils.damp(this.smoothedCloudCov, targetCloudCov, 2.8, dt);
    this.active.cloudCoverage = this.smoothedCloudCov;

    const targetCloudDark =
      this.overrides.cloudDarkness !== null
        ? this.overrides.cloudDarkness
        : this.baseActive.cloudDarkness;
    this.smoothedCloudDark = THREE.MathUtils.damp(this.smoothedCloudDark, targetCloudDark, 2.8, dt);
    this.active.cloudDarkness = this.smoothedCloudDark;

    // Adjust sun visibility subtly when user manually thickens & darkens clouds
    if (this.overrides.cloudCoverage !== null || this.overrides.cloudDarkness !== null) {
      const overcast = this.active.cloudCoverage * (0.35 + 0.65 * this.active.cloudDarkness);
      this.active.sunVisibility = Math.min(
        this.active.sunVisibility,
        THREE.MathUtils.clamp(1.05 - overcast * 1.15, 0.03, 0.96),
      );
    }

    // 4. Localized "Storm Ahead" Cell Update & Proximity Blending
    if (this.stormCell.active) {
      this.stormLifeAge += dt;
      this.stormCell.x += this.stormDriftVx * dt;
      this.stormCell.z += this.stormDriftVz * dt;

      const dx = this.stormCell.x - shipX;
      const dz = this.stormCell.z - shipZ;
      const dist = Math.hypot(dx, dz);
      this.stormCell.distance = dist;

      if (dist > 0.001) {
        this.stormCell.bearingDir.set(dx / dist, 0.08, dz / dist).normalize();
      }
      this.stormCell.angularRadius = THREE.MathUtils.clamp(
        Math.atan2(this.stormCell.radius * 0.9, Math.max(dist, 120)),
        0.26,
        1.55,
      );

      // Build up smoothly in 6s, fade out after maxLife or sailing far past
      const buildUp = THREE.MathUtils.clamp(this.stormLifeAge / 6.0, 0, 1);
      const fadeOut =
        this.stormLifeAge > this.stormMaxLife - 25
          ? THREE.MathUtils.clamp((this.stormMaxLife - this.stormLifeAge) / 25, 0, 1)
          : 1.0;
      const distFade = dist > 1650 ? THREE.MathUtils.clamp(1 - (dist - 1650) / 400, 0, 1) : 1.0;

      this.stormCell.intensity = buildUp * fadeOut * distFade;

      // Proximity: 0 at 1050m, 1 inside 320m radius
      const rawProx = THREE.MathUtils.clamp(
        1.0 - (dist - 280) / (this.stormCell.radius * 1.45),
        0,
        1,
      );
      this.stormCell.proximity = THREE.MathUtils.damp(
        this.stormCell.proximity,
        rawProx * this.stormCell.intensity,
        1.2,
        dt,
      );

      if (this.stormCell.intensity <= 0.002 && this.stormLifeAge > 10) {
        this.stormCell.active = false;
        this.stormCell.proximity = 0;
      }

      // Blend local storm severity into weather as the ship enters the storm cell
      const p = this.stormCell.proximity;
      if (p > 0.01) {
        this.interpolateParams(this.active, WEATHER_PROFILES.SEVERE_THUNDERSTORM, p * 0.9, this.active);
      }
      // Even from afar, nearby storm swells start rolling toward the bow
      const swellReach = THREE.MathUtils.clamp(
        (1.0 - dist / 1400) * this.stormCell.intensity * 0.55,
        0,
        0.55,
      );
      this.active.waveAmplitudeScale = Math.max(
        this.active.waveAmplitudeScale,
        THREE.MathUtils.lerp(this.active.waveAmplitudeScale, 1.85, swellReach),
      );
    }

    return this.active;
  }

  private startTransitionTo(next: WeatherState, duration: number): void {
    this.targetState = next;
    this.fromParams = cloneParams(this.baseActive);
    this.toParams = cloneParams(WEATHER_PROFILES[next]);

    this.targetWindAngleOffset =
      this.overrides.mode === 'AUTO' ? this.randomRange(-0.55, 0.55) : 0;
    this.toParams.windAngle += this.targetWindAngleOffset;

    this.isTransitioning = true;
    this.transitionTimer = 0;
    this.transitionDuration = duration;
  }

  private pickWeightedNextState(current: WeatherState): WeatherState {
    const options = TRANSITION_TABLE[current];
    let total = 0;
    for (const o of options) total += o.weight;
    let r = Math.random() * total;
    for (const o of options) {
      r -= o.weight;
      if (r <= 0) return o.state;
    }
    return options[0].state;
  }

  private copyParams(src: WeatherParams, dst: WeatherParams): void {
    dst.windSpeed = src.windSpeed;
    dst.windAngle = src.windAngle;
    dst.waveAmplitudeScale = src.waveAmplitudeScale;
    dst.waveSteepnessScale = src.waveSteepnessScale;
    dst.waveChoppiness = src.waveChoppiness;
    dst.foamIntensity = src.foamIntensity;
    dst.sprayIntensity = src.sprayIntensity;
    dst.rainIntensity = src.rainIntensity;
    dst.cloudCoverage = src.cloudCoverage;
    dst.cloudDarkness = src.cloudDarkness;
    dst.fogDensity = src.fogDensity;
    dst.sunVisibility = src.sunVisibility;
    dst.sunElevation = src.sunElevation;
    dst.sunAzimuth = src.sunAzimuth;
    dst.lightningRate = src.lightningRate;
    dst.exposure = src.exposure;

    dst.sunColor.copy(src.sunColor);
    dst.skyZenithColor.copy(src.skyZenithColor);
    dst.skyHorizonColor.copy(src.skyHorizonColor);
    dst.hemiSkyColor.copy(src.hemiSkyColor);
    dst.hemiGroundColor.copy(src.hemiGroundColor);
    dst.fogColor.copy(src.fogColor);
    dst.waterDeepColor.copy(src.waterDeepColor);
    dst.waterShallowColor.copy(src.waterShallowColor);
  }

  private interpolateParams(
    a: WeatherParams,
    b: WeatherParams,
    t: number,
    out: WeatherParams,
  ): void {
    out.windSpeed = THREE.MathUtils.lerp(a.windSpeed, b.windSpeed, t);
    out.windAngle = this.lerpAngle(a.windAngle, b.windAngle, t);
    out.waveAmplitudeScale = THREE.MathUtils.lerp(a.waveAmplitudeScale, b.waveAmplitudeScale, t);
    out.waveSteepnessScale = THREE.MathUtils.lerp(a.waveSteepnessScale, b.waveSteepnessScale, t);
    out.waveChoppiness = THREE.MathUtils.lerp(a.waveChoppiness, b.waveChoppiness, t);
    out.foamIntensity = THREE.MathUtils.lerp(a.foamIntensity, b.foamIntensity, t);
    out.sprayIntensity = THREE.MathUtils.lerp(a.sprayIntensity, b.sprayIntensity, t);
    out.rainIntensity = THREE.MathUtils.lerp(a.rainIntensity, b.rainIntensity, t);
    out.cloudCoverage = THREE.MathUtils.lerp(a.cloudCoverage, b.cloudCoverage, t);
    out.cloudDarkness = THREE.MathUtils.lerp(a.cloudDarkness, b.cloudDarkness, t);
    out.fogDensity = THREE.MathUtils.lerp(a.fogDensity, b.fogDensity, t);
    out.sunVisibility = THREE.MathUtils.lerp(a.sunVisibility, b.sunVisibility, t);
    out.sunElevation = THREE.MathUtils.lerp(a.sunElevation, b.sunElevation, t);
    out.sunAzimuth = THREE.MathUtils.lerp(a.sunAzimuth, b.sunAzimuth, t);
    out.lightningRate = THREE.MathUtils.lerp(a.lightningRate, b.lightningRate, t);
    out.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, t);

    out.sunColor.copy(a.sunColor).lerp(b.sunColor, t);
    out.skyZenithColor.copy(a.skyZenithColor).lerp(b.skyZenithColor, t);
    out.skyHorizonColor.copy(a.skyHorizonColor).lerp(b.skyHorizonColor, t);
    out.hemiSkyColor.copy(a.hemiSkyColor).lerp(b.hemiSkyColor, t);
    out.hemiGroundColor.copy(a.hemiGroundColor).lerp(b.hemiGroundColor, t);
    out.fogColor.copy(a.fogColor).lerp(b.fogColor, t);
    out.waterDeepColor.copy(a.waterDeepColor).lerp(b.waterDeepColor, t);
    out.waterShallowColor.copy(a.waterShallowColor).lerp(b.waterShallowColor, t);
  }

  private lerpAngle(a: number, b: number, t: number): number {
    const twoPi = Math.PI * 2;
    let diff = ((b - a + Math.PI) % twoPi) - Math.PI;
    if (diff < -Math.PI) diff += twoPi;
    return a + diff * t;
  }

  private randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
