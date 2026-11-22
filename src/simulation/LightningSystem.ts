import * as THREE from 'three';
import { LightningState, WeatherParams } from './types';

interface ActiveBolt {
  group: THREE.Group;
  coreLine: THREE.LineSegments;
  glowLine: THREE.LineSegments;
  coreMat: THREE.LineBasicMaterial;
  glowMat: THREE.LineBasicMaterial;
  age: number;
  duration: number;
  peakIntensity: number;
  doubleStroke: boolean;
  worldOriginOffset: THREE.Vector3;
  isNearby: boolean;
}

const MAX_BOLTS = 2;
const MAX_SEGMENTS = 140;

/**
 * Generates procedural 3D forked lightning bolts, cloud sheet flashes,
 * multi-stroke flicker envelopes, and dynamic flash illumination.
 */
export class LightningSystem {
  public readonly state: LightningState = {
    flashIntensity: 0,
    flashDirection: new THREE.Vector3(0, 1, -1).normalize(),
    flashColor: new THREE.Color('#c8deff'),
    cloudHotspot: new THREE.Vector3(0, 0.3, -1).normalize(),
    hotspotStrength: 0,
  };

  public readonly flashLight: THREE.DirectionalLight;
  private readonly bolts: ActiveBolt[] = [];
  private timeUntilNextEvent = 8.0;
  private sheetAge = -1;
  private sheetDuration = 0.28;
  private sheetPeak = 0;

  constructor(scene: THREE.Scene) {
    this.flashLight = new THREE.DirectionalLight('#d8e8ff', 0);
    this.flashLight.castShadow = false;
    scene.add(this.flashLight);
    scene.add(this.flashLight.target);

    for (let i = 0; i < MAX_BOLTS; i++) {
      const bolt = this.createBoltPoolEntry();
      bolt.group.visible = false;
      scene.add(bolt.group);
      this.bolts.push(bolt);
    }
  }

  private createBoltPoolEntry(): ActiveBolt {
    const group = new THREE.Group();
    const coreGeo = new THREE.BufferGeometry();
    const glowGeo = new THREE.BufferGeometry();

    const corePositions = new Float32Array(MAX_SEGMENTS * 6);
    const glowPositions = new Float32Array(MAX_SEGMENTS * 6);

    coreGeo.setAttribute('position', new THREE.BufferAttribute(corePositions, 3));
    glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
    coreGeo.setDrawRange(0, 0);
    glowGeo.setDrawRange(0, 0);

    const coreMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#f4f9ff'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });

    const glowMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#6ca8ff'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });

    const coreLine = new THREE.LineSegments(coreGeo, coreMat);
    const glowLine = new THREE.LineSegments(glowGeo, glowMat);
    coreLine.frustumCulled = false;
    glowLine.frustumCulled = false;
    coreLine.renderOrder = 20;
    glowLine.renderOrder = 19;

    group.add(glowLine);
    group.add(coreLine);

    return {
      group,
      coreLine,
      glowLine,
      coreMat,
      glowMat,
      age: 999,
      duration: 0.3,
      peakIntensity: 1,
      doubleStroke: false,
      worldOriginOffset: new THREE.Vector3(),
      isNearby: false,
    };
  }

  public update(
    dt: number,
    weather: WeatherParams,
    shipX: number,
    shipZ: number,
    shipYaw: number,
  ): LightningState {
    // Schedule randomized lightning during storms
    if (weather.lightningRate > 0.05) {
      this.timeUntilNextEvent -= dt * (weather.lightningRate / 6.0);
      if (this.timeUntilNextEvent <= 0) {
        this.triggerLightningEvent(shipX, shipZ, shipYaw);
        // Randomized interval: 3.5s to 15s (scaled by rate)
        this.timeUntilNextEvent = 3.5 + Math.random() * 11.5;
      }
    } else {
      this.timeUntilNextEvent = 5.0;
    }

    let totalFlash = 0;
    let totalHotspot = 0;

    // Update sheet lightning envelope
    if (this.sheetAge >= 0) {
      this.sheetAge += dt;
      if (this.sheetAge >= this.sheetDuration) {
        this.sheetAge = -1;
      } else {
        const u = this.sheetAge / this.sheetDuration;
        const flicker = this.evaluateFlickerEnvelope(u, true);
        totalFlash += flicker * this.sheetPeak * 0.65;
        totalHotspot += flicker * this.sheetPeak * 1.15;
      }
    }

    // Update active 3D lightning bolts
    for (const bolt of this.bolts) {
      if (!bolt.group.visible) continue;
      bolt.age += dt;
      if (bolt.age >= bolt.duration) {
        bolt.group.visible = false;
        continue;
      }
      const u = bolt.age / bolt.duration;
      const envelope = this.evaluateFlickerEnvelope(u, bolt.doubleStroke);

      bolt.coreMat.opacity = THREE.MathUtils.clamp(envelope * 1.15, 0, 1);
      bolt.glowMat.opacity = THREE.MathUtils.clamp(envelope * 0.55, 0, 0.85);

      const sceneBoost = envelope * bolt.peakIntensity;
      totalFlash += sceneBoost;
      totalHotspot += sceneBoost * 1.25;
    }

    this.state.flashIntensity = Math.min(totalFlash, 2.4);
    this.state.hotspotStrength = Math.min(totalHotspot, 2.5);

    // Position lightning DirectionalLight along the active flash direction
    this.flashLight.position
      .copy(this.state.flashDirection)
      .multiplyScalar(220)
      .add(new THREE.Vector3(shipX, 40, shipZ));
    this.flashLight.target.position.set(shipX, 0, shipZ);
    this.flashLight.target.updateMatrixWorld();
    this.flashLight.intensity = this.state.flashIntensity * 4.2;

    return this.state;
  }

  private triggerLightningEvent(shipX: number, shipZ: number, shipYaw: number): void {
    // Pick bearing within forward ~150 degree cone so user sees strikes ahead/flanks
    const forwardBearing = shipYaw + Math.PI; // note: yaw=0 -> forward is -Z
    const relAngle = (Math.random() - 0.5) * 2.3;
    const dirX = Math.sin(shipYaw) * -Math.cos(relAngle) + Math.cos(shipYaw) * Math.sin(relAngle);
    const dirZ = -Math.cos(shipYaw) * Math.cos(relAngle) - Math.sin(shipYaw) * Math.sin(relAngle);
    void forwardBearing;

    const roll = Math.random();
    if (roll < 0.42) {
      // Cloud-to-cloud sheet lightning
      this.sheetAge = 0;
      this.sheetDuration = 0.22 + Math.random() * 0.18;
      this.sheetPeak = 0.45 + Math.random() * 0.45;
      this.state.cloudHotspot.set(dirX, 0.22 + Math.random() * 0.22, dirZ).normalize();
      this.state.flashDirection.copy(this.state.cloudHotspot);
      return;
    }

    // Spawn 3D bolt (nearby ~28%, distant ~72%)
    const isNearby = roll > 0.78;
    const distance = isNearby
      ? 260 + Math.random() * 340
      : 720 + Math.random() * 950;

    const strikeX = shipX + dirX * distance;
    const strikeZ = shipZ + dirZ * distance;
    const cloudHeight = isNearby ? 230 + Math.random() * 80 : 340 + Math.random() * 140;

    const bolt = this.bolts.find((b) => !b.group.visible) ?? this.bolts[0];
    this.buildBoltGeometry(bolt, strikeX, cloudHeight, strikeZ, isNearby);

    bolt.group.visible = true;
    bolt.age = 0;
    bolt.duration = isNearby ? 0.34 : 0.26;
    bolt.peakIntensity = isNearby ? 1.55 : 0.72;
    bolt.doubleStroke = Math.random() > 0.35;
    bolt.isNearby = isNearby;

    this.state.cloudHotspot.set(dirX, 0.25, dirZ).normalize();
    this.state.flashDirection.set(dirX, 0.38, dirZ).normalize();
  }

  private buildBoltGeometry(
    bolt: ActiveBolt,
    x: number,
    topY: number,
    z: number,
    isNearby: boolean,
  ): void {
    const segments: Array<[number, number, number, number, number, number]> = [];
    const lateralScale = isNearby ? 26 : 52;

    // Recursive midpoint displacement for realistic jagged leader + branches
    const subdivide = (
      x1: number,
      y1: number,
      z1: number,
      x2: number,
      y2: number,
      z2: number,
      disp: number,
      depth: number,
      allowBranch: boolean,
    ) => {
      if (segments.length >= MAX_SEGMENTS - 2) return;
      if (depth <= 0) {
        segments.push([x1, y1, z1, x2, y2, z2]);
        return;
      }

      const mx = (x1 + x2) * 0.5 + (Math.random() - 0.5) * disp;
      const my = (y1 + y2) * 0.5 + (Math.random() - 0.5) * disp * 0.25;
      const mz = (z1 + z2) * 0.5 + (Math.random() - 0.5) * disp;

      subdivide(x1, y1, z1, mx, my, mz, disp * 0.56, depth - 1, allowBranch);
      subdivide(mx, my, mz, x2, y2, z2, disp * 0.56, depth - 1, false);

      if (allowBranch && depth >= 2 && Math.random() < 0.55) {
        const bx = mx + (Math.random() - 0.5) * disp * 1.9;
        const by = my - Math.abs(y1 - y2) * (0.35 + Math.random() * 0.35);
        const bz = mz + (Math.random() - 0.5) * disp * 1.9;
        subdivide(mx, my, mz, bx, by, bz, disp * 0.45, depth - 2, false);
      }
    };

    const endX = x + (Math.random() - 0.5) * lateralScale;
    const endZ = z + (Math.random() - 0.5) * lateralScale;
    subdivide(x, topY, z, endX, -8, endZ, lateralScale * 1.15, 5, true);

    const count = Math.min(segments.length, MAX_SEGMENTS);
    const coreAttr = bolt.coreLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const glowAttr = bolt.glowLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const coreArr = coreAttr.array as Float32Array;
    const glowArr = glowAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const [x1, y1, z1, x2, y2, z2] = segments[i];
      const idx = i * 6;
      coreArr[idx] = x1;
      coreArr[idx + 1] = y1;
      coreArr[idx + 2] = z1;
      coreArr[idx + 3] = x2;
      coreArr[idx + 4] = y2;
      coreArr[idx + 5] = z2;

      // Slight offset glow layer for multi-pixel bloom feel
      glowArr[idx] = x1 + 0.65;
      glowArr[idx + 1] = y1;
      glowArr[idx + 2] = z1 + 0.65;
      glowArr[idx + 3] = x2 + 0.65;
      glowArr[idx + 4] = y2;
      glowArr[idx + 5] = z2 + 0.65;
    }

    coreAttr.needsUpdate = true;
    glowAttr.needsUpdate = true;
    bolt.coreLine.geometry.setDrawRange(0, count * 2);
    bolt.glowLine.geometry.setDrawRange(0, count * 2);
  }

  private evaluateFlickerEnvelope(u: number, doubleStroke: boolean): number {
    // Primary sharp peak at u ~ 0.08
    const stroke1 = Math.exp(-Math.pow((u - 0.08) * 14.0, 2));
    if (!doubleStroke) {
      return stroke1 * 1.0 + Math.max(0, 1 - u * 1.4) * 0.25;
    }
    // Secondary re-strike around u ~ 0.42
    const stroke2 = Math.exp(-Math.pow((u - 0.42) * 11.0, 2)) * 0.88;
    const afterglow = Math.max(0, 1 - u) * 0.18;
    return Math.min(1.2, stroke1 + stroke2 + afterglow);
  }

  public dispose(scene: THREE.Scene): void {
    for (const bolt of this.bolts) {
      bolt.coreLine.geometry.dispose();
      bolt.glowLine.geometry.dispose();
      bolt.coreMat.dispose();
      bolt.glowMat.dispose();
      scene.remove(bolt.group);
    }
    scene.remove(this.flashLight);
    scene.remove(this.flashLight.target);
  }
}
