import * as THREE from 'three';

export type WeatherState =
  | 'CALM_OCEAN'
  | 'STRONG_WIND'
  | 'ROUGH_SEAS'
  | 'SEVERE_THUNDERSTORM'
  | 'STORM_RECOVERY';

export interface WeatherParams {
  windSpeed: number; // m/s (4 to 30)
  windAngle: number; // radians in XZ plane
  waveAmplitudeScale: number; // multiplier on base wave amplitudes (0.32 to 2.25)
  waveSteepnessScale: number; // multiplier on steepness (0.45 to 1.0)
  waveChoppiness: number; // fine ripple / chop intensity (0.2 to 1.8)
  foamIntensity: number; // whitecaps & crest foam (0.15 to 1.65)
  sprayIntensity: number; // wind-blown sea spray (0.0 to 1.5)
  rainIntensity: number; // 0.0 to 1.0
  cloudCoverage: number; // 0.0 to 1.0
  cloudDarkness: number; // 0.0 (bright sunlit) to 1.0 (dark storm)
  fogDensity: number; // exponential fog density
  sunVisibility: number; // 0.0 to 1.0
  sunElevation: number; // radians above horizon
  sunAzimuth: number; // radians
  sunColor: THREE.Color;
  skyZenithColor: THREE.Color;
  skyHorizonColor: THREE.Color;
  hemiSkyColor: THREE.Color;
  hemiGroundColor: THREE.Color;
  fogColor: THREE.Color;
  waterDeepColor: THREE.Color;
  waterShallowColor: THREE.Color;
  lightningRate: number; // flashes per minute (0 in calm, ~5-9 in storm)
  exposure: number;
}

export interface GerstnerWaveComponent {
  dirX: number;
  dirZ: number;
  wavelength: number;
  baseAmplitude: number;
  baseSteepness: number;
  speedMultiplier: number;
  windAlignment: number; // 0 = fixed ocean swell, 1 = aligns toward wind
  baseAngle: number;
}

export interface ShipState {
  x: number;
  y: number;
  z: number;
  yaw: number; // radians, 0 = facing -Z
  pitch: number; // radians, + = bow up
  roll: number; // radians, + = starboard down
  forwardSpeed: number; // m/s
  lateralSpeed: number; // m/s (leeway drift)
  yawRate: number; // rad/s
  throttle: number; // 0..1 actual engine output
  targetThrottle: number; // 0..1 commanded engine setting
  rudderAngle: number; // radians (-maxRudder .. +maxRudder)
  bowSubmersion: number; // meters bow waterline is below wave surface
  bowImpact: number; // 0..1 transient slam intensity
}

export interface LightningState {
  flashIntensity: number; // 0..1+ instantaneous scene boost
  flashDirection: THREE.Vector3;
  flashColor: THREE.Color;
  cloudHotspot: THREE.Vector3;
  hotspotStrength: number;
}

export interface ControlsInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}
