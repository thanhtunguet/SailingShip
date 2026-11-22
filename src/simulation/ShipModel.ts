import * as THREE from 'three';

export interface ShipModelRefs {
  root: THREE.Group;
  helmWheel: THREE.Group;
  telegraphLever: THREE.Group;
  deckMaterial: THREE.MeshStandardMaterial;
  hullMaterial: THREE.MeshStandardMaterial;
  compassGlowMat: THREE.MeshStandardMaterial;
  portLightMat: THREE.MeshStandardMaterial;
  stbdLightMat: THREE.MeshStandardMaterial;
  mastLightMat: THREE.MeshStandardMaterial;
  dispose: () => void;
}

/**
 * Computes the vessel's beam half-width and deck sheer elevation at local z.
 * Local coordinates: bow tip at z = -25.5, stern at z = +24.0, center at z = 0.
 */
function hullHalfBeamAt(z: number): number {
  if (z <= -25.5) return 0.04;
  if (z < -2.0) {
    // Graceful parabolic/cubic bow curve from z=-25.5 to midships z=-2
    const t = (z + 25.5) / 23.5;
    return 0.06 + 4.84 * Math.pow(t, 0.58);
  }
  if (z <= 12.0) {
    return 4.9;
  }
  // Slight transom taper toward stern
  const t = (z - 12.0) / 12.0;
  return 4.9 - 1.15 * t * t;
}

function deckSheerYAt(z: number): number {
  // Subtle maritime sheer: lowest near midships-aft (2.35m), rising cleanly to 3.85m at bow stem
  const norm = THREE.MathUtils.clamp((2.0 - z) / 27.5, 0, 1);
  return 2.35 + 1.5 * Math.pow(norm, 1.85);
}

/**
 * Generates procedural PBR CanvasTextures (deck planking/plates, weathered marine steel, compass rose).
 */
function createProceduralTextures(maxAnisotropy: number) {
  // 1. Foredeck non-slip marine plank/plate albedo + bump
  const deckCanvas = document.createElement('canvas');
  deckCanvas.width = 512;
  deckCanvas.height = 512;
  const dCtx = deckCanvas.getContext('2d')!;
  dCtx.fillStyle = '#33414d';
  dCtx.fillRect(0, 0, 512, 512);

  // Subtle steel plate seams & weathered grain
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

  return { deckTex, hullTex, compTex };
}

/**
 * Builds lofted flared hull geometry with sheer line, keel, and boot-top waterline.
 */
function createHullGeometry(): THREE.BufferGeometry {
  const zStations: number[] = [];
  for (let i = 0; i <= 32; i++) {
    zStations.push(-25.5 + (i / 32) * 49.5);
  }

  // Profile cross-section points from port sheer -> port chine -> keel -> stbd chine -> stbd sheer
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

/**
 * Builds curved cambered foredeck surface matching the sheer & hull planform.
 */
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
      // Subtle transverse deck camber (crown in centerline for water runoff)
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

/**
 * Builds raised gunwale bulwark ribbon around the bow/foredeck perimeter.
 */
function createBulwarkGeometry(): THREE.BufferGeometry {
  const zSegs = 26;
  const positions: number[] = [];
  const indices: number[] = [];
  const sides = [-1, 1];

  for (const side of sides) {
    const baseOffset = positions.length / 3;
    for (let zi = 0; zi <= zSegs; zi++) {
      const z = -25.4 + (zi / zSegs) * 27.5; // from stem back to bridge
      const halfB = hullHalfBeamAt(z);
      const sheerY = deckSheerYAt(z);
      const wallH = z < -18 ? 0.55 : 0.42;

      // Outer face bottom/top and inner face top/bottom
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
 * Constructs the multi-part ocean-going expedition vessel with realistic
 * foredeck, flared bow, railings, windlass, hatch, and first-person helm station.
 */
export function buildShipModel(
  renderer: THREE.WebGLRenderer,
  isSoftwareGl: boolean,
): ShipModelRefs {
  const root = new THREE.Group();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const { deckTex, hullTex, compTex } = createProceduralTextures(maxAniso);

  const disposables: Array<{ dispose: () => void }> = [deckTex, hullTex, compTex];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  // Materials with calibrated roughness/metalness contrast
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
      color: '#d4dce3',
      roughness: 0.42,
      metalness: 0.12,
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

  // 1. Primary Flared Hull & Deck & Bulwarks
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

  // 2. Foredeck Stainless Railings (3 horizontal lifelines + stanchions along both sides)
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

  // 3. Foredeck Cargo/Equipment Hatch Coaming & Ribs
  const hatchGroup = new THREE.Group();
  const hatchZ = -10.8;
  const hatchY = deckSheerYAt(hatchZ) + 0.1;
  hatchGroup.position.set(0, hatchY, hatchZ);
  hatchGroup.rotation.x = 0.045; // follows sheer slope

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

  // 4. Anchor Windlass, Twin Chain Drums & Hawsepipe Chains
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

    // Anchor chain leading forward into deck hawsepipe
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

  // 5. Twin Mooring Bollards (port & starboard)
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

  // 6. Low Forward Jackstaff at Bow Stem (frames prow without blocking horizon!)
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

  // 7. Bridge Superstructure Bulkhead & Forward Helm Station (camera at (0, 6.95, 2.6))
  const bridgeGroup = new THREE.Group();

  // Lower bridge house supporting deck
  const bridgeHouse = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.6, 3.6, 7.2)),
    trimWhiteMat,
  );
  bridgeHouse.position.set(0, 4.1, 4.2);
  bridgeHouse.castShadow = true;
  bridgeHouse.receiveShadow = true;
  bridgeGroup.add(bridgeHouse);

  // Bridge wing decks & low forward console coaming (keeps central view 100% open!)
  const helmConsole = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(2.3, 1.15, 0.85)),
    darkSteelMat,
  );
  helmConsole.position.set(0, 5.42, 1.68);
  helmConsole.rotation.x = -0.14;
  helmConsole.castShadow = true;
  helmConsole.receiveShadow = true;
  bridgeGroup.add(helmConsole);

  // Low sloped bridge windshield coaming & side mullions (peripheral only)
  const frontCoaming = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.8, 0.55, 0.22)),
    trimWhiteMat,
  );
  frontCoaming.position.set(0, 5.85, 0.72);
  frontCoaming.castShadow = true;
  bridgeGroup.add(frontCoaming);

  // Subtle low wind-deflector glass along bridge top (below camera eye-line y=6.95)
  const windScreenMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: '#cbe0ec',
      roughness: 0.08,
      metalness: 0.05,
      transmission: isSoftwareGl ? 0 : 0.86,
      transparent: true,
      opacity: isSoftwareGl ? 0.25 : 1.0,
      ior: 1.5,
      depthWrite: false,
    }),
  );
  const windScreen = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(8.6, 0.42, 0.04)),
    windScreenMat,
  );
  windScreen.position.set(0, 6.28, 0.78);
  windScreen.rotation.x = -0.26;
  windScreen.renderOrder = 5;
  bridgeGroup.add(windScreen);

  // Peripheral wing stanchions & handrails on far left/right (x = ±4.2)
  for (const side of [-1, 1]) {
    const wingPost = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.045, 0.055, 1.55, 10)),
      trimWhiteMat,
    );
    wingPost.position.set(side * 4.25, 6.55, 0.82);
    wingPost.rotation.x = -0.2;
    wingPost.castShadow = true;
    bridgeGroup.add(wingPost);

    const wingRail = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.035, 0.035, 4.2, 8)),
      teakMat,
    );
    wingRail.rotation.x = Math.PI / 2;
    wingRail.position.set(side * 4.25, 6.32, 2.8);
    bridgeGroup.add(wingRail);
  }

  // Port (Red) & Starboard (Green) Navigation Lights on bridge wings
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
  portHousing.position.set(-4.38, 6.18, 0.88);
  const portLens = new THREE.Mesh(navLensGeo, portLightMat);
  portLens.position.set(-4.38, 6.18, 0.8);
  bridgeGroup.add(portHousing, portLens);

  const stbdHousing = new THREE.Mesh(navBoxGeo, darkSteelMat);
  stbdHousing.position.set(4.38, 6.18, 0.88);
  const stbdLens = new THREE.Mesh(navLensGeo, stbdLightMat);
  stbdLens.position.set(4.38, 6.18, 0.8);
  bridgeGroup.add(stbdHousing, stbdLens);

  // 8. Detailed Brass & Mahogany Helm Wheel (animated on steer)
  const helmWheel = new THREE.Group();
  helmWheel.position.set(0, 6.08, 2.02);
  helmWheel.rotation.x = -0.34; // tilted ergonomically toward helmsman

  const wheelRim = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.38, 0.028, 12, 36)),
    teakMat,
  );
  const brassRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.33, 0.012, 10, 32)),
    brassMat,
  );
  const wheelHub = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.075, 0.085, 0.14, 16)),
    brassMat,
  );
  wheelHub.rotation.x = Math.PI / 2;
  helmWheel.add(wheelRim, brassRing, wheelHub);

  const spokeGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.018, 0.45, 8));
  const handleGeo = trackGeo(new THREE.CylinderGeometry(0.016, 0.02, 0.11, 8));
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, brassMat);
    spoke.position.set(Math.cos(angle) * 0.22, Math.sin(angle) * 0.22, 0);
    spoke.rotation.z = angle - Math.PI / 2;
    helmWheel.add(spoke);

    const handle = new THREE.Mesh(handleGeo, teakMat);
    handle.position.set(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 0);
    handle.rotation.z = angle - Math.PI / 2;
    helmWheel.add(handle);
  }
  bridgeGroup.add(helmWheel);

  // 9. Binnacle Magnetic Compass (forward of wheel)
  const binnacle = new THREE.Group();
  binnacle.position.set(0, 5.95, 1.48);

  const binnacleStand = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.11, 0.15, 0.42, 16)),
    brassMat,
  );
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
  compassCard.position.y = 0.21;
  binnacle.add(compassCard);

  const compassHood = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.125, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52)),
    brassMat,
  );
  compassHood.position.y = 0.21;
  compassHood.rotation.x = -0.35;
  binnacle.add(compassHood);
  bridgeGroup.add(binnacle);

  // 10. Engine Order Telegraph Lever (tilts forward/back with throttle)
  const telegraphStand = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.075, 0.11, 0.48, 14)),
    brassMat,
  );
  telegraphStand.position.set(0.68, 5.88, 1.78);
  bridgeGroup.add(telegraphStand);

  const telegraphDial = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 18)),
    brassMat,
  );
  telegraphDial.rotation.z = Math.PI / 2;
  telegraphDial.position.set(0.68, 6.14, 1.78);
  bridgeGroup.add(telegraphDial);

  const telegraphLever = new THREE.Group();
  telegraphLever.position.set(0.68, 6.14, 1.78);
  const leverArm = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.012, 0.016, 0.24, 8)),
    stainlessMat,
  );
  leverArm.position.y = 0.12;
  const leverGrip = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.11, 10)),
    teakMat,
  );
  leverGrip.rotation.z = Math.PI / 2;
  leverGrip.position.set(0.04, 0.24, 0);
  telegraphLever.add(leverArm, leverGrip);
  bridgeGroup.add(telegraphLever);

  root.add(bridgeGroup);

  return {
    root,
    helmWheel,
    telegraphLever,
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
