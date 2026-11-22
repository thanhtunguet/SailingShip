import * as THREE from 'three';
import { LightningState, ShipState, WeatherParams } from './types';

const RAIN_COUNT = 2200;
const RAIN_BOX_X = 46;
const RAIN_BOX_Y = 22;
const RAIN_BOX_Z = 46;

const SPRAY_COUNT = 380;

const SPRAY_VERTEX_SHADER = /* glsl */ `
attribute float aSize;
attribute float aAlpha;

varying float vAlpha;

void main() {
  vAlpha = aAlpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (280.0 / max(-mvPos.z, 1.0));
  gl_Position = projectionMatrix * mvPos;
}
`;

const SPRAY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform sampler2D uSprite;

varying float vAlpha;

void main() {
  if (vAlpha <= 0.004) discard;
  vec4 tex = texture2D(uSprite, gl_PointCoord);
  float alpha = tex.a * vAlpha;
  if (alpha <= 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

function createMistTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  grad.addColorStop(0.35, 'rgba(240, 248, 255, 0.45)');
  grad.addColorStop(0.75, 'rgba(220, 235, 245, 0.12)');
  grad.addColorStop(1, 'rgba(220, 235, 245, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Wind-driven 3D rain volume and dynamic bow/sea spray particle system.
 * Zero per-frame allocations; all buffers updated in place.
 */
export class ParticleEffects {
  // Rain state
  private readonly rainLines: THREE.LineSegments;
  private readonly rainMat: THREE.LineBasicMaterial;
  private readonly rainSeeds = new Float32Array(RAIN_COUNT * 3);
  private readonly rainSpeeds = new Float32Array(RAIN_COUNT);
  private readonly rainPositions = new Float32Array(RAIN_COUNT * 6);

  // Spray state
  private readonly sprayPoints: THREE.Points;
  private readonly sprayMat: THREE.ShaderMaterial;
  private readonly spraySprite: THREE.CanvasTexture;
  private readonly sprayPos = new Float32Array(SPRAY_COUNT * 3);
  private readonly sprayVel = new Float32Array(SPRAY_COUNT * 3);
  private readonly sprayAge = new Float32Array(SPRAY_COUNT);
  private readonly sprayLife = new Float32Array(SPRAY_COUNT);
  private readonly spraySize = new Float32Array(SPRAY_COUNT);
  private readonly sprayAlpha = new Float32Array(SPRAY_COUNT);
  private sprayCursor = 0;

  private readonly _localVec = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(scene: THREE.Scene) {
    // 1. Rain setup
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainSeeds[i * 3] = (Math.random() - 0.5) * RAIN_BOX_X;
      this.rainSeeds[i * 3 + 1] = Math.random() * RAIN_BOX_Y;
      this.rainSeeds[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX_Z;
      this.rainSpeeds[i] = 23.0 + Math.random() * 9.0;
    }

    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.rainPositions, 3),
    );

    this.rainMat = new THREE.LineBasicMaterial({
      color: '#c8d9e8',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });

    this.rainLines = new THREE.LineSegments(rainGeo, this.rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = 12;
    this.rainLines.visible = false;
    scene.add(this.rainLines);

    // 2. Spray setup
    this.sprayAge.fill(999);
    this.sprayLife.fill(1);
    this.spraySprite = createMistTexture();

    const sprayGeo = new THREE.BufferGeometry();
    sprayGeo.setAttribute('position', new THREE.BufferAttribute(this.sprayPos, 3));
    sprayGeo.setAttribute('aSize', new THREE.BufferAttribute(this.spraySize, 1));
    sprayGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.sprayAlpha, 1));

    this.sprayMat = new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERTEX_SHADER,
      fragmentShader: SPRAY_FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color('#eef6fc') },
        uSprite: { value: this.spraySprite },
      },
      transparent: true,
      depthWrite: false,
    });

    this.sprayPoints = new THREE.Points(sprayGeo, this.sprayMat);
    this.sprayPoints.frustumCulled = false;
    this.sprayPoints.renderOrder = 11;
    scene.add(this.sprayPoints);
  }

  public update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    ship: ShipState,
    weather: WeatherParams,
    lightning: LightningState,
  ): void {
    this.updateRain(dt, camera, ship, weather, lightning);
    this.updateSpray(dt, ship, weather, lightning);
  }

  private updateRain(
    dt: number,
    camera: THREE.PerspectiveCamera,
    ship: ShipState,
    weather: WeatherParams,
    lightning: LightningState,
  ): void {
    const intensity = weather.rainIntensity;
    if (intensity < 0.015) {
      this.rainLines.visible = false;
      return;
    }

    this.rainLines.visible = true;
    const activeCount = Math.floor(RAIN_COUNT * THREE.MathUtils.clamp(intensity, 0.05, 1.0));
    this.rainLines.geometry.setDrawRange(0, activeCount * 2);

    const windX = Math.cos(weather.windAngle) * weather.windSpeed;
    const windZ = Math.sin(weather.windAngle) * weather.windSpeed;

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const cyCos = Math.cos(ship.yaw);
    const cySin = Math.sin(ship.yaw);

    const halfX = RAIN_BOX_X * 0.5;
    const halfY = RAIN_BOX_Y * 0.5;
    const halfZ = RAIN_BOX_Z * 0.5;

    const streakTime = 0.048;

    for (let i = 0; i < activeCount; i++) {
      const i3 = i * 3;
      const fall = this.rainSpeeds[i];

      let rx = this.rainSeeds[i3] + windX * 0.72 * dt;
      let ry = this.rainSeeds[i3 + 1] - fall * dt;
      let rz = this.rainSeeds[i3 + 2] + windZ * 0.72 * dt;

      // Wrap seamlessly relative to camera movement
      rx = ((((rx - cx + halfX) % RAIN_BOX_X) + RAIN_BOX_X) % RAIN_BOX_X) + cx - halfX;
      ry = ((((ry - cy + halfY) % RAIN_BOX_Y) + RAIN_BOX_Y) % RAIN_BOX_Y) + cy - halfY;
      rz = ((((rz - cz + halfZ) % RAIN_BOX_Z) + RAIN_BOX_Z) % RAIN_BOX_Z) + cz - halfZ;

      this.rainSeeds[i3] = rx;
      this.rainSeeds[i3 + 1] = ry;
      this.rainSeeds[i3 + 2] = rz;

      // Keep rain streaks outside the enclosed wheelhouse cabin
      const dx = rx - ship.x;
      const dz = rz - ship.z;
      const localX = dx * cyCos - dz * cySin;
      const localZ = dx * cySin + dz * cyCos;
      const localY = ry - ship.y;
      let drawX = rx;
      let drawZ = rz;
      if (
        Math.abs(localX) < 4.55 &&
        localZ > 0.25 &&
        localZ < 5.75 &&
        localY > 5.0 &&
        localY < 8.6
      ) {
        // Project drop forward outside the windshield so view stays sheltered
        const shiftZ = -6.5;
        drawX += shiftZ * cySin;
        drawZ += shiftZ * cyCos;
      }

      const i6 = i * 6;
      this.rainPositions[i6] = drawX;
      this.rainPositions[i6 + 1] = ry;
      this.rainPositions[i6 + 2] = drawZ;

      this.rainPositions[i6 + 3] = drawX - windX * 0.72 * streakTime;
      this.rainPositions[i6 + 4] = ry + fall * streakTime;
      this.rainPositions[i6 + 5] = drawZ - windZ * 0.72 * streakTime;
    }

    (this.rainLines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    this.rainMat.opacity = THREE.MathUtils.clamp(intensity * 0.42 + lightning.flashIntensity * 0.14, 0, 0.65);
    this.rainMat.color
      .copy(weather.skyHorizonColor)
      .lerp(lightning.flashColor, Math.min(0.65, lightning.flashIntensity * 0.4))
      .lerp(new THREE.Color('#dbe8f5'), 0.45);
  }

  private updateSpray(
    dt: number,
    ship: ShipState,
    weather: WeatherParams,
    lightning: LightningState,
  ): void {
    this._euler.set(ship.pitch, ship.yaw, ship.roll, 'YXZ');
    this._quat.setFromEuler(this._euler);

    const windX = Math.cos(weather.windAngle) * weather.windSpeed;
    const windZ = Math.sin(weather.windAngle) * weather.windSpeed;

    // Emit bow impact spray when hull plunges into oncoming waves at speed
    const bowBurstRate =
      (ship.bowImpact * 140 + ship.bowSubmersion * 55) *
      THREE.MathUtils.clamp(ship.forwardSpeed / 5.0, 0.15, 1.5);
    const windSpindriftRate = weather.sprayIntensity * 42;
    const spawnCount = Math.min(18, Math.floor((bowBurstRate + windSpindriftRate) * dt + Math.random()));

    for (let s = 0; s < spawnCount; s++) {
      const idx = this.sprayCursor;
      this.sprayCursor = (this.sprayCursor + 1) % SPRAY_COUNT;

      const isBowSpray = s < Math.ceil(spawnCount * 0.75) && ship.forwardSpeed > 1.2;
      const side = Math.random() > 0.5 ? 1 : -1;

      if (isBowSpray) {
        // Spawn along flared bow cheeks
        const localZ = -24.2 + Math.random() * 5.8;
        const localX = side * (0.4 + Math.random() * 2.2);
        const localY = 1.6 + Math.random() * 1.1;
        this._localVec.set(localX, localY, localZ).applyQuaternion(this._quat);

        const i3 = idx * 3;
        this.sprayPos[i3] = ship.x + this._localVec.x;
        this.sprayPos[i3 + 1] = ship.y + this._localVec.y;
        this.sprayPos[i3 + 2] = ship.z + this._localVec.z;

        // Throw outward from bow flare + upward + downwind
        this._localVec
          .set(side * (2.6 + Math.random() * 3.5), 4.2 + Math.random() * 4.5 + ship.bowImpact * 3.2, -1.5 + Math.random() * 2.0)
          .applyQuaternion(this._quat);
        this.sprayVel[i3] = this._localVec.x + windX * 0.35;
        this.sprayVel[i3 + 1] = this._localVec.y;
        this.sprayVel[i3 + 2] = this._localVec.z + windZ * 0.35;

        this.spraySize[idx] = 2.6 + Math.random() * 2.8;
        this.sprayLife[idx] = 1.1 + Math.random() * 0.9;
        this.sprayAge[idx] = 0;
      } else {
        // Wind-blown whitecap spindrift across nearby ocean surface
        const spreadAngle = ship.yaw + (Math.random() - 0.5) * 1.8;
        const dist = 14 + Math.random() * 52;
        const wx = ship.x - Math.sin(spreadAngle) * dist;
        const wz = ship.z - Math.cos(spreadAngle) * dist;

        const i3 = idx * 3;
        this.sprayPos[i3] = wx;
        this.sprayPos[i3 + 1] = 0.6 + Math.random() * 1.4;
        this.sprayPos[i3 + 2] = wz;

        this.sprayVel[i3] = windX * (0.65 + Math.random() * 0.25);
        this.sprayVel[i3 + 1] = 1.4 + Math.random() * 2.0;
        this.sprayVel[i3 + 2] = windZ * (0.65 + Math.random() * 0.25);

        this.spraySize[idx] = 4.2 + Math.random() * 4.5;
        this.sprayLife[idx] = 1.4 + Math.random() * 1.1;
        this.sprayAge[idx] = 0;
      }
    }

    // Integrate active spray droplets
    for (let i = 0; i < SPRAY_COUNT; i++) {
      if (this.sprayAge[i] >= this.sprayLife[i]) {
        this.sprayAlpha[i] = 0;
        continue;
      }
      this.sprayAge[i] += dt;
      const u = this.sprayAge[i] / this.sprayLife[i];
      if (u >= 1) {
        this.sprayAlpha[i] = 0;
        continue;
      }

      const i3 = i * 3;
      // Wind drag + gravity
      this.sprayVel[i3] += (windX * 0.65 - this.sprayVel[i3]) * 0.85 * dt;
      this.sprayVel[i3 + 1] -= 6.2 * dt;
      this.sprayVel[i3 + 2] += (windZ * 0.65 - this.sprayVel[i3 + 2]) * 0.85 * dt;

      this.sprayPos[i3] += this.sprayVel[i3] * dt;
      this.sprayPos[i3 + 1] += this.sprayVel[i3 + 1] * dt;
      this.sprayPos[i3 + 2] += this.sprayVel[i3 + 2] * dt;

      this.spraySize[i] += 2.2 * dt;
      // Smooth bell-shaped alpha fade
      const fadeIn = Math.min(1, u * 6.0);
      const fadeOut = (1.0 - u) * (1.0 - u);
      this.sprayAlpha[i] = fadeIn * fadeOut * 0.46;
    }

    const geo = this.sprayPoints.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;

    this.sprayMat.uniforms.uColor.value
      .copy(weather.skyHorizonColor)
      .lerp(new THREE.Color('#ffffff'), 0.45 + 0.35 * weather.sunVisibility)
      .lerp(lightning.flashColor, Math.min(0.6, lightning.flashIntensity * 0.4));
  }

  public dispose(scene: THREE.Scene): void {
    this.rainLines.geometry.dispose();
    this.rainMat.dispose();
    scene.remove(this.rainLines);

    this.sprayPoints.geometry.dispose();
    this.sprayMat.dispose();
    this.spraySprite.dispose();
    scene.remove(this.sprayPoints);
  }
}
