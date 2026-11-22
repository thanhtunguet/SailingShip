import * as THREE from 'three';
import { LightningState, StormCellState, WeatherParams } from './types';

const SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldDir;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vWorldDir;

uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform float uSunVisibility;
uniform float uCloudCoverage;
uniform float uCloudDarkness;
uniform vec2 uWindOffset;
uniform vec3 uLightningHotspot;
uniform float uLightningStrength;
uniform float uFlashIntensity;

// Localized Storm Ahead cell
uniform vec3 uStormDir;
uniform float uStormAngularRadius;
uniform float uStormIntensity;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbmClouds(vec2 p) {
  float v = 0.0;
  float amp = 0.52;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    v += amp * noise2(p);
    p = rot * p * 2.04 + vec2(13.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float y = max(dir.y, 0.0);

  // Localized storm squall mask on the forward horizon
  vec2 dirXZ = normalize(dir.xz + vec2(1e-5));
  vec2 stormXZ = normalize(uStormDir.xz + vec2(1e-5));
  float stormAngle = acos(clamp(dot(dirXZ, stormXZ), -1.0, 1.0));
  float stormSector = (1.0 - smoothstep(uStormAngularRadius * 0.35, uStormAngularRadius * 1.15, stormAngle)) * uStormIntensity;
  float stormHeightMask = smoothstep(0.55, 0.04, dir.y);
  float localStorm = stormSector * stormHeightMask;

  float horizonCurve = pow(1.0 - y, 3.2);
  vec3 skyCol = mix(uZenithColor, uHorizonColor, horizonCurve);

  // Darken atmospheric backdrop inside the distant storm cell
  vec3 stormHorizonCol = vec3(0.11, 0.16, 0.21);
  skyCol = mix(skyCol, stormHorizonCol, localStorm * 0.78);

  float sunDot = max(dot(dir, uSunDir), 0.0);
  float mieGlow = pow(sunDot, 6.0) * 0.35 + pow(sunDot, 48.0) * 0.55;
  float sunDisc = smoothstep(0.99935, 0.99975, sunDot);
  skyCol += uSunColor * (mieGlow * (0.28 + 0.72 * uSunVisibility) * (1.0 - localStorm * 0.85));

  if (dir.y > 0.005) {
    float projY = dir.y + 0.14;
    vec2 cloudUV = (dir.xz / projY) * 1.45 + uWindOffset;

    float baseNoise = fbmClouds(cloudUV);
    float detailNoise = fbmClouds(cloudUV * 2.35 + uWindOffset * 0.6);
    float cloudField = mix(baseNoise, detailNoise, 0.32);

    float effectiveCov = clamp(uCloudCoverage + localStorm * 0.75, 0.0, 1.0);
    float effectiveDark = clamp(uCloudDarkness + localStorm * 0.82, 0.0, 1.0);

    float threshold = mix(0.76, 0.22, effectiveCov);
    float density = smoothstep(threshold, threshold + 0.28, cloudField);

    vec2 sunStep = uSunDir.xz * 0.16;
    float sunSample = fbmClouds(cloudUV + sunStep);
    float litEdge = clamp((cloudField - sunSample) * 2.4 + 0.55, 0.0, 1.0);

    vec3 cloudBright = mix(uHorizonColor * 1.12, uSunColor * 1.18, 0.45 * uSunVisibility);
    vec3 cloudShadow = mix(uZenithColor * 0.55, vec3(0.06, 0.09, 0.13), effectiveDark);
    vec3 cloudCol = mix(cloudShadow, cloudBright, litEdge * (1.0 - 0.74 * effectiveDark));

    float hotDot = max(dot(dir, normalize(uLightningHotspot)), 0.0);
    float cloudScatter = pow(hotDot, 3.5) * uLightningStrength * 0.95 + uFlashIntensity * 0.22;
    cloudCol += vec3(0.72, 0.86, 1.0) * cloudScatter * (0.35 + 0.65 * density);

    float sunThroughCloud = (1.0 - density * 0.92) * uSunVisibility * (1.0 - localStorm * 0.95);
    skyCol += uSunColor * sunDisc * 4.5 * sunThroughCloud;

    float horizonFade = smoothstep(0.01, 0.22, dir.y);
    skyCol = mix(skyCol, cloudCol, density * horizonFade * (0.55 + 0.45 * effectiveCov));

    // Distant rain-shaft curtain hanging beneath the Storm Ahead squall wall
    float rainShaftMask = stormSector * smoothstep(0.24, 0.02, dir.y) * smoothstep(0.0, 0.03, dir.y);
    float rainStreaks = 0.75 + 0.25 * noise2(vec2(stormAngle * 38.0, dir.y * 8.0 + uTime * 1.8));
    skyCol = mix(skyCol, vec3(0.14, 0.19, 0.25), rainShaftMask * rainStreaks * 0.68);
  }

  skyCol += vec3(0.45, 0.58, 0.82) * uFlashIntensity * 0.16;

  if (dir.y < 0.0) {
    skyCol = mix(uHorizonColor, uZenithColor * 0.3, clamp(-dir.y * 4.0, 0.0, 1.0));
  }

  gl_FragColor = vec4(skyCol, 1.0);
}
`;

/**
 * Manages procedural sky dome, directional sun light, hemisphere fill,
 * horizon fog, localized Storm Ahead cloud wall, and dynamic weather lighting.
 */
export class SkyAndAtmosphere {
  public readonly skyMesh: THREE.Mesh;
  public readonly skyMaterial: THREE.ShaderMaterial;
  public readonly sunLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly rimLight: THREE.DirectionalLight;
  public readonly fog: THREE.FogExp2;
  public readonly sunDirection = new THREE.Vector3();

  private readonly windOffset = new THREE.Vector2();

  constructor(scene: THREE.Scene, isSoftwareGl: boolean) {
    const skyGeo = new THREE.SphereGeometry(5200, 48, 32);
    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.4, 0.3, -0.8).normalize() },
        uSunColor: { value: new THREE.Color('#ffe4bd') },
        uZenithColor: { value: new THREE.Color('#1c4e80') },
        uHorizonColor: { value: new THREE.Color('#9fc2dc') },
        uSunVisibility: { value: 0.95 },
        uCloudCoverage: { value: 0.32 },
        uCloudDarkness: { value: 0.08 },
        uWindOffset: { value: new THREE.Vector2() },
        uLightningHotspot: { value: new THREE.Vector3(0, 0.3, -1) },
        uLightningStrength: { value: 0 },
        uFlashIntensity: { value: 0 },
        uStormDir: { value: new THREE.Vector3(0, 0, -1) },
        uStormAngularRadius: { value: 0.45 },
        uStormIntensity: { value: 0 },
      },
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -10;
    scene.add(this.skyMesh);

    this.hemiLight = new THREE.HemisphereLight('#8ec1e6', '#132c3d', 0.85);
    scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#ffe4bd', 2.4);
    this.sunLight.castShadow = !isSoftwareGl;
    if (!isSoftwareGl) {
      this.sunLight.shadow.mapSize.width = 2048;
      this.sunLight.shadow.mapSize.height = 2048;
      const d = 34;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.camera.near = 5;
      this.sunLight.shadow.camera.far = 160;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.025;
    }
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight('#6b88a3', 0.45);
    scene.add(this.rimLight);
    scene.add(this.rimLight.target);

    this.fog = new THREE.FogExp2('#98bcd4', 0.00028);
    scene.fog = this.fog;
  }

  public update(
    dt: number,
    elapsedTime: number,
    weather: WeatherParams,
    lightning: LightningState,
    stormCell: StormCellState,
    shipX: number,
    shipZ: number,
    renderer: THREE.WebGLRenderer,
  ): void {
    this.skyMesh.position.set(shipX, 0, shipZ);

    const cosEl = Math.cos(weather.sunElevation);
    this.sunDirection.set(
      Math.sin(weather.sunAzimuth) * cosEl,
      Math.sin(weather.sunElevation),
      -Math.cos(weather.sunAzimuth) * cosEl,
    ).normalize();

    const windSpeedScale = 0.0014 * (0.4 + weather.windSpeed * 0.09);
    this.windOffset.x += Math.cos(weather.windAngle) * windSpeedScale * dt;
    this.windOffset.y += Math.sin(weather.windAngle) * windSpeedScale * dt;

    const u = this.skyMaterial.uniforms;
    u.uTime.value = elapsedTime;
    u.uSunDir.value.copy(this.sunDirection);
    u.uSunColor.value.copy(weather.sunColor);
    u.uZenithColor.value.copy(weather.skyZenithColor);
    u.uHorizonColor.value.copy(weather.skyHorizonColor);
    u.uSunVisibility.value = weather.sunVisibility;
    u.uCloudCoverage.value = weather.cloudCoverage;
    u.uCloudDarkness.value = weather.cloudDarkness;
    u.uWindOffset.value.copy(this.windOffset);
    u.uLightningHotspot.value.copy(lightning.cloudHotspot);
    u.uLightningStrength.value = lightning.hotspotStrength;
    u.uFlashIntensity.value = lightning.flashIntensity;
    u.uStormDir.value.copy(stormCell.bearingDir);
    u.uStormAngularRadius.value = stormCell.angularRadius;
    u.uStormIntensity.value = stormCell.active ? stormCell.intensity : 0;

    this.sunLight.position
      .copy(this.sunDirection)
      .multiplyScalar(75)
      .add(new THREE.Vector3(shipX, 8, shipZ));
    this.sunLight.target.position.set(shipX, 2, shipZ - 6);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.copy(weather.sunColor);
    this.sunLight.intensity = 0.35 + weather.sunVisibility * 2.35;

    this.rimLight.position.set(
      shipX - this.sunDirection.x * 45,
      25,
      shipZ - this.sunDirection.z * 45,
    );
    this.rimLight.target.position.set(shipX, 3, shipZ);
    this.rimLight.target.updateMatrixWorld();
    this.rimLight.color.copy(weather.hemiSkyColor);
    this.rimLight.intensity = 0.32 + (1.0 - weather.sunVisibility) * 0.35;

    this.hemiLight.color.copy(weather.hemiSkyColor);
    this.hemiLight.groundColor.copy(weather.hemiGroundColor);
    this.hemiLight.intensity =
      0.55 + weather.sunVisibility * 0.4 + lightning.flashIntensity * 0.55;

    this.fog.color.copy(weather.fogColor);
    if (lightning.flashIntensity > 0.01) {
      this.fog.color.lerp(
        lightning.flashColor,
        Math.min(0.45, lightning.flashIntensity * 0.25),
      );
    }
    this.fog.density = weather.fogDensity;

    renderer.toneMappingExposure = weather.exposure;
  }

  public dispose(scene: THREE.Scene): void {
    this.skyMesh.geometry.dispose();
    this.skyMaterial.dispose();
    scene.remove(this.skyMesh);
    scene.remove(this.sunLight);
    scene.remove(this.sunLight.target);
    scene.remove(this.rimLight);
    scene.remove(this.rimLight.target);
    scene.remove(this.hemiLight);
  }
}
