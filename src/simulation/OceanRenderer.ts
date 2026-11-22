import * as THREE from 'three';
import { WAVE_COUNT, WaveField } from './WaveField';
import { LightningState, ShipState, WeatherParams } from './types';

const OCEAN_VERTEX_SHADER = /* glsl */ `
#define WAVE_COUNT ${WAVE_COUNT}

uniform vec4 uWaveA[WAVE_COUNT]; // (dirX, dirZ, k, amplitude)
uniform vec4 uWaveB[WAVE_COUNT]; // (steepness, phaseAtOrigin, 0, 0)
uniform vec2 uOriginMod;         // continuous world-space offset mod 512 for ripple UVs

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vRippleXZ;
varying float vWaveHeight;
varying float vCrestFactor;
varying float vDistance;

void main() {
  vec2 baseXZ = position.xz;

  vec3 displaced = vec3(baseXZ.x, 0.0, baseXZ.y);
  vec3 tangentX = vec3(1.0, 0.0, 0.0);
  vec3 tangentZ = vec3(0.0, 0.0, 1.0);

  for (int i = 0; i < WAVE_COUNT; i++) {
    vec2 dir = uWaveA[i].xy;
    float k = uWaveA[i].z;
    float amp = uWaveA[i].w;
    float steep = uWaveB[i].x;
    float phase0 = uWaveB[i].y;

    float phase = dot(dir, baseXZ) * k + phase0;
    float sinP = sin(phase);
    float cosP = cos(phase);

    float sa = steep * amp;
    displaced.x += sa * dir.x * cosP;
    displaced.z += sa * dir.y * cosP;
    displaced.y += amp * sinP;

    float ka = k * amp;
    float ska = steep * ka;

    tangentX.x -= dir.x * dir.x * ska * sinP;
    tangentX.y += dir.x * ka * cosP;
    tangentX.z -= dir.x * dir.y * ska * sinP;

    tangentZ.x -= dir.x * dir.y * ska * sinP;
    tangentZ.y += dir.y * ka * cosP;
    tangentZ.z -= dir.y * dir.y * ska * sinP;
  }

  // Jacobian determinant approximation for crest compression / breaking foam
  float jacobian = tangentX.x * tangentZ.z - tangentX.z * tangentZ.x;
  vCrestFactor = clamp((1.0 - jacobian) * 1.45, 0.0, 1.8);

  vec3 n = normalize(cross(tangentZ, tangentX));
  vNormal = n;
  vWaveHeight = displaced.y;
  vRippleXZ = displaced.xz + uOriginMod;

  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = worldPos.xyz;

  vec4 mvPos = viewMatrix * worldPos;
  vDistance = -mvPos.z;
  gl_Position = projectionMatrix * mvPos;
}
`;

const OCEAN_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vRippleXZ;
varying float vWaveHeight;
varying float vCrestFactor;
varying float vDistance;

uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uSunVisibility;
uniform float uCloudCoverage;
uniform float uCloudDarkness;
uniform vec2 uWindDir;
uniform float uWindSpeed;
uniform float uChoppiness;
uniform float uFoamIntensity;
uniform vec3 uWaterDeepColor;
uniform vec3 uWaterShallowColor;
uniform vec3 uLightningHotspot;
uniform float uLightningStrength;
uniform float uFlashIntensity;
uniform vec3 uLightningDir;
uniform vec3 uStormDir;
uniform float uStormAngularRadius;
uniform float uStormIntensity;

// Ship wake uniforms
uniform vec3 uShipPos;       // (x, y, z)
uniform vec2 uShipForward;   // (sinYaw, -cosYaw) -> wait: passed explicitly
uniform float uShipYaw;
uniform float uShipSpeed;
uniform float uBowSubmersion;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbmFoam(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * valueNoise(p);
    p = rot * p * 2.15 + vec2(9.2, 5.1);
    a *= 0.5;
  }
  return v;
}

// Analytical multi-octave capillary/wind ripple height for crisp normal perturbation
float rippleHeight(vec2 p, float t) {
  vec2 w = uWindDir;
  vec2 wOrtho = vec2(-w.y, w.x);

  float h = 0.0;
  h += sin(dot(p, w * 1.4 + wOrtho * 0.7) + t * 2.4) * 0.28;
  h += sin(dot(p, w * 2.3 - wOrtho * 1.3) + t * 3.1) * 0.19;
  h += valueNoise(p * 0.42 - w * t * 0.85) * 0.52;
  h += valueNoise(p * 1.05 + wOrtho * t * 0.55 - w * t * 1.25) * 0.28;
  h += valueNoise(p * 2.35 - w * t * 1.9) * 0.14;
  return h;
}

vec3 computeDetailNormal(vec3 baseNormal, vec2 p, float dist) {
  // Attenuate fine ripples smoothly with distance to prevent horizon aliasing
  float detailFade = 1.0 / (1.0 + dist * 0.014 + dist * dist * 0.00004);
  if (detailFade < 0.02) return baseNormal;

  float eps = 0.22;
  float h0 = rippleHeight(p, uTime);
  float hx = rippleHeight(p + vec2(eps, 0.0), uTime);
  float hz = rippleHeight(p + vec2(0.0, eps), uTime);

  float strength = (0.09 + 0.11 * clamp(uChoppiness, 0.0, 1.8)) * detailFade;
  vec3 pert = normalize(vec3((h0 - hx) / eps * strength, 1.0, (h0 - hz) / eps * strength));

  // Blend perturbed normal onto macro Gerstner normal
  return normalize(vec3(baseNormal.x + pert.x, baseNormal.y, baseNormal.z + pert.z));
}

vec3 sampleSkyReflection(vec3 dir) {
  float y = max(dir.y, 0.015);
  float horizonCurve = pow(1.0 - y, 3.2);
  vec3 skyCol = mix(uZenithColor, uHorizonColor, horizonCurve);

  float sunDot = max(dot(dir, uSunDir), 0.0);
  float mieGlow = pow(sunDot, 5.0) * 0.35 + pow(sunDot, 36.0) * 0.48;
  skyCol += uSunColor * mieGlow * (0.22 + 0.78 * uSunVisibility);

  // Subtle reflected cloud darkening & lightning scatter
  float cloudMix = uCloudCoverage * (0.25 + 0.55 * uCloudDarkness) * smoothstep(0.01, 0.25, y);
  vec3 cloudTint = mix(uHorizonColor * 0.9, vec3(0.07, 0.10, 0.14), uCloudDarkness);
  skyCol = mix(skyCol, cloudTint, cloudMix * 0.65);

  float hotDot = max(dot(dir, normalize(uLightningHotspot)), 0.0);
  skyCol += vec3(0.62, 0.78, 1.0) * (pow(hotDot, 3.0) * uLightningStrength * 0.55 + uFlashIntensity * 0.18);

  if (uStormIntensity > 0.01) {
    vec2 dirXZ = normalize(dir.xz + vec2(1e-5));
    vec2 stormXZ = normalize(uStormDir.xz + vec2(1e-5));
    float stormAngle = acos(clamp(dot(dirXZ, stormXZ), -1.0, 1.0));
    float stormSector = (1.0 - smoothstep(uStormAngularRadius * 0.35, uStormAngularRadius * 1.15, stormAngle)) * uStormIntensity;
    skyCol = mix(skyCol, vec3(0.11, 0.16, 0.21), stormSector * 0.72);
  }
  return skyCol;
}

void main() {
  vec3 viewVec = cameraPosition - vWorldPos;
  float dist = length(viewVec);
  vec3 V = viewVec / max(dist, 0.0001);

  vec3 N = computeDetailNormal(normalize(vNormal), vRippleXZ, dist);
  if (dot(N, V) < 0.0) {
    N = normalize(N - V * dot(N, V) * 1.02);
  }

  // Fresnel reflection
  float NdotV = max(dot(N, V), 0.001);
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
  fresnel = clamp(fresnel * 1.05, 0.02, 0.96);

  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.01);
  vec3 skyReflect = sampleSkyReflection(R);

  // Depth & slope-dependent water body color
  float heightMix = smoothstep(-2.2, 2.6, vWaveHeight);
  vec3 waterBody = mix(uWaterDeepColor, uWaterShallowColor, heightMix * 0.68);

  // Subsurface scattering through wave crests when looking toward sun
  float backLit = pow(max(dot(V, normalize(-uSunDir + N * 0.55)), 0.0), 3.2);
  float crestGlow = smoothstep(0.2, 2.2, vWaveHeight + vCrestFactor * 0.6);
  vec3 sssColor = uWaterShallowColor * vec3(1.15, 1.55, 1.45);
  waterBody += sssColor * backLit * crestGlow * (0.28 + 0.72 * uSunVisibility) * 0.75;

  // Ambient bounce illumination on water body
  waterBody *= 0.65 + 0.35 * max(N.y, 0.0) + uFlashIntensity * 0.35;

  vec3 color = mix(waterBody, skyReflect, fresnel);

  // Crisp sun specular glitter across ocean ripples
  vec3 H = normalize(uSunDir + V);
  float NdotH = max(dot(N, H), 0.0);
  float specPower = mix(420.0, 140.0, clamp(uCloudDarkness, 0.0, 1.0));
  float specBroad = pow(NdotH, 48.0) * 0.16;
  float specSharp = pow(NdotH, specPower) * 3.8;
  float sunSpecMask = smoothstep(0.02, 0.35, uSunVisibility + 0.08);
  color += uSunColor * (specBroad + specSharp) * sunSpecMask * (1.0 - 0.72 * uCloudCoverage * uCloudDarkness);

  // Lightning specular reflection on waves
  if (uFlashIntensity > 0.01) {
    vec3 HL = normalize(uLightningDir + V);
    float lSpec = pow(max(dot(N, HL), 0.0), 110.0) * 2.2 + pow(max(dot(N, HL), 0.0), 18.0) * 0.25;
    color += vec3(0.75, 0.88, 1.0) * lSpec * uFlashIntensity;
  }

  // --- Dynamic Whitecaps & Crest Foam ---
  vec2 foamUV = vRippleXZ * 0.11 - uWindDir * uTime * 0.16;
  float foamPattern = fbmFoam(foamUV);
  float fineFoam = fbmFoam(vRippleXZ * 0.38 + vec2(uTime * 0.08));
  float combinedFoamNoise = foamPattern * 0.65 + fineFoam * 0.35;

  float crestThreshold = mix(0.88, 0.34, clamp(uFoamIntensity / 1.6, 0.0, 1.0));
  float crestFoam = smoothstep(crestThreshold, crestThreshold + 0.35, vCrestFactor * 0.62 + combinedFoamNoise * 0.55);
  crestFoam *= smoothstep(0.28, 0.72, combinedFoamNoise) * clamp(uFoamIntensity, 0.0, 1.65);

  // Wind-driven foam streaks (Langmuir spume lines in strong wind)
  float streakCoord = dot(vRippleXZ, vec2(-uWindDir.y, uWindDir.x)) * 0.19 + valueNoise(vRippleXZ * 0.04) * 2.5;
  float streak = pow(0.5 + 0.5 * sin(streakCoord), 4.0) * smoothstep(11.0, 26.0, uWindSpeed);
  float windSpume = streak * smoothstep(0.45, 0.78, fineFoam) * 0.38;

  // --- Ship Bow Collar & Kelvin V-Wake ---
  float wakeFoam = 0.0;
  vec2 relXZ = vWorldPos.xz - uShipPos.xz;
  // Transform into ship-local space where local -Z is forward (yaw=0 -> forward=(0,-1))
  float cy = cos(uShipYaw);
  float sy = sin(uShipYaw);
  // Forward vector in world: (-sy, -cy); Right vector: (cy, -sy)
  float localX = relXZ.x * cy - relXZ.y * sy;
  float localZ = relXZ.x * sy + relXZ.y * cy; // -26 = bow tip, +24 = stern

  float speedFactor = clamp(uShipSpeed / 7.5, 0.0, 1.35);

  // Parabolic hull waterline mask (-25.5 to +24)
  if (localZ > -30.0 && localZ < 170.0) {
    float hullHalfBeam = 4.9 * smoothstep(-25.5, -6.0, localZ) * (1.0 - 0.22 * smoothstep(10.0, 25.0, localZ));
    float hullDist = abs(localX) - hullHalfBeam;

    // Bow & shoulder frothy collar
    float collarMask = smoothstep(-26.5, -22.5, localZ) * (1.0 - smoothstep(18.0, 28.0, localZ));
    float collarBand = exp(-pow(hullDist * 0.75, 2.0)) * collarMask;
    float bowSurge = exp(-pow((localZ + 23.5) * 0.26, 2.0)) * exp(-pow(localX * 0.34, 2.0));
    float bowIntensity = (0.35 + 0.65 * speedFactor + clamp(uBowSubmersion * 0.45, 0.0, 0.8));
    wakeFoam += (collarBand * 0.62 + bowSurge * 0.95) * bowIntensity * smoothstep(0.24, 0.68, combinedFoamNoise + 0.18);

    // Diverging Kelvin V-wake from bow (-24 -> +160)
    if (localZ > -24.0) {
      float zBehindBow = localZ + 24.0;
      float wakeArmX = 3.2 + zBehindBow * 0.33;
      float armDist = abs(abs(localX) - wakeArmX);
      float armWidth = 1.6 + zBehindBow * 0.065;
      float armFade = exp(-zBehindBow * 0.014) * smoothstep(0.0, 8.0, zBehindBow);
      float vWake = exp(-pow(armDist / armWidth, 2.0)) * armFade;

      // Secondary inner wake wave
      float wakeArmX2 = 1.8 + zBehindBow * 0.21;
      float armDist2 = abs(abs(localX) - wakeArmX2);
      float vWake2 = exp(-pow(armDist2 / (armWidth * 0.85), 2.0)) * armFade * 0.6;

      // Turbulent stern prop-wash centerline
      float zBehindStern = max(localZ - 20.0, 0.0);
      float sternMask = smoothstep(12.0, 23.0, localZ);
      float sternHalfW = 2.6 + zBehindStern * 0.085;
      float sternWash = exp(-pow(localX / sternHalfW, 2.0)) * exp(-zBehindStern * 0.017) * sternMask;

      float wakeNoise = smoothstep(0.22, 0.72, combinedFoamNoise + 0.14);
      wakeFoam += (vWake * 0.65 + vWake2 * 0.42 + sternWash * 0.78) * speedFactor * wakeNoise;
    }
  }

  float totalFoam = clamp(crestFoam + windSpume + wakeFoam, 0.0, 0.95);
  // Foam receives diffuse sky, sun, and lightning lighting
  vec3 foamLitColor = mix(uHorizonColor * 0.72, vec3(0.95, 0.97, 0.99), 0.35 + 0.65 * uSunVisibility);
  foamLitColor *= 0.62 + 0.38 * max(N.y, 0.0);
  foamLitColor += uSunColor * 0.22 * uSunVisibility;
  foamLitColor += vec3(0.75, 0.86, 1.0) * uFlashIntensity * 0.48;
  color = mix(color, foamLitColor, totalFoam);

  // Exponential atmospheric fog (matches THREE.FogExp2 exactly)
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vDistance * vDistance);
  vec3 effectiveFog = uFogColor;
  if (uStormIntensity > 0.01 && vDistance > 160.0) {
    vec2 viewXZ = normalize(vWorldPos.xz - cameraPosition.xz + vec2(1e-5));
    vec2 stormXZ = normalize(uStormDir.xz + vec2(1e-5));
    float sAng = acos(clamp(dot(viewXZ, stormXZ), -1.0, 1.0));
    float sMask = (1.0 - smoothstep(uStormAngularRadius * 0.35, uStormAngularRadius * 1.15, sAng)) * uStormIntensity;
    effectiveFog = mix(effectiveFog, vec3(0.12, 0.17, 0.23), sMask * 0.78);
  }
  color = mix(color, effectiveFog, clamp(fogFactor, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Infinite seamless procedural ocean mesh + custom GLSL Gerstner shader.
 * Uses a continuous non-uniform LOD Cartesian grid snapped to inner grid step
 * so near-field waves never swim and the ocean extends 4.5 km to the horizon.
 */
export class OceanRenderer {
  public readonly mesh: THREE.Mesh;
  public readonly material: THREE.ShaderMaterial;

  private readonly innerHalfSpan = 100.0; // meters of uniform fine grid around ship
  private readonly innerNormSplit = 0.5; // [-0.5, 0.5] in normalized grid space
  private readonly gridSnapStep = 2.0; // exact inner vertex step (200m / 100 segs = 2.0m)

  constructor(scene: THREE.Scene, waveField: WaveField) {
    const segments = 200; // 200x200 = 40,401 verts, 79,202 tris -> 60fps & crisp bow waves
    const geometry = this.createStretchedOceanGrid(segments);

    this.material = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERTEX_SHADER,
      fragmentShader: OCEAN_FRAGMENT_SHADER,
      uniforms: {
        uWaveA: { value: waveField.uWaveA },
        uWaveB: { value: waveField.uWaveB },
        uOriginMod: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color('#ffe4bd') },
        uZenithColor: { value: new THREE.Color('#1c4e80') },
        uHorizonColor: { value: new THREE.Color('#9fc2dc') },
        uFogColor: { value: new THREE.Color('#98bcd4') },
        uFogDensity: { value: 0.00028 },
        uSunVisibility: { value: 0.95 },
        uCloudCoverage: { value: 0.32 },
        uCloudDarkness: { value: 0.08 },
        uWindDir: { value: new THREE.Vector2(1, 0) },
        uWindSpeed: { value: 5.5 },
        uChoppiness: { value: 0.28 },
        uFoamIntensity: { value: 0.2 },
        uWaterDeepColor: { value: new THREE.Color('#041c2c') },
        uWaterShallowColor: { value: new THREE.Color('#0e5263') },
        uLightningHotspot: { value: new THREE.Vector3(0, 0.3, -1) },
        uLightningStrength: { value: 0 },
        uFlashIntensity: { value: 0 },
        uLightningDir: { value: new THREE.Vector3(0, 1, -1) },
        uStormDir: { value: new THREE.Vector3(0, 0, -1) },
        uStormAngularRadius: { value: 0.45 },
        uStormIntensity: { value: 0 },
        uShipPos: { value: new THREE.Vector3() },
        uShipYaw: { value: 0 },
        uShipSpeed: { value: 5.5 },
        uBowSubmersion: { value: 0 },
      },
      fog: false, // Fog is evaluated analytically inside OCEAN_FRAGMENT_SHADER
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
  }

  private createStretchedOceanGrid(segments: number): THREE.BufferGeometry {
    const count = segments + 1;
    const vertexCount = count * count;
    const positions = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(segments * segments * 6);

    const mapCoord = (u: number): number => {
      const absU = Math.abs(u);
      const sign = u < 0 ? -1 : 1;
      if (absU <= this.innerNormSplit) {
        return (u / this.innerNormSplit) * this.innerHalfSpan;
      }
      const t = (absU - this.innerNormSplit) / (1.0 - this.innerNormSplit);
      // C1-continuous transition from 2.0m spacing to 4500m horizon
      const dist = this.innerHalfSpan + 200.0 * t + 4200.0 * t * t * t;
      return sign * dist;
    };

    let ptr = 0;
    for (let iz = 0; iz < count; iz++) {
      const vz = (iz / segments) * 2.0 - 1.0;
      const z = mapCoord(vz);
      for (let ix = 0; ix < count; ix++) {
        const vx = (ix / segments) * 2.0 - 1.0;
        const x = mapCoord(vx);
        positions[ptr++] = x;
        positions[ptr++] = 0;
        positions[ptr++] = z;
      }
    }

    let iPtr = 0;
    for (let iz = 0; iz < segments; iz++) {
      for (let ix = 0; ix < segments; ix++) {
        const a = iz * count + ix;
        const b = a + 1;
        const c = a + count;
        const d = c + 1;

        indices[iPtr++] = a;
        indices[iPtr++] = c;
        indices[iPtr++] = b;

        indices[iPtr++] = b;
        indices[iPtr++] = c;
        indices[iPtr++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
  }

  public getSnappedOrigin(shipX: number, shipZ: number): [number, number] {
    const ox = Math.floor(shipX / this.gridSnapStep) * this.gridSnapStep;
    const oz = Math.floor(shipZ / this.gridSnapStep) * this.gridSnapStep;
    return [ox, oz];
  }

  public update(
    elapsedTime: number,
    originX: number,
    originZ: number,
    ship: ShipState,
    weather: WeatherParams,
    sunDir: THREE.Vector3,
    fogColor: THREE.Color,
    lightning: LightningState,
    stormBearingDir: THREE.Vector3,
    stormAngularRadius: number,
    stormIntensity: number,
  ): void {
    this.mesh.position.set(originX, 0, originZ);

    const u = this.material.uniforms;
    u.uOriginMod.value.set(originX % 16384.0, originZ % 16384.0);
    u.uTime.value = elapsedTime;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(weather.sunColor);
    u.uZenithColor.value.copy(weather.skyZenithColor);
    u.uHorizonColor.value.copy(weather.skyHorizonColor);
    u.uFogColor.value.copy(fogColor);
    u.uFogDensity.value = weather.fogDensity;
    u.uSunVisibility.value = weather.sunVisibility;
    u.uCloudCoverage.value = weather.cloudCoverage;
    u.uCloudDarkness.value = weather.cloudDarkness;
    u.uWindDir.value.set(Math.cos(weather.windAngle), Math.sin(weather.windAngle));
    u.uWindSpeed.value = weather.windSpeed;
    u.uChoppiness.value = weather.waveChoppiness;
    u.uFoamIntensity.value = weather.foamIntensity;
    u.uWaterDeepColor.value.copy(weather.waterDeepColor);
    u.uWaterShallowColor.value.copy(weather.waterShallowColor);
    u.uLightningHotspot.value.copy(lightning.cloudHotspot);
    u.uLightningStrength.value = lightning.hotspotStrength;
    u.uFlashIntensity.value = lightning.flashIntensity;
    u.uLightningDir.value.copy(lightning.flashDirection);
    u.uStormDir.value.copy(stormBearingDir);
    u.uStormAngularRadius.value = stormAngularRadius;
    u.uStormIntensity.value = stormIntensity;

    u.uShipPos.value.set(ship.x, ship.y, ship.z);
    u.uShipYaw.value = ship.yaw;
    u.uShipSpeed.value = ship.forwardSpeed;
    u.uBowSubmersion.value = ship.bowSubmersion;
  }

  public dispose(scene: THREE.Scene): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    scene.remove(this.mesh);
  }
}
