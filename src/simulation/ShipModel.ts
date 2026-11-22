import * as THREE from 'three';

export interface ShipModelRefs {
  root: THREE.Group;
  helmWheel: THREE.Group;
  telegraphLever: THREE.Group;
  wiperLeft: THREE.Group;
  wiperRight: THREE.Group;
  windshieldMat: THREE.ShaderMaterial;
  deckMaterial: THREE.MeshStandardMaterial;
  hullMaterial: THREE.MeshStandardMaterial;
  compassGlowMat: THREE.MeshStandardMaterial;
  portLightMat: THREE.MeshStandardMaterial;
  stbdLightMat: THREE.MeshStandardMaterial;
  mastLightMat: THREE.MeshStandardMaterial;
  dispose: () => void;
}

const WINDSHIELD_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WINDSHIELD_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

uniform float uTime;
uniform float uRainIntensity;
uniform float uWiperSweep;
uniform float uFlashIntensity;
uniform vec3 uSkyTint;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vWorldNormal);
  float fresnel = pow(1.0 - abs(dot(V, N)), 4.0);

  // Very clean optical tint + subtle grazing-angle sky reflection (zero milky blur)
  vec3 glassColor = mix(vec3(0.08, 0.14, 0.18), uSkyTint, 0.55);
  float baseAlpha = 0.03 + fresnel * 0.14;

  // Dynamic rain droplets/streaks on the exterior glass during rain/spray
  float rainMask = clamp(uRainIntensity, 0.0, 1.0);
  float dropAlpha = 0.0;
  if (rainMask > 0.02) {
    vec2 grid = vUv * vec2(44.0, 20.0);
    grid.y += uTime * (1.2 + rainMask * 2.4);
    vec2 id = floor(grid);
    vec2 f = fract(grid) - 0.5;
    float rnd = hash21(id);
    if (rnd > 0.62) {
      float streak = smoothstep(0.16, 0.02, abs(f.x + (rnd - 0.8) * 0.35)) * smoothstep(0.45, 0.0, abs(f.y));
      dropAlpha = streak * rainMask * 0.24;
    }

    // Bottom-mounted opposed wiper arc clearing zone
    if (uWiperSweep > 0.01) {
      vec2 pL = vUv - vec2(0.305, 0.01);
      vec2 pR = vUv - vec2(0.695, 0.01);
      float distL = length(pL);
      float distR = length(pR);
      float sweepRad = mix(0.05, 1.35, uWiperSweep);
      float angL = atan(pL.y, pL.x);
      float angR = atan(pR.y, -pR.x);
      float clearedL = step(distL, 0.72) * step(0.0, angL) * step(angL, sweepRad);
      float clearedR = step(distR, 0.72) * step(0.0, angR) * step(angR, sweepRad);
      dropAlpha *= (1.0 - max(clearedL, clearedR) * 0.72);
    }
  }

  vec3 finalCol = glassColor + vec3(0.75, 0.86, 0.96) * (dropAlpha * 1.6 + uFlashIntensity * 0.06);
  float finalAlpha = clamp(baseAlpha + dropAlpha, 0.02, 0.42);
  gl_FragColor = vec4(finalCol, finalAlpha);
}
`;

/**
 * Computes the vessel's beam half-width and deck sheer elevation at local z.
 * Local coordinates: bow tip at z = -25.5, stern at z = +24.0, center at z = 0.
 */
function hullHalfBeamAt(z: number): number {
  if (z <= -25.5) return 0.04;
  if (z < -2.0) {
    const t = (z + 25.5) / 23.5;
    return 0.06 + 4.84 * Math.pow(t, 0.58);
  }
  if (z <= 12.0) {
    return 4.9;
  }
  const t = (z - 12.0) / 12.0;
  return 4.9 - 1.15 * t * t;
}

function deckSheerYAt(z: number): number {
  const norm = THREE.MathUtils.clamp((2.0 - z) / 27.5, 0, 1);
  return 2.35 + 1.5 * Math.pow(norm, 1.85);
}

/**
 * Generates procedural PBR CanvasTextures (deck planking/plates, weathered marine steel, compass rose, radar scope).
 */
function createProceduralTextures(maxAnisotropy: number) {
  // 1. Foredeck non-slip marine plank/plate albedo
  const deckCanvas = document.createElement('canvas');
  deckCanvas.width = 512;
  deckCanvas.height = 512;
  const dCtx = deckCanvas.getContext('2d')!;
  dCtx.fillStyle = '#33414d';
  dCtx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 6500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 42 + Math.floor(Math.random() * 24);
    dCtx.fillStyle = `rgb(${v - 6}, ${v + 4}, ${v + 14})`;
    dCtx.fillRect(x, y, 2, 2);
  }
  dCtx.strokeStyle = 'rgba(18, 25, 32, 0.55)';
  dCtx.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) {
    dCtx.beginPath();
    dCtx.moveTo(x, 0);
    dCtx.lineTo(x, 512);
    dCtx.stroke();
  }
  for (let y = 0; y <= 512; y += 128) {
    dCtx.beginPath();
    dCtx.moveTo(0, y);
    dCtx.lineTo(512, y);
    dCtx.stroke();
  }

  const deckTex = new THREE.CanvasTexture(deckCanvas);
  deckTex.colorSpace = THREE.SRGBColorSpace;
  deckTex.wrapS = THREE.RepeatWrapping;
  deckTex.wrapT = THREE.RepeatWrapping;
  deckTex.repeat.set(3, 8);
  deckTex.anisotropy = maxAnisotropy;

  // 2. Hull painted steel subtle weathering
  const hullCanvas = document.createElement('canvas');
  hullCanvas.width = 256;
  hullCanvas.height = 256;
  const hCtx = hullCanvas.getContext('2d')!;
  hCtx.fillStyle = '#1b2b3a';
  hCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2400; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const alpha = Math.random() * 0.08;
    hCtx.fillStyle = Math.random() > 0.5 ? `rgba(210,225,235,${alpha})` : `rgba(8,14,20,${alpha})`;
    hCtx.fillRect(x, y, 3, 1);
  }
  const hullTex = new THREE.CanvasTexture(hullCanvas);
  hullTex.colorSpace = THREE.SRGBColorSpace;
  hullTex.wrapS = THREE.RepeatWrapping;
  hullTex.wrapT = THREE.RepeatWrapping;
  hullTex.repeat.set(6, 2);
  hullTex.anisotropy = maxAnisotropy;

  // 3. Magnetic binnacle compass rose card
  const compCanvas = document.createElement('canvas');
  compCanvas.width = 256;
  compCanvas.height = 256;
  const cCtx = compCanvas.getContext('2d')!;
  cCtx.fillStyle = '#101418';
  cCtx.fillRect(0, 0, 256, 256);
  cCtx.translate(128, 128);
  cCtx.strokeStyle = '#e5b96e';
  cCtx.lineWidth = 2;
  cCtx.beginPath();
  cCtx.arc(0, 0, 108, 0, Math.PI * 2);
  cCtx.stroke();
  for (let deg = 0; deg < 360; deg += 5) {
    const rad = (deg * Math.PI) / 180;
    const inner = deg % 30 === 0 ? 78 : deg % 15 === 0 ? 90 : 98;
    cCtx.lineWidth = deg % 30 === 0 ? 2.5 : 1.2;
    cCtx.strokeStyle = deg === 0 ? '#ff6b4a' : '#e8c484';
    cCtx.beginPath();
    cCtx.moveTo(Math.sin(rad) * inner, -Math.cos(rad) * inner);
    cCtx.lineTo(Math.sin(rad) * 106, -Math.cos(rad) * 106);
    cCtx.stroke();
  }
  cCtx.fillStyle = '#e8c484';
  cCtx.font = 'bold 20px serif';
  cCtx.textAlign = 'center';
  cCtx.textBaseline = 'middle';
  cCtx.fillText('N', 0, -56);
  cCtx.fillText('E', 56, 0);
  cCtx.fillText('S', 0, 56);
  cCtx.fillText('W', -56, 0);

  const compTex = new THREE.CanvasTexture(compCanvas);
  compTex.colorSpace = THREE.SRGBColorSpace;
  compTex.anisotropy = maxAnisotropy;

  // 4. Bridge Radar / Navigation MFD screen texture
  const radarCanvas = document.createElement('canvas');
  radarCanvas.width = 256;
  radarCanvas.height = 256;
  const rCtx = radarCanvas.getContext('2d')!;
  rCtx.fillStyle = '#071318';
  rCtx.fillRect(0, 0, 256, 256);
  rCtx.translate(128, 128);
  rCtx.strokeStyle = 'rgba(56, 189, 148, 0.35)';
  rCtx.lineWidth = 1.2;
  for (const r of [32, 64, 96, 118]) {
    rCtx.beginPath();
    rCtx.arc(0, 0, r, 0, Math.PI * 2);
    rCtx.stroke();
  }
  rCtx.beginPath();
  rCtx.moveTo(-120, 0);
  rCtx.lineTo(120, 0);
  rCtx.moveTo(0, -120);
  rCtx.lineTo(0, 120);
  rCtx.stroke();
  const sweepGrad = rCtx.createRadialGradient(0, 0, 4, 0, 0, 118);
  sweepGrad.addColorStop(0, 'rgba(56, 224, 160, 0.25)');
  sweepGrad.addColorStop(1, 'rgba(56, 224, 160, 0.04)');
  rCtx.fillStyle = sweepGrad;
  rCtx.beginPath();
  rCtx.moveTo(0, 0);
  rCtx.arc(0, 0, 118, -Math.PI * 0.68, -Math.PI * 0.38);
  rCtx.closePath();
  rCtx.fill();

  const radarTex = new THREE.CanvasTexture(radarCanvas);
  radarTex.colorSpace = THREE.SRGBColorSpace;
  radarTex.anisotropy = maxAnisotropy;

  return { deckTex, hullTex, compTex, radarTex };
}

function createHullGeometry(): THREE.BufferGeometry {
  const zStations: number[] = [];
  for (let i = 0; i <= 32; i++) {
    zStations.push(-25.5 + (i / 32) * 49.5);
  }

  const ringCount = 9;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let zi = 0; zi < zStations.length; zi++) {
    const z = zStations[zi];
    const halfB = hullHalfBeamAt(z);
    const sheerY = deckSheerYAt(z);
    const flare = z < -4 ? THREE.MathUtils.lerp(1.0, 0.72, (-4 - z) / 21.5) : 0.92;
    const chineB = halfB * flare;
    const chineY = 0.25 + (z < -15 ? ((-15 - z) / 10.5) * 0.65 : 0);
    const keelY = -2.4 + (z < -18 ? ((-18 - z) / 7.5) * 1.6 : 0);

    const pts: Array<[number, number]> = [
      [-halfB, sheerY],
      [-halfB * 0.96, sheerY * 0.55 + chineY * 0.45],
      [-chineB, chineY],
      [-chineB * 0.55, keelY * 0.72],
      [0, keelY],
      [chineB * 0.55, keelY * 0.72],
      [chineB, chineY],
      [halfB * 0.96, sheerY * 0.55 + chineY * 0.45],
      [halfB, sheerY],
    ];

    const u = zi / (zStations.length - 1);
    for (let ri = 0; ri < ringCount; ri++) {
      positions.push(pts[ri][0], pts[ri][1], z);
      uvs.push(u, ri / (ringCount - 1));
    }
  }

  for (let zi = 0; zi < zStations.length - 1; zi++) {
    for (let ri = 0; ri < ringCount - 1; ri++) {
      const a = zi * ringCount + ri;
      const b = a + ringCount;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, c, b, c, d, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createDeckGeometry(): THREE.BufferGeometry {
  const zSegs = 28;
  const xSegs = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let zi = 0; zi <= zSegs; zi++) {
    const tZ = zi / zSegs;
    const z = -25.45 + tZ * 49.4;
    const halfB = hullHalfBeamAt(z) * 0.985;
    const sheerY = deckSheerYAt(z) - 0.08;

    for (let xi = 0; xi <= xSegs; xi++) {
      const uX = (xi / xSegs) * 2 - 1;
      const x = uX * halfB;
      const camber = (1 - uX * uX) * 0.14;
      positions.push(x, sheerY + camber, z);
      uvs.push(uX * 0.5 + 0.5, tZ);
    }
  }

  const stride = xSegs + 1;
  for (let zi = 0; zi < zSegs; zi++) {
    for (let xi = 0; xi < xSegs; xi++) {
      const a = zi * stride + xi;
      const b = a + stride;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, c, b, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createBulwarkGeometry(): THREE.BufferGeometry {
  const zSegs = 26;
  const positions: number[] = [];
  const indices: number[] = [];
  const sides = [-1, 1];

  for (const side of sides) {
    const baseOffset = positions.length / 3;
    for (let zi = 0; zi <= zSegs; zi++) {
      const z = -25.4 + (zi / zSegs) * 27.5;
      const halfB = hullHalfBeamAt(z);
      const sheerY = deckSheerYAt(z);
      const wallH = z < -18 ? 0.55 : 0.42;

      const outerX = side * halfB;
      const innerX = side * Math.max(0.02, halfB - 0.14);
      positions.push(
        outerX, sheerY - 0.1, z,
        outerX, sheerY + wallH, z,
        innerX, sheerY + wallH, z,
        innerX, sheerY - 0.08, z,
      );
    }

    for (let zi = 0; zi < zSegs; zi++) {
      const r0 = baseOffset + zi * 4;
      const r1 = baseOffset + (zi + 1) * 4;
      for (let k = 0; k < 3; k++) {
        const a = r0 + k;
        const b = r1 + k;
        const c = r0 + k + 1;
        const d = r1 + k + 1;
        if (side === 1) {
          indices.push(a, c, b, c, d, b);
        } else {
          indices.push(a, b, c, c, b, d);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Constructs the ocean-going vessel with an enclosed roofed wheelhouse/bridge
 * cabin, forward-raked optical marine windshields, animated windshield wipers,
 * dark non-glare helm console, rotating wheel, telegraph, and detailed foredeck.
 */
export function buildShipModel(
  renderer: THREE.WebGLRenderer,
  _isSoftwareGl: boolean,
): ShipModelRefs {
  const root = new THREE.Group();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const { deckTex, hullTex, compTex, radarTex } = createProceduralTextures(maxAniso);

  const disposables: Array<{ dispose: () => void }> = [deckTex, hullTex, compTex, radarTex];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  // Materials
  const hullMaterial = trackMat(
    new THREE.MeshStandardMaterial({
      map: hullTex,
      color: '#203242',
      roughness: 0.48,
      metalness: 0.25,
    }),
  );

  const deckMaterial = trackMat(
    new THREE.MeshStandardMaterial({
      map: deckTex,
      color: '#4c5b69',
      roughness: 0.72,
      metalness: 0.1,
    }),
  );

  const trimWhiteMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#cdd6df',
      roughness: 0.45,
      metalness: 0.12,
    }),
  );

  const cabinExteriorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#bac6d2',
      roughness: 0.48,
      metalness: 0.18,
    }),
  );

  const cabinInteriorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#182028',
      roughness: 0.85,
      metalness: 0.12,
    }),
  );

  const frameSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#1b222b',
      roughness: 0.42,
      metalness: 0.72,
    }),
  );

  const darkSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#222b33',
      roughness: 0.45,
      metalness: 0.65,
    }),
  );

  const stainlessMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#cad4de',
      roughness: 0.22,
      metalness: 0.9,
    }),
  );

  const teakMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#6b442a',
      roughness: 0.62,
      metalness: 0.05,
    }),
  );

  const brassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#c99c4a',
      roughness: 0.2,
      metalness: 0.92,
    }),
  );

  const hazardOrangeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#b84f2b',
      roughness: 0.55,
      metalness: 0.15,
    }),
  );

  // 1. Primary Flared Hull & Foredeck & Bulwarks
  const hullMesh = new THREE.Mesh(trackGeo(createHullGeometry()), hullMaterial);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  root.add(hullMesh);

  const deckMesh = new THREE.Mesh(trackGeo(createDeckGeometry()), deckMaterial);
  deckMesh.receiveShadow = true;
  root.add(deckMesh);

  const bulwarkMesh = new THREE.Mesh(trackGeo(createBulwarkGeometry()), trimWhiteMat);
  bulwarkMesh.castShadow = true;
  bulwarkMesh.receiveShadow = true;
  root.add(bulwarkMesh);

  // 2. Foredeck Stainless Railings
  const stanchionGeo = trackGeo(new THREE.CylinderGeometry(0.026, 0.03, 0.96, 8));
  const railZSteps = 14;
  const portPts: THREE.Vector3[][] = [[], [], []];
  const stbdPts: THREE.Vector3[][] = [[], [], []];

  for (let i = 0; i <= railZSteps; i++) {
    const z = -25.25 + (i / railZSteps) * 26.8;
    const xEdge = Math.max(0.06, hullHalfBeamAt(z) - 0.1);
    const yBase = deckSheerYAt(z) + (z < -18 ? 0.52 : 0.4);

    for (const side of [-1, 1]) {
      const stanchion = new THREE.Mesh(stanchionGeo, stainlessMat);
      stanchion.position.set(side * xEdge, yBase + 0.46, z);
      stanchion.castShadow = true;
      root.add(stanchion);
    }

    const heights = [0.3, 0.6, 0.92];
    heights.forEach((h, idx) => {
      portPts[idx].push(new THREE.Vector3(-xEdge, yBase + h, z));
      stbdPts[idx].push(new THREE.Vector3(xEdge, yBase + h, z));
    });
  }

  for (let idx = 0; idx < 3; idx++) {
    const pCurve = new THREE.CatmullRomCurve3(portPts[idx]);
    const sCurve = new THREE.CatmullRomCurve3(stbdPts[idx]);
    const radius = idx === 2 ? 0.032 : 0.015;
    const mat = idx === 2 ? teakMat : stainlessMat;

    const pRail = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(pCurve, 44, radius, 8, false)), mat);
    const sRail = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(sCurve, 44, radius, 8, false)), mat);
    pRail.castShadow = true;
    sRail.castShadow = true;
    root.add(pRail, sRail);
  }

  // 3. Foredeck Cargo Hatch
  const hatchGroup = new THREE.Group();
  const hatchZ = -10.8;
  hatchGroup.position.set(0, deckSheerYAt(hatchZ) + 0.1, hatchZ);
  hatchGroup.rotation.x = 0.045;

  const hatchCoaming = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(3.8, 0.52, 4.6)),
    trimWhiteMat,
  );
  hatchCoaming.position.y = 0.26;
  hatchCoaming.castShadow = true;
  hatchCoaming.receiveShadow = true;
  hatchGroup.add(hatchCoaming);

  const hatchLid = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(4.0, 0.14, 4.8)),
    darkSteelMat,
  );
  hatchLid.position.y = 0.56;
  hatchLid.castShadow = true;
  hatchLid.receiveShadow = true;
  hatchGroup.add(hatchLid);

  const ribGeo = trackGeo(new THREE.BoxGeometry(4.04, 0.08, 0.14));
  for (let rz = -1.8; rz <= 1.81; rz += 0.9) {
    const rib = new THREE.Mesh(ribGeo, hazardOrangeMat);
    rib.position.set(0, 0.64, rz);
    hatchGroup.add(rib);
  }
  root.add(hatchGroup);

  // 4. Anchor Windlass & Chains
  const windlassGroup = new THREE.Group();
  const windlassZ = -18.2;
  windlassGroup.position.set(0, deckSheerYAt(windlassZ) + 0.12, windlassZ);

  const windlassBed = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(2.7, 0.3, 1.35)),
    darkSteelMat,
  );
  windlassBed.position.y = 0.15;
  windlassBed.castShadow = true;
  windlassGroup.add(windlassBed);

  const drumGeo = trackGeo(new THREE.CylinderGeometry(0.36, 0.36, 0.48, 16));
  drumGeo.rotateZ(Math.PI / 2);
  for (const sx of [-0.72, 0.72]) {
    const drum = new THREE.Mesh(drumGeo, darkSteelMat);
    drum.position.set(sx, 0.56, 0);
    drum.castShadow = true;
    windlassGroup.add(drum);

    const chainCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.95, 0.45, -0.3),
      new THREE.Vector3(sx * 0.9, 0.22, -1.6),
      new THREE.Vector3(sx * 0.85, 0.12, -3.1),
    ]);
    const chain = new THREE.Mesh(
      trackGeo(new THREE.TubeGeometry(chainCurve, 14, 0.065, 6, false)),
      darkSteelMat,
    );
    chain.castShadow = true;
    windlassGroup.add(chain);
  }

  const motorHousing = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.28, 0.32, 0.95, 14)),
    hazardOrangeMat,
  );
  motorHousing.rotation.z = Math.PI / 2;
  motorHousing.position.set(0, 0.56, 0.05);
  motorHousing.castShadow = true;
  windlassGroup.add(motorHousing);
  root.add(windlassGroup);

  // 5. Twin Mooring Bollards
  const bollardBaseGeo = trackGeo(new THREE.BoxGeometry(0.62, 0.08, 0.32));
  const bollardPostGeo = trackGeo(new THREE.CylinderGeometry(0.085, 0.095, 0.44, 12));
  const bollardCapGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.09, 0.06, 12));
  const bollardCoords: Array<[number, number]> = [
    [-3.15, -16.2],
    [3.15, -16.2],
    [-1.75, -21.4],
    [1.75, -21.4],
  ];
  for (const [bx, bz] of bollardCoords) {
    const bGroup = new THREE.Group();
    bGroup.position.set(bx, deckSheerYAt(bz) + 0.02, bz);
    const base = new THREE.Mesh(bollardBaseGeo, darkSteelMat);
    base.position.y = 0.04;
    bGroup.add(base);
    for (const px of [-0.16, 0.16]) {
      const post = new THREE.Mesh(bollardPostGeo, darkSteelMat);
      post.position.set(px, 0.26, 0);
      post.castShadow = true;
      const cap = new THREE.Mesh(bollardCapGeo, stainlessMat);
      cap.position.set(px, 0.5, 0);
      bGroup.add(post, cap);
    }
    root.add(bGroup);
  }

  // 6. Low Forward Jackstaff at Bow Stem
  const jackstaffZ = -24.8;
  const jackstaffY = deckSheerYAt(jackstaffZ) + 0.05;
  const jackstaff = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.032, 0.055, 1.35, 10)),
    trimWhiteMat,
  );
  jackstaff.position.set(0, jackstaffY + 0.67, jackstaffZ);
  jackstaff.castShadow = true;
  root.add(jackstaff);

  const mastLightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#fff4d6',
      emissive: '#ffd89a',
      emissiveIntensity: 1.2,
      roughness: 0.2,
    }),
  );
  const bowLight = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.06, 10, 10)), mastLightMat);
  bowLight.position.set(0, jackstaffY + 1.36, jackstaffZ);
  root.add(bowLight);

  // 7. Enclosed Ship Wheelhouse / Bridge Cabin (camera at (0, 7.05, 2.45))
  const bridgeGroup = new THREE.Group();

  // Lower deckhouse supporting structure
  const lowerHouse = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.5, 3.1, 6.2)),
    cabinExteriorMat,
  );
  lowerHouse.position.set(0, 3.82, 3.55);
  lowerHouse.castShadow = true;
  lowerHouse.receiveShadow = true;
  bridgeGroup.add(lowerHouse);

  // Wheelhouse interior deck floor (y = 5.38)
  const bridgeFloor = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.2, 0.14, 5.2)),
    cabinInteriorMat,
  );
  bridgeFloor.position.set(0, 5.38, 3.0);
  bridgeFloor.receiveShadow = true;
  bridgeGroup.add(bridgeFloor);

  // Lower front cabin bulkhead wall below windowsill (y = 5.38..6.06)
  const frontBulkhead = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.3, 0.72, 0.36)),
    cabinExteriorMat,
  );
  frontBulkhead.position.set(0, 5.72, 0.64);
  frontBulkhead.castShadow = true;
  frontBulkhead.receiveShadow = true;
  bridgeGroup.add(frontBulkhead);

  // Non-glare dark dashboard sill & helm console inside cabin
  const dashboardTop = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.0, 0.1, 0.92)),
    cabinInteriorMat,
  );
  dashboardTop.position.set(0, 6.06, 1.12);
  dashboardTop.receiveShadow = true;
  bridgeGroup.add(dashboardTop);

  const helmPedestal = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(2.4, 0.78, 0.78)),
    cabinInteriorMat,
  );
  helmPedestal.position.set(0, 5.75, 1.52);
  helmPedestal.castShadow = true;
  helmPedestal.receiveShadow = true;
  bridgeGroup.add(helmPedestal);

  // Stainless helmsman grab-bar along front edge of helm console
  const grabBar = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 2.35, 10)),
    stainlessMat,
  );
  grabBar.rotation.z = Math.PI / 2;
  grabBar.position.set(0, 6.05, 1.94);
  bridgeGroup.add(grabBar);

  // Overhead Wheelhouse Roof + Forward Sun Visor Brow (y = 7.90..8.18)
  const cabinRoof = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.8, 0.24, 5.6)),
    cabinInteriorMat,
  );
  cabinRoof.position.set(0, 7.98, 2.95);
  cabinRoof.castShadow = true;
  cabinRoof.receiveShadow = true;
  bridgeGroup.add(cabinRoof);

  // Exterior white roof cap & forward overhanging storm visor (shades windshield!)
  const roofCap = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(9.0, 0.14, 6.1)),
    trimWhiteMat,
  );
  roofCap.position.set(0, 8.15, 2.75);
  roofCap.castShadow = true;
  bridgeGroup.add(roofCap);

  const sunVisor = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.9, 0.1, 0.68)),
    frameSteelMat,
  );
  sunVisor.position.set(0, 7.92, 0.14);
  sunVisor.rotation.x = 0.24; // angled downward visor lip
  sunVisor.castShadow = true;
  bridgeGroup.add(sunVisor);

  // Interior overhead steel ceiling ribs + dark upper header beam
  const frontHeader = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.4, 0.22, 0.34)),
    frameSteelMat,
  );
  frontHeader.position.set(0, 7.82, 0.45);
  frontHeader.castShadow = true;
  bridgeGroup.add(frontHeader);

  const ceilingRibGeo = trackGeo(new THREE.BoxGeometry(8.1, 0.1, 0.14));
  for (const rz of [1.4, 2.5, 3.6]) {
    const rib = new THREE.Mesh(ceilingRibGeo, frameSteelMat);
    rib.position.set(0, 7.83, rz);
    bridgeGroup.add(rib);
  }

  // Side Cabin Walls & Framed Side Bridge Windows + Aft Bulkhead
  for (const side of [-1, 1]) {
    // Lower side wall
    const sideLower = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.24, 0.8, 5.2)),
      cabinInteriorMat,
    );
    sideLower.position.set(side * 4.18, 5.76, 3.0);
    sideLower.castShadow = true;
    bridgeGroup.add(sideLower);

    // Side upper header
    const sideUpper = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.24, 0.24, 5.2)),
      frameSteelMat,
    );
    sideUpper.position.set(side * 4.18, 7.8, 3.0);
    sideUpper.castShadow = true;
    bridgeGroup.add(sideUpper);

    // Aft side wall pillar
    const aftSideWall = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.26, 2.4, 1.9)),
      cabinInteriorMat,
    );
    aftSideWall.position.set(side * 4.18, 6.7, 4.65);
    aftSideWall.castShadow = true;
    bridgeGroup.add(aftSideWall);

    // Side window vertical mullion
    const sideMullion = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.1, 1.85, 0.1)),
      frameSteelMat,
    );
    sideMullion.position.set(side * 4.18, 6.94, 2.15);
    sideMullion.castShadow = true;
    bridgeGroup.add(sideMullion);
  }

  // Aft bulkhead closing back of wheelhouse
  const aftWall = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.5, 2.6, 0.26)),
    cabinInteriorMat,
  );
  aftWall.position.set(0, 6.72, 5.45);
  aftWall.castShadow = true;
  bridgeGroup.add(aftWall);

  // Forward-Raked Marine Windshield Mullions (3 panoramic panes: wide center + left/right wings)
  // Bottom sill at (y=6.08, z=0.72), top header at (y=7.84, z=0.42) -> rake angle ~9.7 deg forward
  const rakeTilt = Math.atan2(0.72 - 0.42, 7.84 - 6.08);
  const mullionLen = Math.hypot(0.72 - 0.42, 7.84 - 6.08) + 0.06;
  const mullionGeo = trackGeo(new THREE.BoxGeometry(0.085, mullionLen, 0.11));

  for (const mx of [-4.08, -1.78, 1.78, 4.08]) {
    const mullion = new THREE.Mesh(mullionGeo, frameSteelMat);
    mullion.position.set(mx, (6.08 + 7.84) * 0.5, (0.72 + 0.42) * 0.5);
    mullion.rotation.x = rakeTilt;
    mullion.castShadow = true;
    bridgeGroup.add(mullion);
  }

  // Clear Optical Marine Windshield Glass Shader (no milky transmission blur!)
  const windshieldMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: WINDSHIELD_VERTEX_SHADER,
      fragmentShader: WINDSHIELD_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uRainIntensity: { value: 0 },
        uWiperSweep: { value: 0 },
        uFlashIntensity: { value: 0 },
        uSkyTint: { value: new THREE.Color('#7aa2c4') },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  const frontGlass = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(8.1, mullionLen - 0.04)),
    windshieldMat,
  );
  frontGlass.position.set(0, (6.08 + 7.84) * 0.5, (0.72 + 0.42) * 0.5);
  frontGlass.rotation.x = rakeTilt;
  frontGlass.renderOrder = 15;
  bridgeGroup.add(frontGlass);

  // Twin Automotive-Style Bottom-Mounted Windshield Wipers
  // Parked flat along the bottom sill so the viewport stays 100% clear when off.
  const createWiper = (mountX: number, initialParkRotZ: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(mountX, 6.09, 0.7);
    pivot.rotation.x = rakeTilt;

    const arm = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.02, 0.72, 0.018)),
      frameSteelMat,
    );
    arm.position.y = 0.36;

    const blade = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.018, 0.64, 0.024)),
      darkSteelMat,
    );
    blade.position.y = 0.86;

    const wiperAssembly = new THREE.Group();
    wiperAssembly.rotation.z = initialParkRotZ;
    wiperAssembly.add(arm, blade);
    pivot.add(wiperAssembly);
    bridgeGroup.add(pivot);
    return wiperAssembly;
  };
  const wiperLeft = createWiper(-1.58, -1.53);
  const wiperRight = createWiper(1.58, 1.53);

  // Port & Starboard Navigation Lights on exterior bridge wings
  const portLightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#ff3b30',
      emissive: '#ff2d20',
      emissiveIntensity: 1.6,
      roughness: 0.2,
    }),
  );
  const stbdLightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#2cd452',
      emissive: '#1ec845',
      emissiveIntensity: 1.6,
      roughness: 0.2,
    }),
  );
  const navBoxGeo = trackGeo(new THREE.BoxGeometry(0.28, 0.34, 0.34));
  const navLensGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 10));

  const portHousing = new THREE.Mesh(navBoxGeo, darkSteelMat);
  portHousing.position.set(-4.42, 6.22, 0.92);
  const portLens = new THREE.Mesh(navLensGeo, portLightMat);
  portLens.position.set(-4.42, 6.22, 0.84);
  bridgeGroup.add(portHousing, portLens);

  const stbdHousing = new THREE.Mesh(navBoxGeo, darkSteelMat);
  stbdHousing.position.set(4.42, 6.22, 0.92);
  const stbdLens = new THREE.Mesh(navLensGeo, stbdLightMat);
  stbdLens.position.set(4.42, 6.22, 0.84);
  bridgeGroup.add(stbdHousing, stbdLens);

  // 8. Detailed Brass & Mahogany Helm Wheel
  const helmWheel = new THREE.Group();
  helmWheel.position.set(0, 6.16, 1.88);
  helmWheel.rotation.x = -0.36;

  const wheelRim = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.36, 0.026, 12, 36)),
    teakMat,
  );
  const brassRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.31, 0.011, 10, 32)),
    brassMat,
  );
  const wheelHub = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.07, 0.08, 0.13, 16)),
    brassMat,
  );
  wheelHub.rotation.x = Math.PI / 2;
  helmWheel.add(wheelRim, brassRing, wheelHub);

  const spokeGeo = trackGeo(new THREE.CylinderGeometry(0.013, 0.017, 0.42, 8));
  const handleGeo = trackGeo(new THREE.CylinderGeometry(0.015, 0.019, 0.1, 8));
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, brassMat);
    spoke.position.set(Math.cos(angle) * 0.21, Math.sin(angle) * 0.21, 0);
    spoke.rotation.z = angle - Math.PI / 2;
    helmWheel.add(spoke);

    const handle = new THREE.Mesh(handleGeo, teakMat);
    handle.position.set(Math.cos(angle) * 0.39, Math.sin(angle) * 0.39, 0);
    handle.rotation.z = angle - Math.PI / 2;
    helmWheel.add(handle);
  }
  bridgeGroup.add(helmWheel);

  // 9. Binnacle Magnetic Compass (on console forward of wheel)
  const binnacle = new THREE.Group();
  binnacle.position.set(0, 6.08, 1.32);

  const binnacleStand = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.11, 0.14, 0.24, 16)),
    brassMat,
  );
  binnacleStand.position.y = 0.12;
  binnacle.add(binnacleStand);

  const compassGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: compTex,
      emissiveMap: compTex,
      emissive: '#ffaa44',
      emissiveIntensity: 0.75,
      roughness: 0.35,
    }),
  );
  const compassCard = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.105, 0.105, 0.02, 20)),
    compassGlowMat,
  );
  compassCard.position.y = 0.24;
  binnacle.add(compassCard);

  const compassHood = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52)),
    brassMat,
  );
  compassHood.position.y = 0.24;
  compassHood.rotation.x = -0.35;
  binnacle.add(compassHood);
  bridgeGroup.add(binnacle);

  // 10. Recessed Marine Radar MFD Panel (port side of helm console)
  const radarBezel = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.46, 0.32, 0.08)),
    frameSteelMat,
  );
  radarBezel.position.set(-0.68, 6.24, 1.32);
  radarBezel.rotation.x = -0.58;
  bridgeGroup.add(radarBezel);

  const radarScreenMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: radarTex,
      emissiveMap: radarTex,
      emissive: '#5ae6b0',
      emissiveIntensity: 0.65,
      roughness: 0.25,
    }),
  );
  const radarScreen = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(0.39, 0.26)),
    radarScreenMat,
  );
  radarScreen.position.set(-0.68, 6.265, 1.358);
  radarScreen.rotation.x = -0.58;
  bridgeGroup.add(radarScreen);

  // 11. Engine Order Telegraph Lever (starboard side of helm console)
  const telegraphStand = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.07, 0.1, 0.32, 14)),
    brassMat,
  );
  telegraphStand.position.set(0.68, 6.14, 1.62);
  bridgeGroup.add(telegraphStand);

  const telegraphDial = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.12, 0.12, 0.055, 18)),
    brassMat,
  );
  telegraphDial.rotation.z = Math.PI / 2;
  telegraphDial.position.set(0.68, 6.32, 1.62);
  bridgeGroup.add(telegraphDial);

  const telegraphLever = new THREE.Group();
  telegraphLever.position.set(0.68, 6.32, 1.62);
  const leverArm = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.011, 0.015, 0.22, 8)),
    stainlessMat,
  );
  leverArm.position.y = 0.11;
  const leverGrip = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 10)),
    teakMat,
  );
  leverGrip.rotation.z = Math.PI / 2;
  leverGrip.position.set(0.04, 0.22, 0);
  telegraphLever.add(leverArm, leverGrip);
  bridgeGroup.add(telegraphLever);

  const interiorLight = new THREE.PointLight('#ffd69c', 0.8, 5.2, 2);
  interiorLight.position.set(0, 7.62, 1.85);
  bridgeGroup.add(interiorLight);

  root.add(bridgeGroup);

  return {
    root,
    helmWheel,
    telegraphLever,
    wiperLeft,
    wiperRight,
    windshieldMat,
    deckMaterial,
    hullMaterial,
    compassGlowMat,
    portLightMat,
    stbdLightMat,
    mastLightMat,
    dispose: () => {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
