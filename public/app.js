import * as THREE from 'three';

// ============================================================================
// GLOBAL STATE, CAMERA & GAME SELECTION STATE
// ============================================================================
let currentWorkspaceId = 'tiberius-hq';
let appState = null;
let selectedActorId = null;
let hoveredActorId = null;
let hoveredZoneId = null;

// Single-at-a-time transient speech bark (prevents speech-bubble pileups!)
let activeBark = {
  actorId: null,
  text: '',
  until: 0
};
const lastSeenBubbleByActor = new Map();
let initialWelcomeShown = false;

// Camera Spherical / Isometric Target State for 3D Toon Diorama
const camControl = {
  target: new THREE.Vector3(-0.2, 0.55, 0.2),
  goalTarget: new THREE.Vector3(-0.2, 0.55, 0.2),
  azimuth: Math.PI / 4, // 45 deg classic isometric
  goalAzimuth: Math.PI / 4,
  elevation: 0.66,
  goalElevation: 0.66,
  zoom: 1.04,
  goalZoom: 1.04,
  isDragging: false,
  pointerDownX: 0,
  pointerDownY: 0,
  lastX: 0,
  lastY: 0,
  dragMoved: false
};

// Exact Chair Seat Coordinates (supports both local SQLite & Vercel /api/office zone names!)
const DESK_SEAT_CONFIG = {
  executive_desk:  { seatX: -6.06, seatZ: -2.31, homeX: -5.6, homeZ: -2.2, rotY: 0.35, canSit: true },
  executive_suite: { seatX: -6.06, seatZ: -2.31, homeX: -5.6, homeZ: -2.2, rotY: 0.35, canSit: true },
  chief_of_staff:  { seatX: -2.41, seatZ: 1.65,  homeX: -2.2, homeZ: 1.6,  rotY: 0.28, canSit: true },
  bullpen_scout:   { seatX: 2.39,  seatZ: 2.05,  homeX: 1.8,  homeZ: 1.2,  rotY: 0.28, canSit: true },
  bullpen_recon:   { seatX: 2.39,  seatZ: 2.05,  homeX: 1.8,  homeZ: 1.2,  rotY: 0.28, canSit: true },
  bullpen_chloe:   { seatX: 5.19,  seatZ: 2.05,  homeX: 4.4,  homeZ: 1.2,  rotY: 0.28, canSit: true },
  bullpen_copy:    { seatX: 5.19,  seatZ: 2.05,  homeX: 4.4,  homeZ: 1.2,  rotY: 0.28, canSit: true },
  bullpen_devon:   { seatX: 3.79,  seatZ: 4.55,  homeX: 3.1,  homeZ: 3.4,  rotY: 0.28, canSit: true },
  bullpen_qa:      { seatX: 3.79,  seatZ: 4.55,  homeX: 3.1,  homeZ: 3.4,  rotY: 0.28, canSit: true },
  war_room:        { seatX: 5.15,  seatZ: -4.28, homeX: 5.15, homeZ: -4.28, rotY: 0.22, canSit: true }
};

// ============================================================================
// 1. CEL-SHADED TOON MATERIAL & CANVAS TEXTURE HELPERS
// ============================================================================
const stageEl = document.getElementById('office-stage');
const threeCanvas = document.getElementById('three-canvas');
const labelsLayer = document.getElementById('floating-labels-layer');

const scene = new THREE.Scene();

const frustumSize = 16.2;
const initAspect = Math.max(1, stageEl.clientWidth) / Math.max(1, stageEl.clientHeight);
const camera = new THREE.OrthographicCamera(
  (-frustumSize * initAspect) / 2,
  (frustumSize * initAspect) / 2,
  frustumSize / 2,
  -frustumSize / 2,
  0.1,
  140
);

const renderer = new THREE.WebGLRenderer({
  canvas: threeCanvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stageEl.clientWidth, stageEl.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// 4-Step Toon Ramp Texture for cohesive Two-Point-style Cel Shading
function createToonGradientMap() {
  const steps = [125, 175, 222, 255];
  const data = new Uint8Array(steps.length * 4);
  for (let i = 0; i < steps.length; i++) {
    const v = steps[i];
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const TOON_GRADIENT = createToonGradientMap();

function toonMat(hexOrColor, extra = {}) {
  return new THREE.MeshToonMaterial({
    color: hexOrColor,
    gradientMap: TOON_GRADIENT,
    ...extra
  });
}

// Warm Sunny Playable Diorama Lighting Rig
const ambientLight = new THREE.AmbientLight(0xfffbeb, 0.72);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xfff8eb, 0x334155, 0.85);
hemiLight.position.set(0, 22, 0);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff3d6, 1.55);
sunLight.position.set(-13, 23, 12);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 65;
const shadowBound = 14.5;
sunLight.shadow.camera.left = -shadowBound;
sunLight.shadow.camera.right = shadowBound;
sunLight.shadow.camera.top = shadowBound;
sunLight.shadow.camera.bottom = -shadowBound;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight(0xbae6fd, 0.48);
rimLight.position.set(14, 14, -12);
scene.add(rimLight);

const vaultPointLight = new THREE.PointLight(0x38bdf8, 1.35, 7.5);
vaultPointLight.position.set(-0.2, 2.2, -4.0);
scene.add(vaultPointLight);

const bossWarmLight = new THREE.PointLight(0xfbbf24, 0.9, 6.5);
bossWarmLight.position.set(-5.8, 2.4, -1.8);
scene.add(bossWarmLight);

// Dynamic Scene Collections
const actorMeshes = new Map();       // actorId -> THREE.Group
const interactiveHitMeshes = [];     // Raycastable room/prop hitboxes + actors
const pendingFolderMeshes = [];
const serverLedMeshes = [];
const waterBubbleMeshes = [];
let bossDeskHalo = null;

// ============================================================================
// 2. PROCEDURAL TOON TEXTURES (FLOORS, WALL SIGNS & MONITOR SCREENS)
// ============================================================================
function createWarmHoneyWoodTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d7a46c';
  ctx.fillRect(0, 0, 512, 512);

  const planks = 12;
  const plankH = 512 / planks;
  const palette = ['#dba972', '#cf9b63', '#e0b17b', '#c9935b'];
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = palette[i % palette.length];
    ctx.fillRect(0, i * plankH, 512, plankH - 3);
    // Soft cartoon plank seam
    ctx.fillStyle = 'rgba(92, 52, 20, 0.22)';
    ctx.fillRect(0, (i + 1) * plankH - 3, 512, 3);
    const jointX = ((i * 157) % 420) + 45;
    ctx.fillRect(jointX, i * plankH, 3, plankH);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.5, 3.5);
  return tex;
}

function createSkyWindowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#60a5fa');
  grad.addColorStop(0.58, '#93c5fd');
  grad.addColorStop(1, '#e0f2fe');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  // Soft warm sun glow in corner
  ctx.fillStyle = 'rgba(254, 243, 199, 0.72)';
  ctx.beginPath();
  ctx.arc(54, 52, 26, 0, Math.PI * 2);
  ctx.fill();

  // Puffy white cartoon clouds
  const drawCloud = (cx, cy, s) => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, 22 * s, 0, Math.PI * 2);
    ctx.arc(cx + 22 * s, cy - 8 * s, 26 * s, 0, Math.PI * 2);
    ctx.arc(cx + 48 * s, cy, 20 * s, 0, Math.PI * 2);
    ctx.roundRect(cx - 18 * s, cy, 84 * s, 20 * s, 10 * s);
    ctx.fill();
  };
  drawCloud(48, 128, 0.95);
  drawCloud(152, 86, 0.78);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCartoonSignTexture(title, bgHex = '#1e293b', borderHex = '#fbbf24', textHex = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);

  // Chunky rounded plaque
  ctx.fillStyle = bgHex;
  ctx.beginPath();
  ctx.roundRect(8, 12, 496, 104, 30);
  ctx.fill();

  ctx.lineWidth = 9;
  ctx.strokeStyle = borderHex;
  ctx.stroke();

  ctx.fillStyle = textHex;
  ctx.font = '800 46px "Fredoka", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 66);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createMonitorScreenTexture(theme = 'boss') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 256, 160);

  // Top window bar
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 256, 24);
  ['#ef4444', '#fbbf24', '#22c55e'].forEach((col, idx) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(16 + idx * 14, 12, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });

  if (theme === 'boss') {
    ctx.fillStyle = '#10b981';
    ctx.fillRect(18, 38, 105, 44);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(133, 38, 105, 44);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(18, 94, 220, 18);
    ctx.fillStyle = '#334155';
    ctx.fillRect(18, 122, 160, 16);
  } else if (theme === 'audit') {
    // Rising green bars
    const heights = [36, 58, 48, 82, 96];
    heights.forEach((h, i) => {
      ctx.fillStyle = i === 4 ? '#34d399' : '#10b981';
      ctx.fillRect(24 + i * 42, 138 - h, 28, h);
    });
  } else if (theme === 'outreach') {
    // Chat bubbles
    ctx.fillStyle = '#8b5cf6';
    ctx.beginPath(); ctx.roundRect(18, 36, 150, 26, 10); ctx.fill();
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath(); ctx.roundRect(86, 72, 150, 26, 10); ctx.fill();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.roundRect(18, 108, 120, 26, 10); ctx.fill();
  } else {
    // QA / Code lines
    const colors = ['#38bdf8', '#a7f3d0', '#fbbf24', '#c084fc', '#34d399'];
    for (let r = 0; r < 5; r++) {
      ctx.fillStyle = colors[r];
      ctx.fillRect(20, 36 + r * 22, 90 + ((r * 37) % 110), 12);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================================
// 3. CHUNKY TOON DIORAMA OFFICE SCENE (MATCHING CHARACTER ART STYLE!)
// ============================================================================
function buildToonOfficeDiorama() {
  const officeGroup = new THREE.Group();

  // 1. Chunky Diorama Plinth & Warm Honey-Oak Floor
  const lowerPlinth = new THREE.Mesh(
    new THREE.BoxGeometry(18.3, 0.52, 14.3),
    toonMat(0x1e293b)
  );
  lowerPlinth.position.set(0, -0.32, 0);
  lowerPlinth.receiveShadow = true;
  officeGroup.add(lowerPlinth);

  const woodRim = new THREE.Mesh(
    new THREE.BoxGeometry(17.7, 0.16, 13.7),
    toonMat(0x9a5b25)
  );
  woodRim.position.set(0, -0.04, 0);
  woodRim.receiveShadow = true;
  officeGroup.add(woodRim);

  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(17.2, 0.08, 13.2),
    new THREE.MeshToonMaterial({
      map: createWarmHoneyWoodTexture(),
      gradientMap: TOON_GRADIENT
    })
  );
  floorMesh.position.set(0, 0.02, 0);
  floorMesh.receiveShadow = true;
  officeGroup.add(floorMesh);

  // Helper: Chunky Rounded-Look Layered Rugs
  function addToonRug(w, d, x, z, mainHex, trimHex) {
    const border = new THREE.Mesh(new THREE.BoxGeometry(w + 0.18, 0.022, d + 0.18), toonMat(trimHex));
    border.position.set(x, 0.062, z);
    border.receiveShadow = true;
    officeGroup.add(border);

    const inner = new THREE.Mesh(new THREE.BoxGeometry(w, 0.028, d), toonMat(mainHex));
    inner.position.set(x, 0.068, z);
    inner.receiveShadow = true;
    officeGroup.add(inner);
  }

  addToonRug(4.7, 4.3, -5.7, -2.2, 0x7f1d3a, 0xfbbf24); // Boss Suite Royal Rug
  addToonRug(3.2, 2.5, -2.2, 1.9, 0x1e3a5f, 0x38bdf8);  // Chief of Staff Rug
  addToonRug(5.9, 5.1, 4.0, 3.35, 0x134e4a, 0x34d399);  // Bullpen Sage Rug
  addToonRug(2.3, 2.2, -7.0, 4.1, 0x78350f, 0xfdba74);  // Coffee Nook Mat

  // 2. Warm Oatmeal-Cream Cutaway Walls + Chunky Navy Top Caps (Classic Sims/Two-Point Cutaway!)
  const creamWallMat = toonMat(0xf5efe6);
  const wallCapMat = toonMat(0x1e293b);
  const baseboardMat = toonMat(0x854d1e);

  // Back Wall (North, z = -6.55)
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(17.5, 3.35, 0.38), creamWallMat);
  backWall.position.set(0, 1.68, -6.55);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  officeGroup.add(backWall);

  const backCap = new THREE.Mesh(new THREE.BoxGeometry(17.64, 0.18, 0.46), wallCapMat);
  backCap.position.set(0, 3.4, -6.55);
  officeGroup.add(backCap);

  const backBaseboard = new THREE.Mesh(new THREE.BoxGeometry(17.2, 0.18, 0.08), baseboardMat);
  backBaseboard.position.set(0, 0.14, -6.33);
  officeGroup.add(backBaseboard);

  // Left Wall (West, x = -8.55)
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.38, 3.35, 13.5), creamWallMat);
  leftWall.position.set(-8.55, 1.68, 0);
  leftWall.castShadow = true;
  leftWall.receiveShadow = true;
  officeGroup.add(leftWall);

  const leftCap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 13.64), wallCapMat);
  leftCap.position.set(-8.55, 3.4, 0);
  officeGroup.add(leftCap);

  const leftBaseboard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 13.2), baseboardMat);
  leftBaseboard.position.set(-8.33, 0.14, 0);
  officeGroup.add(leftBaseboard);

  // Warm Wood-Slat Accent Panel behind Boss Suite (North-West back wall)
  for (let s = 0; s < 11; s++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.95, 0.09), toonMat(s % 2 === 0 ? 0x9a5b25 : 0x7c4318));
    slat.position.set(-8.0 + s * 0.42, 1.55, -6.31);
    slat.castShadow = true;
    officeGroup.add(slat);
  }

  // 3 Sunlit Loft Windows on West Wall + Sunbeams on Floor (Offset Planes = Zero Z-Fighting!)
  const skyTex = createSkyWindowTexture();
  [-3.8, 0.2, 4.1].forEach((wz) => {
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.78, 2.18), wallCapMat);
    winFrame.position.set(-8.32, 1.85, wz);
    officeGroup.add(winFrame);

    const skyPane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.94, 1.54),
      new THREE.MeshBasicMaterial({ map: skyTex })
    );
    skyPane.rotation.y = Math.PI / 2;
    skyPane.position.set(-8.23, 1.85, wz);
    officeGroup.add(skyPane);

    // Crisp cartoon window mullions
    const mullionH = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.065, 1.96), creamWallMat);
    mullionH.position.set(-8.20, 1.85, wz);
    officeGroup.add(mullionH);

    const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.56, 0.065), creamWallMat);
    mullionV.position.set(-8.20, 1.85, wz);
    officeGroup.add(mullionV);

    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 2.3), baseboardMat);
    sill.position.set(-8.25, 0.95, wz);
    officeGroup.add(sill);

    // Soft Sunbeam Patch on Floor
    const sunPatch = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 1.85),
      new THREE.MeshBasicMaterial({ color: 0xfffbeb, transparent: true, opacity: 0.14 })
    );
    sunPatch.rotation.x = -Math.PI / 2;
    sunPatch.position.set(-7.1, 0.075, wz + 0.25);
    officeGroup.add(sunPatch);
  });

  // Helper: Mounted 3D Wall/Header Sign Plaque (Replaces Floating DOM Text Banners!)
  function addMountedSignPlaque(text, x, y, z, rotY, bgHex, borderHex) {
    const tex = createCartoonSignTexture(text, bgHex, borderHex);
    const signBoard = new THREE.Mesh(
      new THREE.PlaneGeometry(2.74, 0.68),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    signBoard.position.set(x, y, z);
    signBoard.rotation.y = rotY;
    officeGroup.add(signBoard);
  }

  addMountedSignPlaque('👑 BOSS SUITE', -5.8, 2.72, -6.24, 0, '#4c0519', '#fbbf24');
  addMountedSignPlaque('🗄️ SOP VAULT', -0.2, 2.75, -1.92, 0, '#0f172a', '#38bdf8');
  addMountedSignPlaque('📊 WAR ROOM', 5.3, 2.75, -0.72, 0, '#1e1b4b', '#a855f7');

  // Helper: Lush Chunky Toon Potted Plants!
  function addToonPlant(x, z, scale = 1.0) {
    const p = new THREE.Group();
    p.position.set(x, 0.06, z);
    p.scale.setScalar(scale);

    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.21, 0.42, 14), toonMat(0xd97706));
    pot.position.y = 0.21;
    pot.castShadow = true;
    p.add(pot);

    const potRim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 14), toonMat(0xb45309));
    potRim.position.y = 0.40;
    p.add(potRim);

    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 12), toonMat(0x451a03));
    soil.position.y = 0.42;
    p.add(soil);

    const leafPositions = [
      [0, 0.78, 0, 0.28, 0x16a34a],
      [-0.18, 0.66, 0.14, 0.22, 0x22c55e],
      [0.19, 0.68, -0.12, 0.23, 0x15803d],
      [0.14, 0.62, 0.18, 0.20, 0x4ade80],
      [-0.15, 0.72, -0.16, 0.21, 0x16a34a]
    ];
    leafPositions.forEach(([lx, ly, lz, r, col]) => {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), toonMat(col));
      leaf.scale.set(1.1, 0.85, 1.1);
      leaf.position.set(lx, ly, lz);
      leaf.castShadow = true;
      p.add(leaf);
    });

    officeGroup.add(p);
  }

  addToonPlant(-7.8, -5.6, 1.18);
  addToonPlant(-3.55, -5.7, 0.95);
  addToonPlant(7.75, -5.6, 1.1);
  addToonPlant(7.6, 5.5, 1.12);
  addToonPlant(-7.8, 2.6, 1.0);

  // 3. Glass Partitions with Chunky Cartoon Frames
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbae6fd,
    transparent: true,
    opacity: 0.22,
    roughness: 0.1
  });

  function addFramedGlassWall(w, h, x, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;

    const pane = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), glassMat);
    pane.position.y = h / 2 + 0.06;
    g.add(pane);

    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.14, 0.16), wallCapMat);
    topBeam.position.y = h + 0.08;
    g.add(topBeam);

    const botBeam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.1, 0.14), wallCapMat);
    botBeam.position.y = 0.1;
    g.add(botBeam);

    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.14, h + 0.1, 0.16), wallCapMat);
    postL.position.set(-w / 2, h / 2 + 0.08, 0);
    g.add(postL);

    const postR = new THREE.Mesh(new THREE.BoxGeometry(0.14, h + 0.1, 0.16), wallCapMat);
    postR.position.set(w / 2, h / 2 + 0.08, 0);
    g.add(postR);

    officeGroup.add(g);
  }

  // Boss Suite Divider, Vault Glass, War Room Glass
  addFramedGlassWall(4.4, 2.55, -3.1, -4.2, Math.PI / 2);
  addFramedGlassWall(5.2, 2.6, -0.2, -2.0, 0);
  addFramedGlassWall(4.4, 2.6, 2.4, -4.2, Math.PI / 2);
  addFramedGlassWall(5.6, 2.6, 5.3, -0.8, 0);

  // 4. SHARED MEMORY & SOP VAULT (Chunky Toon Server Racks + Colorful Dossier Cabinets)
  for (let i = 0; i < 3; i++) {
    const rx = -2.0 + i * 1.15;
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.22, 0.86), toonMat(0x1e293b));
    rack.position.set(rx, 1.16, -5.55);
    rack.castShadow = true;
    officeGroup.add(rack);

    const rackCap = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 0.92), toonMat(0x334155));
    rackCap.position.set(rx, 2.3, -5.55);
    officeGroup.add(rackCap);

    for (let row = 0; row < 5; row++) {
      const isEmerald = (i + row) % 2 === 0;
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.07, 0.05),
        new THREE.MeshBasicMaterial({ color: isEmerald ? 0x34d399 : 0x38bdf8 })
      );
      led.position.set(rx, 0.52 + row * 0.36, -5.1);
      officeGroup.add(led);
      serverLedMeshes.push(led);
    }
  }

  // Chunky Filing Cabinets with Brass Handles & Peeking Manila Dossier Tabs
  const cabColors = [0x3b82f6, 0x0ea5e9, 0x6366f1];
  for (let i = 0; i < 3; i++) {
    const cz = -5.45 + i * 1.05;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.58, 0.82), toonMat(cabColors[i]));
    cab.position.set(1.55, 0.84, cz);
    cab.castShadow = true;
    officeGroup.add(cab);

    for (let d = 0; d < 3; d++) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.24), toonMat(0xfbbf24));
      handle.position.set(1.11, 0.42 + d * 0.46, cz);
      officeGroup.add(handle);
    }

    // Peeking yellow dossier folder on top of first cabinet
    if (i === 1) {
      const topFolder = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.52), toonMat(0xfbbf24));
      topFolder.position.set(1.55, 1.66, cz);
      topFolder.rotation.y = 0.22;
      officeGroup.add(topFolder);
    }
  }

  // Vault Interactive Raycast Hitbox
  const vaultHit = new THREE.Mesh(
    new THREE.BoxGeometry(5.0, 2.5, 4.2),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  vaultHit.position.set(-0.2, 1.3, -4.2);
  vaultHit.userData = { interactiveType: 'vault', label: '🗄️ Open Shared Memory & SOP Vault' };
  officeGroup.add(vaultHit);
  interactiveHitMeshes.push(vaultHit);

  // 5. WAR ROOM (Chunky Conference Table, 6 Swivel Chairs & Cartoon Chart Screens)
  const confTop = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.16, 1.75), toonMat(0x7c4318));
  confTop.position.set(5.2, 0.78, -3.2);
  confTop.castShadow = true;
  confTop.receiveShadow = true;
  officeGroup.add(confTop);

  const confTrim = new THREE.Mesh(new THREE.BoxGeometry(3.38, 0.07, 1.83), toonMat(0xb45309));
  confTrim.position.set(5.2, 0.75, -3.2);
  officeGroup.add(confTrim);

  const confBase = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.58, 0.7, 16), wallCapMat);
  confBase.position.set(5.2, 0.4, -3.2);
  officeGroup.add(confBase);

  // Center table notepad & speakerphone puck
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 14), toonMat(0x1e293b));
  puck.position.set(5.2, 0.88, -3.2);
  officeGroup.add(puck);

  function addSwivelChair(x, z, rotY, cushionHex = 0x3b82f6, isHighBack = false) {
    const ch = new THREE.Group();
    ch.position.set(x, 0.06, z);
    ch.rotation.y = rotY;

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.05, 10), wallCapMat);
    base.position.y = 0.05;
    ch.add(base);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), wallCapMat);
    stem.position.y = 0.23;
    ch.add(stem);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.11, 0.56), toonMat(cushionHex));
    seat.position.y = 0.42;
    seat.castShadow = true;
    ch.add(seat);

    const backH = isHighBack ? 0.78 : 0.54;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.54, backH, 0.11), toonMat(cushionHex));
    back.position.set(0, 0.46 + backH / 2, -0.25);
    back.castShadow = true;
    ch.add(back);

    officeGroup.add(ch);
  }

  // Conference room chairs (Sarah's pink chair on North side facing camera!)
  addSwivelChair(3.95, -4.35, 0.15, 0x6366f1);
  addSwivelChair(5.15, -4.35, 0.22, 0xec4899);
  addSwivelChair(6.35, -4.35, -0.15, 0x6366f1);
  addSwivelChair(4.3, -2.05, Math.PI, 0x6366f1);
  addSwivelChair(6.0, -2.05, Math.PI, 0x6366f1);
  addSwivelChair(7.08, -3.2, -Math.PI / 2, 0x6366f1);

  // 3 Cartoon Analytics Wall Screens in War Room
  ['audit', 'boss', 'outreach'].forEach((theme, s) => {
    const sx = 3.55 + s * 1.62;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.92, 0.1), wallCapMat);
    frame.position.set(sx, 1.92, -6.28);
    officeGroup.add(frame);

    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(1.28, 0.78),
      new THREE.MeshBasicMaterial({ map: createMonitorScreenTexture(theme) })
    );
    scr.position.set(sx, 1.92, -6.22);
    officeGroup.add(scr);
  });

  const warRoomHit = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 2.2, 3.8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  warRoomHit.position.set(5.2, 1.1, -3.2);
  warRoomHit.userData = { interactiveType: 'warroom', label: '🤝 Toggle War Room Standup Huddle' };
  officeGroup.add(warRoomHit);
  interactiveHitMeshes.push(warRoomHit);

  // 6. COZY COFFEE & WATER COOLER NOOK (Front-Left Break Station!)
  const coffeeCounter = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.82, 0.78), toonMat(0x9a5b25));
  coffeeCounter.position.set(-7.35, 0.46, 4.3);
  coffeeCounter.castShadow = true;
  officeGroup.add(coffeeCounter);

  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.86), toonMat(0xfef3c7));
  counterTop.position.set(-7.35, 0.9, 4.3);
  officeGroup.add(counterTop);

  // Chunky Red Espresso Machine
  const espresso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.44), toonMat(0xef4444));
  espresso.position.set(-7.55, 1.18, 4.3);
  espresso.castShadow = true;
  officeGroup.add(espresso);

  // Bubbly Blue Toon Water Cooler!
  const coolerBase = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.86, 0.48), toonMat(0xf8fafc));
  coolerBase.position.set(-6.25, 0.48, 4.35);
  coolerBase.castShadow = true;
  officeGroup.add(coolerBase);

  const coolerJug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.52, 16),
    new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.68, roughness: 0.1 })
  );
  coolerJug.position.set(-6.25, 1.18, 4.35);
  officeGroup.add(coolerJug);

  for (let b = 0; b < 3; b++) {
    const bub = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xe0f2fe })
    );
    bub.position.set(-6.25 + (b - 1) * 0.05, 1.0 + b * 0.12, 4.35);
    bub.userData.baseY = 0.98;
    bub.userData.offset = b * 2.1;
    officeGroup.add(bub);
    waterBubbleMeshes.push(bub);
  }

  const coffeeHit = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 1.8, 1.5),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  coffeeHit.position.set(-6.9, 0.9, 4.3);
  coffeeHit.userData = { interactiveType: 'coffee', label: '☕ Break Nook ($0 Worker Fuel!)' };
  officeGroup.add(coffeeHit);
  interactiveHitMeshes.push(coffeeHit);

  // 7. TOON WORKSTATIONS & BOSS EXECUTIVE SUITE
  function buildToonDeskStation({ x, z, rotY = 0, isExecutive = false, chairColor = 0x2563eb, screenTheme = 'code' }) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;

    const w = isExecutive ? 2.55 : 1.82;
    const d = isExecutive ? 1.22 : 0.96;

    // Chunky Desktop + Warm Trim
    const deskTop = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.13, d),
      toonMat(isExecutive ? 0x6b3410 : 0xb4763c)
    );
    deskTop.position.y = 0.78;
    deskTop.castShadow = true;
    deskTop.receiveShadow = true;
    g.add(deskTop);

    const deskLip = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.06, 0.05, d + 0.06),
      toonMat(isExecutive ? 0x92400e : 0xd99b5e)
    );
    deskLip.position.y = 0.75;
    g.add(deskLip);

    // Chunky Legs
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.74, d - 0.14), wallCapMat);
    legL.position.set(-w / 2 + 0.14, 0.38, 0);
    legL.castShadow = true;
    g.add(legL);

    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.74, d - 0.14), wallCapMat);
    legR.position.set(w / 2 - 0.14, 0.38, 0);
    legR.castShadow = true;
    g.add(legR);

    // Desk Mat + Keyboard
    const matMesh = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.02, 0.42), toonMat(0x1e293b));
    matMesh.position.set(0, 0.855, -0.18);
    g.add(matMesh);

    const kbMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.028, 0.16), toonMat(0xe2e8f0));
    kbMesh.position.set(0, 0.87, -0.24);
    g.add(kbMesh);

    // Angled Side-Offset Monitor so Seated Characters' Faces & Typing Hands Stay 100% Unobstructed!
    const monGroup = new THREE.Group();
    monGroup.position.set(isExecutive ? -0.58 : -0.46, 0, 0.16);
    monGroup.rotation.y = -0.36;

    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.1), wallCapMat);
    stand.position.set(0, 0.93, 0);
    monGroup.add(stand);

    const monW = isExecutive ? 0.84 : 0.68;
    const monH = isExecutive ? 0.48 : 0.40;
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(monW, monH, 0.065), wallCapMat);
    monitor.position.set(0, 1.09, 0);
    monitor.castShadow = true;
    monGroup.add(monitor);

    const screenFace = new THREE.Mesh(
      new THREE.PlaneGeometry(monW - 0.08, monH - 0.08),
      new THREE.MeshBasicMaterial({ map: createMonitorScreenTexture(screenTheme) })
    );
    screenFace.position.set(0, 1.09, -0.036);
    screenFace.rotation.y = Math.PI;
    monGroup.add(screenFace);
    g.add(monGroup);

    // Ceramic Coffee Mug on opposite side of desk
    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.058, 0.13, 12),
      toonMat(isExecutive ? 0xfef3c7 : 0x38bdf8)
    );
    mug.position.set(isExecutive ? -0.18 : (w / 2 - 0.34), 0.91, -0.18);
    g.add(mug);

    // Matching Swivel Chair behind desk (-Z)
    addSwivelChair(
      x - Math.sin(rotY) * 0.76,
      z - Math.cos(rotY) * 0.76,
      rotY,
      chairColor,
      isExecutive
    );

    if (isExecutive) {
      // ICONIC CHUNKY RED SWINGLINE STAPLER!
      const staplerGroup = new THREE.Group();
      staplerGroup.position.set(-0.84, 0.86, 0.24);
      staplerGroup.rotation.y = 0.38;

      const stBase = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.12), toonMat(0x991b1b));
      const stTop = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.08, 0.11), toonMat(0xef4444));
      stTop.position.y = 0.06;
      staplerGroup.add(stBase, stTop);
      g.add(staplerGroup);

      const staplerHit = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.45, 0.45),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      staplerHit.position.copy(staplerGroup.position);
      staplerHit.userData = { interactiveType: 'stapler', label: '📎 Inspect Red Swingline Stapler' };
      g.add(staplerHit);
      interactiveHitMeshes.push(staplerHit);

      // Executive Approval In-Tray + Pulsing Halo + Dynamic Stack of Manila Folders!
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.05, 0.46), wallCapMat);
      tray.position.set(0.82, 0.86, 0.22);
      g.add(tray);

      bossDeskHalo = new THREE.Mesh(
        new THREE.RingGeometry(0.34, 0.46, 28),
        new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
      );
      bossDeskHalo.rotation.x = -Math.PI / 2;
      bossDeskHalo.position.set(0.82, 0.865, 0.22);
      g.add(bossDeskHalo);

      for (let f = 0; f < 4; f++) {
        const folder = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.048, 0.36), toonMat(0xfbbf24));
        folder.position.set(0.82, 0.91 + f * 0.055, 0.22);
        folder.rotation.y = f % 2 === 0 ? 0.09 : -0.07;
        folder.castShadow = true;
        g.add(folder);
        pendingFolderMeshes.push(folder);
      }

      // Boss Suite Credenza
      const credenza = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.76, 0.58), toonMat(0x6b3410));
      credenza.position.set(-1.65, 0.42, -1.25);
      credenza.rotation.y = Math.PI / 2;
      credenza.castShadow = true;
      g.add(credenza);

      // Boss Desk Interactive Hitbox
      const bossDeskHit = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 1.6, 1.6),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      bossDeskHit.position.set(0.15, 0.9, 0);
      bossDeskHit.userData = { interactiveType: 'boss_desk', label: '📥 Open Boss Approval Desk' };
      g.add(bossDeskHit);
      interactiveHitMeshes.push(bossDeskHit);
    }

    officeGroup.add(g);
  }

  buildToonDeskStation({ x: -5.8, z: -1.6, rotY: 0.35, isExecutive: true, chairColor: 0xdc2626, screenTheme: 'boss' });
  buildToonDeskStation({ x: -2.2, z: 2.38, rotY: 0.28, chairColor: 0x2563eb, screenTheme: 'boss' });
  buildToonDeskStation({ x: 2.6, z: 2.78, rotY: 0.28, chairColor: 0x10b981, screenTheme: 'audit' });
  buildToonDeskStation({ x: 5.4, z: 2.78, rotY: 0.28, chairColor: 0x8b5cf6, screenTheme: 'outreach' });
  buildToonDeskStation({ x: 4.0, z: 5.28, rotY: 0.28, chairColor: 0x0ea5e9, screenTheme: 'code' });

  scene.add(officeGroup);
}

buildToonOfficeDiorama();

// ============================================================================
// 4. BIG-HEADED, LIKEABLE "TWO POINT" TOON CHARACTER BUILDER & RIG
// ============================================================================
function getActorVisualProfile(actor) {
  const id = String(actor.id || '').toLowerCase();
  const handle = String(actor.handle || '').toLowerCase();

  if (id.includes('marcus') || handle === '@marcus') {
    return {
      skin: 0xa46b3f, cheek: 0xe17055, hairColor: 0x1c1917, hairStyle: 'quiff',
      outfit: 0x1d4ed8, pants: 0x1e293b, shoe: 0x0f172a,
      glasses: 'none', accessory: 'tie', tieColor: 0xfbbf24, browTilt: -0.08, emote: '📋'
    };
  }
  if (id.includes('scout') || handle === '@scout') {
    return {
      skin: 0xf6c89f, cheek: 0xfb7185, hairColor: 0x6b3e26, hairStyle: 'messy',
      outfit: 0x10b981, pants: 0x1e293b, shoe: 0x065f46,
      glasses: 'round', accessory: 'hoodie', tieColor: 0x34d399, browTilt: 0.08, emote: '🔍'
    };
  }
  if (id.includes('chloe') || handle === '@chloe' || handle === '@tess') {
    return {
      skin: 0xe4aa7d, cheek: 0xf43f5e, hairColor: 0x431407, hairStyle: 'bob',
      outfit: 0x8b5cf6, pants: 0x312e81, shoe: 0x4c1d95,
      glasses: 'none', accessory: 'headset', tieColor: 0xfdf4ff, browTilt: 0.06, emote: '✍️'
    };
  }
  if (id.includes('devon') || handle === '@devon') {
    return {
      skin: 0xf3c6a5, cheek: 0xfb7185, hairColor: 0x1e293b, hairStyle: 'beanie', hatColor: 0xf59e0b,
      outfit: 0x0284c7, pants: 0x1e293b, shoe: 0x0369a1,
      glasses: 'rect', accessory: 'hoodie', tieColor: 0x38bdf8, browTilt: 0.02, emote: '✅'
    };
  }
  if (id.includes('boss') || handle === '@boss' || handle === '@you') {
    return {
      skin: 0xebb892, cheek: 0xf43f5e, hairColor: 0x292524, hairStyle: 'exec',
      outfit: 0xb91c1c, pants: 0x1e293b, shoe: 0x1c1917,
      glasses: 'none', accessory: 'tie', tieColor: 0xfbbf24, browTilt: -0.05, emote: '👑'
    };
  }
  if (id === 'apex-cos' || handle === '@elena') {
    return {
      skin: 0xf2bf98, cheek: 0xfb7185, hairColor: 0x3b1d14, hairStyle: 'bob',
      outfit: 0x2563eb, pants: 0x1e293b, shoe: 0x0f172a,
      glasses: 'none', accessory: 'tie', tieColor: 0xfbbf24, browTilt: 0.04, emote: '📋'
    };
  }
  if (id.includes('sarah') || handle === '@sarah') {
    return {
      skin: 0xf5c4a1, cheek: 0xfb7185, hairColor: 0xb45309, hairStyle: 'ponytail',
      outfit: 0xdb2777, pants: 0x1e293b, shoe: 0x831843,
      glasses: 'none', accessory: 'collar', tieColor: 0xfce7f3, browTilt: 0.07, emote: '🗂️'
    };
  }
  if (handle === '@boone') {
    return {
      skin: 0xe5ae83, cheek: 0xfb7185, hairColor: 0x3f2e21, hairStyle: 'hardhat', hatColor: 0xfbbf24,
      outfit: 0x059669, pants: 0x1e293b, shoe: 0x451a03,
      glasses: 'none', accessory: 'tie', tieColor: 0xfde047, browTilt: 0.0, emote: '⚡'
    };
  }
  return {
    skin: 0xe8b48a, cheek: 0xfb7185, hairColor: 0x292524, hairStyle: 'quiff',
    outfit: new THREE.Color(actor.avatar_color || '#d97706').getHex(),
    pants: 0x1e293b, shoe: 0x1c1917,
    glasses: 'none', accessory: 'tie',
    tieColor: new THREE.Color(actor.accent_color || '#fbbf24').getHex(),
    browTilt: 0, emote: '💼'
  };
}

function createStylizedActorMesh(actor) {
  const root = new THREE.Group();
  const prof = getActorVisualProfile(actor);

  const skinMat = toonMat(prof.skin);
  const outfitMat = toonMat(prof.outfit);
  const pantsMat = toonMat(prof.pants);
  const shoeMat = toonMat(prof.shoe);
  const soleMat = toonMat(0xf8fafc);
  const whiteShirtMat = toonMat(0xffffff);
  const hairMat = toonMat(prof.hairColor);
  const accentMat = toonMat(prof.tieColor);

  // Body rig container (moves down cleanly when sitting!)
  const rig = new THREE.Group();
  root.add(rig);

  // 1. CHUNKY LEGS & TWO-TONE TOON SHOES
  function buildLeg(sideSign) {
    const pivot = new THREE.Group();
    pivot.position.set(sideSign * 0.13, 0.42, 0);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.22, 8, 12), pantsMat);
    leg.position.y = -0.16;
    leg.castShadow = true;
    pivot.add(leg);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.25), shoeMat);
    shoe.position.set(0, -0.34, 0.04);
    shoe.castShadow = true;
    pivot.add(shoe);

    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.265), soleMat);
    sole.position.set(0, -0.385, 0.04);
    pivot.add(sole);

    rig.add(pivot);
    return pivot;
  }

  const leftLegPivot = buildLeg(-1);
  const rightLegPivot = buildLeg(1);

  // 2. CHUNKY ROUNDED TORSO & COLLAR/TIE DETAILS
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0.68, 0);
  rig.add(torsoGroup);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.215, 0.28, 10, 16), outfitMat);
  torso.scale.set(1.06, 1.0, 0.92);
  torso.castShadow = true;
  torsoGroup.add(torso);

  // Crisp White Shirt Neckline
  const shirtV = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 4), whiteShirtMat);
  shirtV.rotation.x = Math.PI;
  shirtV.rotation.y = Math.PI / 4;
  shirtV.position.set(0, 0.14, 0.14);
  torsoGroup.add(shirtV);

  if (prof.accessory === 'tie') {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.25, 0.05), accentMat);
    tie.position.set(0, 0.03, 0.195);
    torsoGroup.add(tie);
  } else if (prof.accessory === 'hoodie') {
    const hoodRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.048, 8, 16), accentMat);
    hoodRing.rotation.x = Math.PI / 2 + 0.18;
    hoodRing.position.set(0, 0.2, -0.02);
    torsoGroup.add(hoodRing);
  }

  // 3. ARTICULATED TOON ARMS + CUTE SPHERICAL HANDS + HELD FOLDER
  function buildArm(sideSign) {
    const pivot = new THREE.Group();
    pivot.position.set(sideSign * 0.275, 0.16, 0);

    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.22, 8, 10), outfitMat);
    sleeve.position.y = -0.13;
    sleeve.castShadow = true;
    pivot.add(sleeve);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.072, 12, 10), skinMat);
    hand.position.y = -0.29;
    hand.castShadow = true;
    pivot.add(hand);

    torsoGroup.add(pivot);
    return pivot;
  }

  const leftArmPivot = buildArm(-1);
  const rightArmPivot = buildArm(1);

  // Chunky Manila Approval Folder attached to right hand!
  const folderMesh = new THREE.Group();
  const folderBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.25, 0.045), toonMat(0xfbbf24));
  const folderSeal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.055), toonMat(0xef4444));
  folderSeal.position.set(0.06, 0.03, 0);
  folderMesh.add(folderBody, folderSeal);
  folderMesh.position.set(0.05, -0.28, 0.14);
  folderMesh.rotation.y = -0.35;
  folderMesh.visible = Boolean(actor.carrying_folder);
  rightArmPivot.add(folderMesh);

  // 4. BIG EXPRESSIVE LIKEABLE TOON HEAD (Two Point / Mii / Overcooked Proportion!)
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.59, 0);
  headGroup.scale.setScalar(1.18); // Bigger-than-normal cute toon head proportion!
  torsoGroup.add(headGroup);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.315, 24, 20), skinMat);
  headMesh.scale.set(1.08, 0.98, 1.02); // Plump, friendly wide toon head!
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // Cute Rounded Toon Ears
  [-1, 1].forEach((s) => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.072, 12, 10), skinMat);
    ear.position.set(s * 0.33, -0.01, -0.01);
    headGroup.add(ear);
  });

  // Cute Button Nose Bump
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), skinMat);
  nose.scale.set(1.08, 0.9, 1.18);
  nose.position.set(0, -0.02, 0.318);
  headGroup.add(nose);

  // Soft Rosy Cheek Blush
  const blushMat = new THREE.MeshBasicMaterial({ color: prof.cheek, transparent: true, opacity: 0.34 });
  [-1, 1].forEach((s) => {
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), blushMat);
    cheek.position.set(s * 0.18, -0.062, 0.285);
    cheek.rotation.y = s * 0.38;
    headGroup.add(cheek);
  });

  // Bright Cartoon Eyes (Crisp White Sclera + Glossy Dark Pupil + Sparkle Catchlight!)
  const eyeGroups = [];
  const scleraMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  const sparkleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  [-1, 1].forEach((s) => {
    const eg = new THREE.Group();
    eg.position.set(s * 0.116, 0.036, 0.296);
    eg.rotation.y = s * 0.18;

    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 12), scleraMat);
    sclera.scale.set(1.02, 1.24, 0.36);
    eg.add(sclera);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 12), pupilMat);
    pupil.scale.set(0.96, 1.16, 0.42);
    pupil.position.set(0, -0.003, 0.013);
    eg.add(pupil);

    const sparkle = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), sparkleMat);
    sparkle.position.set(0.014, 0.02, 0.028);
    eg.add(sparkle);

    headGroup.add(eg);
    eyeGroups.push(eg);

    // Expressive Eyebrows
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.072, 4, 8), hairMat);
    brow.rotation.z = Math.PI / 2 + s * prof.browTilt;
    brow.position.set(s * 0.118, 0.132, 0.292);
    brow.rotation.y = s * 0.18;
    headGroup.add(brow);
  });

  // Friendly Little Toon Smile
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.056, 0.014, 6, 14, Math.PI * 0.85),
    new THREE.MeshBasicMaterial({ color: 0x7c2d12 })
  );
  smile.position.set(0, -0.095, 0.302);
  smile.rotation.z = Math.PI * 1.075;
  headGroup.add(smile);

  // 5. DISTINCTIVE SCULPTED HAIRSTYLES, HATS, GLASSES & HEADSETS!
  // Tilted backward (-0.56 rad) so front hairline sits cleanly ABOVE eyebrows while wrapping back of head!
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.332, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
    hairMat
  );
  hairCap.scale.set(1.08, 1.0, 1.04);
  hairCap.rotation.x = -0.56;
  hairCap.position.set(0, 0.02, -0.01);
  headGroup.add(hairCap);

  if (prof.hairStyle === 'quiff' || prof.hairStyle === 'exec') {
    const quiff = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.24, 8, 12), hairMat);
    quiff.rotation.z = Math.PI / 2 - 0.15;
    quiff.position.set(0.03, 0.29, 0.17);
    headGroup.add(quiff);
  } else if (prof.hairStyle === 'messy') {
    [[-0.1, 0.30, 0.13, 0.1], [0.08, 0.32, 0.11, 0.11], [0, 0.31, -0.05, 0.12]].forEach(([tx, ty, tz, tr]) => {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(tr, 10, 10), hairMat);
      tuft.position.set(tx, ty, tz);
      headGroup.add(tuft);
    });
  } else if (prof.hairStyle === 'bob') {
    [-1, 1].forEach((s) => {
      const sideLock = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 8, 10), hairMat);
      sideLock.position.set(s * 0.295, -0.03, 0.02);
      headGroup.add(sideLock);
    });
    const bangs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.075, 0.1), hairMat);
    bangs.position.set(0, 0.235, 0.235);
    bangs.rotation.z = -0.06;
    headGroup.add(bangs);
  } else if (prof.hairStyle === 'ponytail') {
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.098, 0.25, 8, 10), hairMat);
    tail.position.set(0, 0.06, -0.36);
    tail.rotation.x = 0.55;
    headGroup.add(tail);
  } else if (prof.hairStyle === 'beanie') {
    const hatMat = toonMat(prof.hatColor || 0xf59e0b);
    const beanieGroup = new THREE.Group();
    beanieGroup.rotation.x = -0.38;
    beanieGroup.position.set(0, 0.03, -0.01);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.342, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hatMat);
    dome.scale.set(1.08, 1.02, 1.05);
    dome.position.y = 0.03;
    beanieGroup.add(dome);

    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.052, 10, 24), hatMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.scale.set(1.08, 1.04, 1.0);
    cuff.position.set(0, 0.06, 0);
    beanieGroup.add(cuff);

    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), hatMat);
    pom.position.set(0, 0.39, 0);
    beanieGroup.add(pom);

    headGroup.add(beanieGroup);
  } else if (prof.hairStyle === 'hardhat') {
    const hatMat = toonMat(prof.hatColor || 0xfbbf24);
    const hardGroup = new THREE.Group();
    hardGroup.rotation.x = -0.22;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.35, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.48), hatMat);
    dome.position.y = 0.08;
    hardGroup.add(dome);

    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.41, 0.04, 20), hatMat);
    brim.position.set(0, 0.14, 0.03);
    hardGroup.add(brim);
    headGroup.add(hardGroup);
  }

  // Oversized Toon Glasses (Scout & Devon!)
  if (prof.glasses !== 'none') {
    const frameMat = toonMat(0x0f172a);
    [-1, 1].forEach((s) => {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.016, 8, 18), frameMat);
      rim.position.set(s * 0.118, 0.035, 0.312);
      rim.rotation.y = s * 0.14;
      headGroup.add(rim);
    });
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.02), frameMat);
    bridge.position.set(0, 0.045, 0.325);
    headGroup.add(bridge);
  }

  // Wireless Outreach Headset (Chloe!)
  if (prof.accessory === 'headset') {
    const hsMat = toonMat(0xe2e8f0);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.355, 0.02, 8, 22, Math.PI), hsMat);
    band.position.set(0, 0.03, 0);
    headGroup.add(band);

    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 14), toonMat(0xa855f7));
    cup.rotation.z = Math.PI / 2;
    cup.position.set(0.36, -0.01, 0);
    headGroup.add(cup);

    const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.16, 4, 8), hsMat);
    mic.rotation.z = Math.PI / 3;
    mic.rotation.y = -0.5;
    mic.position.set(0.26, -0.09, 0.22);
    headGroup.add(mic);
  }

  // 6. TACTILE GAME SELECTION RING + INVISIBLE RAYCAST HITBOX
  const accentHex = new THREE.Color(actor.accent_color || '#fbbf24').getHex();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.45, 28),
    new THREE.MeshBasicMaterial({ color: accentHex, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.075;
  root.add(ring);

  const hitCylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, 1.85, 12),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitCylinder.position.y = 0.92;
  hitCylinder.userData = { interactiveType: 'actor', actorId: actor.id };
  root.add(hitCylinder);
  interactiveHitMeshes.push(hitCylinder);

  // Determine initial snapped position (sit cleanly if at home station!)
  const startPos = resolveActorWorldGoal(actor);
  root.position.set(startPos.x, 0, startPos.z);
  root.rotation.y = startPos.rotY;

  root.userData = {
    actorId: actor.id,
    profile: prof,
    rig,
    torsoGroup,
    headGroup,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot,
    rightArmPivot,
    folderMesh,
    eyeGroups,
    ring,
    hitCylinder,
    targetX: startPos.x,
    targetZ: startPos.z,
    goalRotY: startPos.rotY,
    shouldSit: startPos.shouldSit,
    walkPhase: Math.random() * Math.PI * 2,
    idlePhase: Math.random() * Math.PI * 2,
    nextBlinkAt: 1.5 + Math.random() * 3.5,
    blinkEndAt: 0
  };

  scene.add(root);
  return root;
}

function resolveActorWorldGoal(actor) {
  const seat = DESK_SEAT_CONFIG[actor.desk_zone];
  const rawTx = typeof actor.target_x === 'number' ? actor.target_x : actor.x;
  const rawTz = typeof actor.target_z === 'number' ? actor.target_z : actor.z;
  const hx = typeof actor.home_x === 'number' ? actor.home_x : (seat ? seat.homeX : rawTx);
  const hz = typeof actor.home_z === 'number' ? actor.home_z : (seat ? seat.homeZ : rawTz);
  const distFromHome = Math.hypot(rawTx - hx, rawTz - hz);
  const inWarRoomHuddle = rawTx > 2.8 && rawTz < -1.0 && actor.desk_zone !== 'war_room';

  // If carrying an approval folder (and not in a War Room standup), stand politely at the front-right Boss Rug corner!
  if (actor.carrying_folder && !inWarRoomHuddle) {
    return { x: -3.95, z: -0.98, rotY: 0.58, shouldSit: false };
  }
  if (seat && seat.canSit && distFromHome < 1.35 && !actor.carrying_folder) {
    return { x: seat.seatX, z: seat.seatZ, rotY: seat.rotY, shouldSit: true };
  }
  // If gathered in the War Room huddle, face the center of the conference table
  if (rawTx > 2.8 && rawTz < -1.0) {
    return { x: rawTx, z: rawTz, rotY: Math.atan2(5.2 - rawTx, -3.2 - rawTz), shouldSit: false };
  }
  return { x: rawTx, z: rawTz, rotY: 0.55, shouldSit: false };
}

// ============================================================================
// 5. STATE SYNC, TRANSIENT BARKS & SIMS EMOTE OVERLAYS
// ============================================================================
function triggerSingleBark(actorId, text, durationMs = 4800) {
  if (!actorId || !text) return;
  const clean = String(text).length > 115 ? `${String(text).slice(0, 112).trim()}...` : String(text);
  activeBark = {
    actorId,
    text: clean,
    until: Date.now() + durationMs
  };
  if (appState) rebuildActorDomOverlays(appState);
}

function sync3DSceneWithState(state) {
  if (!state) return;

  const pendingCount = state.approvals.filter(a => a.status === 'pending').length;
  pendingFolderMeshes.forEach((mesh, idx) => {
    mesh.visible = idx < Math.max(0, pendingCount);
  });
  if (bossDeskHalo) {
    bossDeskHalo.visible = pendingCount > 0;
  }

  const activeIds = new Set(state.actors.map(a => a.id));
  for (const [id, mesh] of actorMeshes.entries()) {
    if (!activeIds.has(id)) {
      const hitIdx = interactiveHitMeshes.indexOf(mesh.userData.hitCylinder);
      if (hitIdx !== -1) interactiveHitMeshes.splice(hitIdx, 1);
      scene.remove(mesh);
      actorMeshes.delete(id);
    }
  }

  let newestChangedActor = null;

  for (const actor of state.actors) {
    let mesh = actorMeshes.get(actor.id);
    if (!mesh) {
      mesh = createStylizedActorMesh(actor);
      actorMeshes.set(actor.id, mesh);
    }
    const goal = resolveActorWorldGoal(actor);
    mesh.userData.targetX = goal.x;
    mesh.userData.targetZ = goal.z;
    mesh.userData.goalRotY = goal.rotY;
    mesh.userData.shouldSit = goal.shouldSit;
    mesh.userData.folderMesh.visible = Boolean(actor.carrying_folder);

    const prevBubble = lastSeenBubbleByActor.get(actor.id);
    if (prevBubble !== undefined && actor.speech_bubble && actor.speech_bubble !== prevBubble) {
      newestChangedActor = actor;
    }
    lastSeenBubbleByActor.set(actor.id, actor.speech_bubble || '');
  }

  // Trigger a single transient bark when an agent says something new
  if (newestChangedActor) {
    triggerSingleBark(newestChangedActor.id, newestChangedActor.speech_bubble, 5200);
  } else if (!initialWelcomeShown && state.actors.length > 0) {
    initialWelcomeShown = true;
    const cos = state.actors.find(a => a.desk_zone === 'chief_of_staff') || state.actors[0];
    setTimeout(() => {
      if (cos && pendingCount > 0) {
        triggerSingleBark(cos.id, `👋 Hey boss! ${pendingCount} approval folder${pendingCount > 1 ? 's' : ''} ready on your desk.`, 5200);
      }
    }, 900);
  }
}

const domActorEls = new Map();

function getActorEmoteBadge(actor, pendingCount) {
  const isCos = actor.desk_zone === 'chief_of_staff';
  if (isCos && pendingCount > 0) return `📋 ${pendingCount}`;
  const st = String(actor.status || '').toLowerCase();
  if (st.includes('standup') || st.includes('war room')) return '🤝';
  if (st.includes('brows')) return '👁️';
  if (st.includes('shift')) return '⚡';
  const prof = getActorVisualProfile(actor);
  return prof.emote || '💼';
}

function shortFirstName(actor) {
  if ((actor.actor_type === 'human' || actor.kind === 'human') && (actor.handle === '@boss' || actor.handle === '@you')) return 'You';
  return String(actor.name || 'Agent').split(' ')[0];
}

function rebuildActorDomOverlays(state) {
  if (!state) return;
  const activeIds = new Set(state.actors.map(a => a.id));
  for (const [id, entry] of domActorEls.entries()) {
    if (!activeIds.has(id)) {
      entry.el.remove();
      domActorEls.delete(id);
    }
  }

  const pendingApprovals = state.approvals.filter(a => a.status === 'pending');
  const topPending = pendingApprovals[0];
  const now = Date.now();
  const barkValid = activeBark.actorId && now < activeBark.until;

  // Priority: hovered character's bubble -> else transient single bark -> else NO speech bubbles!
  const bubbleOwnerId = hoveredActorId || (barkValid ? activeBark.actorId : null);

  state.actors.forEach(actor => {
    let entry = domActorEls.get(actor.id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'actor-tag';
      el.addEventListener('mouseenter', () => {
        hoveredActorId = actor.id;
        if (appState) rebuildActorDomOverlays(appState);
      });
      el.addEventListener('mouseleave', () => {
        if (hoveredActorId === actor.id) {
          hoveredActorId = null;
          if (appState) rebuildActorDomOverlays(appState);
        }
      });
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        selectActorAndInspect(actor.id);
      });
      labelsLayer.appendChild(el);
      entry = { el, actor };
      domActorEls.set(actor.id, entry);
    }
    entry.actor = actor;

    const isCosWithPending = actor.desk_zone === 'chief_of_staff' && Boolean(topPending);
    const showBubble = bubbleOwnerId === actor.id;
    const rawSpeech = (barkValid && activeBark.actorId === actor.id && !hoveredActorId)
      ? activeBark.text
      : (actor.speech_bubble || actor.status || '');
    const clippedSpeech = rawSpeech.length > 115 ? `${rawSpeech.slice(0, 112).trim()}...` : rawSpeech;

    entry.el.classList.toggle('is-selected', selectedActorId === actor.id);
    entry.el.classList.toggle('has-bark', showBubble);

    const bubbleHtml = (showBubble && clippedSpeech)
      ? `<div class="actor-speech-bubble ${isCosWithPending ? 'approval-ready' : ''}">
          <div>${escapeHtml(clippedSpeech)}</div>
          ${isCosWithPending ? `
            <div class="bubble-quick-actions">
              <button class="bubble-btn" type="button" data-quick-approve="${escapeHtml(topPending.id)}">✓ Approve ${escapeHtml(topPending.code)}</button>
              <button class="bubble-btn-secondary" type="button" data-open-desk="1">Open Desk</button>
            </div>
          ` : ''}
        </div>`
      : '';

    const emoteText = getActorEmoteBadge(actor, pendingApprovals.length);

    entry.el.innerHTML = `
      ${bubbleHtml}
      <div class="actor-pip-pill ${isCosWithPending ? 'needs-attention' : ''}">
        <span class="actor-emote-bubble">${escapeHtml(emoteText)}</span>
        <span>${escapeHtml(shortFirstName(actor))}</span>
      </div>
    `;

    entry.el.querySelector('[data-quick-approve]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (topPending) triggerApprovalAction(topPending.id, 'approve');
    });
    entry.el.querySelector('[data-open-desk]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      switchDrawerTab('tab-desk');
    });
  });
}

// ============================================================================
// 6. SIMS-STYLE CHARACTER INSPECTOR CARD & CREW ROSTER DOCK
// ============================================================================
function selectActorAndInspect(actorId) {
  if (!appState) return;
  const actor = appState.actors.find(a => a.id === actorId);
  if (!actor) return;

  selectedActorId = actorId;
  const mesh = actorMeshes.get(actorId);
  if (mesh) {
    focusCameraOn(mesh.position.x, mesh.position.z, 1.32);
  }

  renderActorInspector(actor);
  rebuildActorDomOverlays(appState);
  renderCrewRoster(appState);
}

function closeActorInspector() {
  selectedActorId = null;
  document.getElementById('actor-inspector')?.classList.add('hidden');
  if (appState) {
    rebuildActorDomOverlays(appState);
    renderCrewRoster(appState);
  }
}

function hexNumToCss(num) {
  return `#${Number(num).toString(16).padStart(6, '0')}`;
}

function buildMiniToonFaceSvg(actor) {
  const prof = getActorVisualProfile(actor);
  const skin = hexNumToCss(prof.skin);
  const hair = hexNumToCss(prof.hairColor);
  const cheek = hexNumToCss(prof.cheek);
  const hat = hexNumToCss(prof.hatColor || 0xf59e0b);

  let topHairSvg = `<path d="M7 18 C7 8, 29 8, 29 18 C25 13, 11 13, 7 18 Z" fill="${hair}"/>`;
  if (prof.hairStyle === 'quiff' || prof.hairStyle === 'exec') {
    topHairSvg += `<ellipse cx="19" cy="9.5" rx="6.5" ry="3.2" fill="${hair}"/>`;
  } else if (prof.hairStyle === 'messy') {
    topHairSvg += `<circle cx="13" cy="9.5" r="3.4" fill="${hair}"/><circle cx="19" cy="8.8" r="3.8" fill="${hair}"/><circle cx="24" cy="10.5" r="3" fill="${hair}"/>`;
  } else if (prof.hairStyle === 'bob') {
    topHairSvg = `<path d="M6 23 C5.5 9, 30.5 9, 30 23 L27.5 23 L27.5 15.5 L8.5 15.5 L8.5 23 Z" fill="${hair}"/><rect x="10" y="10" width="16" height="4.5" rx="2" fill="${hair}"/>`;
  } else if (prof.hairStyle === 'ponytail') {
    topHairSvg = `<circle cx="28.5" cy="14" r="4.2" fill="${hair}"/>` + topHairSvg;
  } else if (prof.hairStyle === 'beanie') {
    topHairSvg = `<circle cx="18" cy="6.2" r="2.6" fill="${hat}"/><path d="M7.5 16.5 C8 7.5, 28 7.5, 28.5 16.5 Z" fill="${hat}"/><rect x="7" y="13.5" width="22" height="4" rx="2" fill="${hat}" stroke="rgba(0,0,0,0.18)" stroke-width="0.8"/>`;
  } else if (prof.hairStyle === 'hardhat') {
    topHairSvg = `<path d="M7.5 15.5 C8 7.5, 28 7.5, 28.5 15.5 Z" fill="${hat}"/><rect x="5.5" y="14" width="25" height="3" rx="1.5" fill="${hat}"/>`;
  }

  const glassesSvg = prof.glasses !== 'none'
    ? `<circle cx="13.5" cy="19.5" r="3.8" fill="none" stroke="#0f172a" stroke-width="1.6"/><circle cx="22.5" cy="19.5" r="3.8" fill="none" stroke="#0f172a" stroke-width="1.6"/><line x1="17.3" y1="19.5" x2="18.7" y2="19.5" stroke="#0f172a" stroke-width="1.5"/>`
    : '';

  const headsetSvg = prof.accessory === 'headset'
    ? `<rect x="27.5" y="17" width="3.2" height="5.5" rx="1.5" fill="#e2e8f0"/><path d="M29 21.5 Q26 25.5 21.5 25.5" fill="none" stroke="#e2e8f0" stroke-width="1.4" stroke-linecap="round"/>`
    : '';

  return `<svg viewBox="0 0 36 36" aria-hidden="true">
    <circle cx="7.5" cy="20.5" r="2.6" fill="${skin}"/>
    <circle cx="28.5" cy="20.5" r="2.6" fill="${skin}"/>
    <ellipse cx="18" cy="20.5" rx="10.5" ry="10" fill="${skin}"/>
    <circle cx="11.5" cy="22.5" r="2.1" fill="${cheek}" opacity="0.45"/>
    <circle cx="24.5" cy="22.5" r="2.1" fill="${cheek}" opacity="0.45"/>
    <ellipse cx="13.5" cy="19.5" rx="2.3" ry="2.7" fill="#ffffff"/>
    <ellipse cx="22.5" cy="19.5" rx="2.3" ry="2.7" fill="#ffffff"/>
    <circle cx="13.7" cy="19.7" r="1.55" fill="#0f172a"/>
    <circle cx="22.7" cy="19.7" r="1.55" fill="#0f172a"/>
    <circle cx="14.3" cy="19.0" r="0.6" fill="#ffffff"/>
    <circle cx="23.3" cy="19.0" r="0.6" fill="#ffffff"/>
    <path d="M14.8 24.5 Q18 27.3 21.2 24.5" fill="none" stroke="#7c2d12" stroke-width="1.7" stroke-linecap="round"/>
    ${topHairSvg}
    ${glassesSvg}
    ${headsetSvg}
  </svg>`;
}

function renderActorInspector(actor) {
  const card = document.getElementById('actor-inspector');
  if (!card || !actor) return;

  const pendingApprovals = (appState?.approvals || []).filter(a => a.status === 'pending');
  const topPending = pendingApprovals[0];

  const avatarEl = document.getElementById('inspector-avatar');
  avatarEl.style.background = actor.avatar_color || '#2563eb';
  avatarEl.innerHTML = buildMiniToonFaceSvg(actor);

  document.getElementById('inspector-name').textContent = actor.name;
  document.getElementById('inspector-role').textContent = actor.role;
  document.getElementById('inspector-status').textContent = actor.status;

  const isCos = actor.desk_zone === 'chief_of_staff';
  const isHuman = actor.actor_type === 'human' || actor.kind === 'human';
  document.getElementById('inspector-cost').textContent = isHuman
    ? '👤 Human Team'
    : isCos
    ? '⏱️ Metered Shift ($0 Idle)'
    : '⚡ $0.00 Local Worker';

  document.getElementById('inspector-quote').textContent = `"${actor.speech_bubble || actor.current_task}"`;

  const actionsEl = document.getElementById('inspector-actions');
  actionsEl.innerHTML = '';

  const addBtn = (label, cls, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `inspector-action-btn ${cls || ''}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    actionsEl.appendChild(b);
  };

  if (isCos) {
    if (topPending) {
      addBtn(`✓ Approve ${topPending.code}`, 'emerald', () => triggerApprovalAction(topPending.id, 'approve'));
    }
    addBtn('💬 Chat with Marcus', '', () => switchDrawerTab('tab-chat'));
  } else if (actor.desk_zone === 'bullpen_scout' || actor.desk_zone === 'bullpen_recon') {
    addBtn('⚡ Run $0 Site Audit', 'emerald', () => {
      document.getElementById('modal-prospect')?.classList.remove('hidden');
      document.getElementById('input-prospect-url')?.focus();
    });
    addBtn('🗄️ View Dossiers', '', () => switchDrawerTab('tab-vault'));
  } else if (actor.desk_zone === 'bullpen_chloe' || actor.desk_zone === 'bullpen_copy') {
    addBtn('📥 Review Drafts', 'emerald', () => switchDrawerTab('tab-desk'));
  } else if (actor.desk_zone === 'bullpen_devon' || actor.desk_zone === 'bullpen_qa') {
    addBtn('📸 Test Live UI', 'emerald', () => {
      switchDrawerTab('tab-build');
      document.getElementById('btn-run-browser-eye')?.click();
    });
  } else if (actor.desk_zone === 'executive_desk' || actor.desk_zone === 'executive_suite') {
    addBtn(`📥 Open Boss Desk (${pendingApprovals.length})`, 'emerald', () => switchDrawerTab('tab-desk'));
    addBtn('📱 Open Phone', '', () => document.getElementById('phone-dock')?.classList.remove('hidden'));
  } else {
    addBtn('🗄️ Open Shared Vault', '', () => switchDrawerTab('tab-vault'));
  }

  card.classList.remove('hidden');
}

function renderCrewRoster(state) {
  const rosterEl = document.getElementById('crew-roster-list');
  if (!rosterEl || !state) return;
  const pendingCount = state.approvals.filter(a => a.status === 'pending').length;

  rosterEl.innerHTML = state.actors.map(actor => {
    const pip = getActorEmoteBadge(actor, pendingCount).split(' ')[0];
    const isSelected = selectedActorId === actor.id;
    return `
      <button
        type="button"
        class="crew-chip ${isSelected ? 'active' : ''}"
        data-roster-actor="${escapeHtml(actor.id)}"
        style="background:${escapeHtml(actor.avatar_color || '#2563eb')};"
        title="${escapeHtml(actor.name)} — ${escapeHtml(actor.role)}"
      >
        ${buildMiniToonFaceSvg(actor)}
        <span class="crew-chip-pip">${escapeHtml(pip)}</span>
      </button>
    `;
  }).join('');

  rosterEl.querySelectorAll('[data-roster-actor]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectActorAndInspect(btn.getAttribute('data-roster-actor'));
    });
  });
}

document.getElementById('inspector-close')?.addEventListener('click', closeActorInspector);

// ============================================================================
// 7. 3D RAYCAST INTERACTION, CAMERA ORBIT & LIVING ANIMATION LOOP
// ============================================================================
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

function focusCameraOn(x, z, zoomLevel = 1.3) {
  camControl.goalTarget.set(x, 0.55, z);
  camControl.goalZoom = zoomLevel;
}

function resetCameraOverview() {
  camControl.goalTarget.set(-0.2, 0.55, 0.2);
  camControl.goalAzimuth = Math.PI / 4;
  camControl.goalElevation = 0.66;
  camControl.goalZoom = 1.04;
}

function getRaycastHit(clientX, clientY) {
  const rect = threeCanvas.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(interactiveHitMeshes, false);
  return hits.length > 0 ? hits[0].object : null;
}

threeCanvas.addEventListener('pointerdown', (e) => {
  camControl.isDragging = true;
  camControl.dragMoved = false;
  camControl.pointerDownX = e.clientX;
  camControl.pointerDownY = e.clientY;
  camControl.lastX = e.clientX;
  camControl.lastY = e.clientY;
});

window.addEventListener('pointermove', (e) => {
  if (camControl.isDragging) {
    const dx = e.clientX - camControl.lastX;
    const dy = e.clientY - camControl.lastY;
    if (Math.hypot(e.clientX - camControl.pointerDownX, e.clientY - camControl.pointerDownY) > 6) {
      camControl.dragMoved = true;
    }
    camControl.lastX = e.clientX;
    camControl.lastY = e.clientY;
    camControl.goalAzimuth -= dx * 0.0055;
    camControl.goalElevation = Math.max(0.38, Math.min(1.18, camControl.goalElevation + dy * 0.0045));
    threeCanvas.style.cursor = 'grabbing';
    return;
  }

  // Hover raycasting on 3D characters & interactive office zones!
  if (e.target === threeCanvas) {
    const hitObj = getRaycastHit(e.clientX, e.clientY);
    if (hitObj) {
      threeCanvas.style.cursor = 'pointer';
      const u = hitObj.userData || {};
      const newHoverActor = u.interactiveType === 'actor' ? u.actorId : null;
      hoveredZoneId = u.interactiveType !== 'actor' ? u.interactiveType : null;
      if (newHoverActor !== hoveredActorId) {
        hoveredActorId = newHoverActor;
        if (appState) rebuildActorDomOverlays(appState);
      }
    } else {
      threeCanvas.style.cursor = 'grab';
      hoveredZoneId = null;
      if (hoveredActorId !== null) {
        hoveredActorId = null;
        if (appState) rebuildActorDomOverlays(appState);
      }
    }
  }
});

window.addEventListener('pointerup', (e) => {
  const wasDragging = camControl.isDragging;
  const moved = camControl.dragMoved;
  camControl.isDragging = false;

  if (wasDragging && !moved && e.target === threeCanvas) {
    const hitObj = getRaycastHit(e.clientX, e.clientY);
    if (!hitObj) {
      closeActorInspector();
      return;
    }
    const u = hitObj.userData || {};
    if (u.interactiveType === 'actor' && u.actorId) {
      selectActorAndInspect(u.actorId);
    } else if (u.interactiveType === 'boss_desk') {
      focusCameraOn(-5.6, -1.6, 1.42);
      switchDrawerTab('tab-desk');
    } else if (u.interactiveType === 'vault') {
      focusCameraOn(-0.2, -3.8, 1.32);
      switchDrawerTab('tab-vault');
    } else if (u.interactiveType === 'warroom') {
      document.getElementById('cam-warroom')?.click();
    } else if (u.interactiveType === 'stapler') {
      focusCameraOn(-6.2, -1.5, 1.78);
      showOfficeToast('📎 Marcus: "Nobody touches your red Swingline stapler, boss — every TPS report has its SOP cover sheet!"');
    } else if (u.interactiveType === 'coffee') {
      focusCameraOn(-6.8, 4.1, 1.45);
      showOfficeToast('☕ Fresh Austin espresso brewing! ($0 local worker automations run 24/7 without burning API tokens.)');
    }
  }
});

stageEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  camControl.goalZoom = Math.max(0.7, Math.min(2.15, camControl.goalZoom + delta));
}, { passive: false });

function projectToScreen(x, y, z) {
  const v = new THREE.Vector3(x, y, z);
  v.project(camera);
  const halfW = stageEl.clientWidth / 2;
  const halfH = stageEl.clientHeight / 2;
  return {
    x: v.x * halfW + halfW,
    y: -v.y * halfH + halfH
  };
}

function handleResize() {
  const w = Math.max(1, stageEl.clientWidth);
  const h = Math.max(1, stageEl.clientHeight);
  const asp = w / h;
  camera.left = (-frustumSize * asp) / 2;
  camera.right = (frustumSize * asp) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', handleResize);

const clock = new THREE.Clock();
let barkCleanupTick = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.getElapsedTime();

  // Auto-expire transient speech bark so screen stays clean!
  barkCleanupTick += dt;
  if (barkCleanupTick > 0.35) {
    barkCleanupTick = 0;
    if (activeBark.actorId && Date.now() >= activeBark.until) {
      activeBark.actorId = null;
      if (appState) rebuildActorDomOverlays(appState);
    }
  }

  // Smooth camera spherical lerp
  camControl.azimuth += (camControl.goalAzimuth - camControl.azimuth) * 0.12;
  camControl.elevation += (camControl.goalElevation - camControl.elevation) * 0.12;
  camControl.zoom += (camControl.goalZoom - camControl.zoom) * 0.12;
  camControl.target.lerp(camControl.goalTarget, 0.12);

  const radius = 24.5;
  camera.position.x = camControl.target.x + radius * Math.cos(camControl.elevation) * Math.sin(camControl.azimuth);
  camera.position.y = camControl.target.y + radius * Math.sin(camControl.elevation);
  camera.position.z = camControl.target.z + radius * Math.cos(camControl.elevation) * Math.cos(camControl.azimuth);
  camera.zoom = camControl.zoom;
  camera.lookAt(camControl.target);
  camera.updateProjectionMatrix();

  // Animate Server Vault LEDs, Water Cooler Bubbles & Boss Desk Approval Halo
  serverLedMeshes.forEach((led, idx) => {
    led.visible = Math.sin(elapsed * 3.8 + idx * 1.5) > -0.35;
  });

  waterBubbleMeshes.forEach((bub) => {
    const cycle = ((elapsed * 0.28 + bub.userData.offset) % 1);
    bub.position.y = bub.userData.baseY + cycle * 0.36;
  });

  if (bossDeskHalo && bossDeskHalo.visible) {
    const pulse = 1 + Math.sin(elapsed * 3.6) * 0.12;
    bossDeskHalo.scale.set(pulse, pulse, 1);
    bossDeskHalo.material.opacity = 0.55 + Math.sin(elapsed * 3.6) * 0.25;
  }

  // Animate Big-Headed Toon Characters (Walking, Seated Typing, Blinking & Idle!)
  actorMeshes.forEach((mesh) => {
    const ud = mesh.userData;
    const dx = ud.targetX - mesh.position.x;
    const dz = ud.targetZ - mesh.position.z;
    const dist = Math.hypot(dx, dz);

    // Periodic Natural Eye Blinking
    if (elapsed > ud.nextBlinkAt) {
      ud.blinkEndAt = elapsed + 0.13;
      ud.nextBlinkAt = elapsed + 2.4 + Math.random() * 3.4;
    }
    const eyeBlinkScale = elapsed < ud.blinkEndAt ? 0.08 : 1.0;
    ud.eyeGroups.forEach(eg => {
      eg.scale.y = eyeBlinkScale;
    });

    // Ring highlight when hovered or selected
    const isHighlighted = ud.actorId === hoveredActorId || ud.actorId === selectedActorId;
    const ringScale = isHighlighted ? 1.18 + Math.sin(elapsed * 6) * 0.06 : 1.0;
    ud.ring.scale.set(ringScale, ringScale, 1);
    ud.ring.material.opacity = isHighlighted ? 0.95 : 0.52;

    const lerpAngle = (curr, goal, a) => curr + Math.atan2(Math.sin(goal - curr), Math.cos(goal - curr)) * a;

    if (dist > 0.05) {
      // BOUNCY TOON WALK CYCLE!
      const speed = Math.min(dist, dt * 3.35);
      mesh.position.x += (dx / dist) * speed;
      mesh.position.z += (dz / dist) * speed;
      mesh.rotation.y = lerpAngle(mesh.rotation.y, Math.atan2(dx, dz), 0.25);

      ud.walkPhase += dt * 12.5;
      const swing = Math.sin(ud.walkPhase) * 0.55;
      const hop = Math.abs(Math.sin(ud.walkPhase)) * 0.065;

      ud.rig.position.y = hop;
      ud.torsoGroup.rotation.x = 0.08;
      ud.leftLegPivot.rotation.x = swing;
      ud.rightLegPivot.rotation.x = -swing;
      ud.leftArmPivot.rotation.x = -swing * 0.75;
      ud.rightArmPivot.rotation.x = ud.folderMesh.visible ? -0.45 : swing * 0.75;
      ud.headGroup.rotation.x = -0.06;
      ud.headGroup.rotation.y = Math.sin(ud.walkPhase * 0.5) * 0.08;
      ud.headGroup.rotation.z = Math.sin(ud.walkPhase) * 0.04;
    } else if (ud.shouldSit) {
      // SEATED IN CHAIR & TYPING AT MONITOR!
      mesh.rotation.y = lerpAngle(mesh.rotation.y, ud.goalRotY, 0.18);
      ud.rig.position.y += (-0.17 - ud.rig.position.y) * 0.2;
      ud.torsoGroup.rotation.x = 0.04;

      // Bent knees forward
      ud.leftLegPivot.rotation.x += (-1.32 - ud.leftLegPivot.rotation.x) * 0.2;
      ud.rightLegPivot.rotation.x += (-1.32 - ud.rightLegPivot.rotation.x) * 0.2;

      // Playful two-handed keyboard typing
      const typeWave = elapsed * 13 + ud.idlePhase;
      ud.leftArmPivot.rotation.x = -0.92 + Math.sin(typeWave) * 0.14;
      ud.rightArmPivot.rotation.x = -0.92 + Math.cos(typeWave * 1.15) * 0.14;

      // Cheerful upward head pitch toward isometric camera + subtle reading scan
      ud.headGroup.rotation.y = Math.sin(elapsed * 1.4 + ud.idlePhase) * 0.14;
      ud.headGroup.rotation.x = -0.09 + Math.sin(elapsed * 2.6 + ud.idlePhase) * 0.03;
      ud.headGroup.rotation.z = 0;
    } else {
      // STANDING IDLE PERSONALITY (Smoothly face camera/goal + Gentle Breathing)
      mesh.rotation.y = lerpAngle(mesh.rotation.y, ud.goalRotY, 0.16);
      const bob = Math.sin(elapsed * 2.4 + ud.idlePhase) * 0.018;
      ud.rig.position.y += (bob - ud.rig.position.y) * 0.2;
      ud.torsoGroup.rotation.x *= 0.85;
      ud.leftLegPivot.rotation.x *= 0.82;
      ud.rightLegPivot.rotation.x *= 0.82;
      ud.leftArmPivot.rotation.x *= 0.82;
      ud.rightArmPivot.rotation.x = ud.folderMesh.visible
        ? -0.52 + Math.sin(elapsed * 2.5) * 0.05
        : ud.rightArmPivot.rotation.x * 0.82;

      ud.headGroup.rotation.x = -0.09 + Math.sin(elapsed * 2.0 + ud.idlePhase) * 0.025;
      ud.headGroup.rotation.y = Math.sin(elapsed * 1.1 + ud.idlePhase) * 0.22;
      ud.headGroup.rotation.z = Math.sin(elapsed * 1.7 + ud.idlePhase) * 0.03;
    }
  });

  renderer.render(scene, camera);

  // Project Actor Name Pips with Screen-Space Repulsion (Zero Label Overlap!)
  const projectedTags = [];
  domActorEls.forEach(({ el }, actorId) => {
    const mesh = actorMeshes.get(actorId);
    if (!mesh) return;
    const headY = mesh.userData.shouldSit ? 1.68 : 1.86;
    const pos = projectToScreen(mesh.position.x, headY, mesh.position.z);
    projectedTags.push({ el, actorId, x: pos.x, y: pos.y });
  });

  // 2-Pass Pairwise Separation so pips fan out cleanly when huddled
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < projectedTags.length; i++) {
      for (let j = i + 1; j < projectedTags.length; j++) {
        const a = projectedTags[i];
        const b = projectedTags[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) < 82 && Math.abs(dy) < 28) {
          const pushX = (dx >= 0 ? 1 : -1) * (82 - Math.abs(dx)) * 0.35;
          const pushY = (dy >= 0 ? 1 : -1) * (28 - Math.abs(dy)) * 0.4;
          a.x -= pushX;
          b.x += pushX;
          a.y -= pushY;
          b.y += pushY;
        }
      }
    }
  }

  projectedTags.forEach(({ el, x, y }) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
}

animate();

// ============================================================================
// 8. FULL UI RENDERING (DRAWER TABS, QUEST BANNER, PHONE, VAULT & MODALS)
// ============================================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSimpleMarkdown(str) {
  return escapeHtml(str)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:#0f172a;padding:1px 5px;border-radius:4px;color:#93c5fd;">$1</code>');
}

function showOfficeToast(message) {
  const toast = document.getElementById('office-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showOfficeToast._timer);
  showOfficeToast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 5000);
}

function renderFullUI(state) {
  appState = state;
  sync3DSceneWithState(state);
  rebuildActorDomOverlays(state);
  renderCrewRoster(state);

  if (selectedActorId) {
    const sel = state.actors.find(a => a.id === selectedActorId);
    if (sel) renderActorInspector(sel);
  }

  const pendingApprovals = state.approvals.filter(a => a.status === 'pending');
  const pendingBuilds = (state.buildTickets || []).filter(b => b.status === 'pending_boss');
  const budget = state.workspace.budget || state.budgetStatus || {
    shiftsUsed: 1,
    maxShiftsPerDay: 4,
    costUsd: 0.012,
    dailyBudgetUsd: 0.50,
    tokensIn: 1420,
    tokensOut: 480,
    simulationMode: true,
    ownerEmail: 'feedbackdaisy@gmail.com'
  };

  // Top Bar Subtitle & Single Clear Focal Quest Banner
  const taglineEl = document.getElementById('workspace-tagline');
  if (taglineEl) {
    taglineEl.textContent = budget.simulationMode
      ? '🧪 Sandbox Mode ($0 Risk) • Click any character or room to play'
      : '🟢 Live Operations Active • Click any character or room to play';
  }

  const questBtn = document.getElementById('pill-desk-approvals');
  const questIcon = document.getElementById('quest-banner-icon');
  const questText = document.getElementById('pill-approvals-text');
  const questCta = document.getElementById('quest-banner-cta');
  if (questBtn && questText) {
    if (pendingApprovals.length > 0) {
      questBtn.classList.add('urgent');
      if (questIcon) questIcon.textContent = '📋';
      questText.textContent = `${pendingApprovals.length} Approval${pendingApprovals.length > 1 ? 's' : ''} Waiting on Your Boss Desk`;
      if (questCta) questCta.textContent = 'Open Desk →';
    } else if (pendingBuilds.length > 0) {
      questBtn.classList.add('urgent');
      if (questIcon) questIcon.textContent = '🛠️';
      questText.textContent = `${pendingBuilds.length} Build Spec${pendingBuilds.length > 1 ? 's' : ''} Ready for Sign-Off`;
      if (questCta) questCta.textContent = 'Inspect →';
    } else {
      questBtn.classList.remove('urgent');
      if (questIcon) questIcon.textContent = '✨';
      questText.textContent = 'Boss Desk Clear! Crew running at $0';
      if (questCta) questCta.textContent = '+ Audit';
    }
  }

  const budgetText = document.getElementById('pill-budget-text');
  if (budgetText) {
    budgetText.textContent = `Shift ${budget.shiftsUsed}/${budget.maxShiftsPerDay} • $${budget.costUsd.toFixed(3)}`;
  }

  const dockDeskBadge = document.getElementById('dock-desk-badge');
  if (dockDeskBadge) {
    dockDeskBadge.textContent = String(pendingApprovals.length);
    dockDeskBadge.style.display = pendingApprovals.length > 0 ? 'inline-block' : 'none';
  }

  const pendingBadge = document.getElementById('badge-pending-count');
  if (pendingBadge) pendingBadge.textContent = String(pendingApprovals.length);
  const buildBadge = document.getElementById('badge-build-count');
  if (buildBadge) buildBadge.textContent = String(pendingBuilds.length);
  const emailBadge = document.getElementById('badge-email-count');
  if (emailBadge) emailBadge.textContent = String((state.bossEmails || []).length);

  const llmBtn = document.getElementById('btn-sms-settings');
  if (llmBtn && state.workspace.llm_status) {
    llmBtn.textContent = state.workspace.llm_status.active
      ? `🧠 Cap $${budget.dailyBudgetUsd.toFixed(2)}`
      : `🧠 AI Cap`;
  }

  // 1. Approvals List (Tab 1: Desk)
  const approvalsEl = document.getElementById('approvals-list-container');
  if (approvalsEl) {
    if (state.approvals.length === 0) {
      approvalsEl.innerHTML = `<div class="beat-box">🎉 Your Boss Desk is completely clear! Click <strong>⚡ + $0 Audit</strong> on the dock to put Scout &amp; Chloe to work.</div>`;
    } else {
      approvalsEl.innerHTML = state.approvals.map(app => {
        const isPending = app.status === 'pending';
        const checksHtml = (app.sop_checks || []).map(c =>
          `<div class="sop-check-item"><span>✅</span><span>${escapeHtml(c)}</span></div>`
        ).join('');

        return `
          <article class="approval-card ${isPending ? 'pending-high' : 'resolved'}" style="margin-bottom:12px;">
            <div class="approval-top-bar">
              <div class="approval-code-group">
                <span class="approval-code">${escapeHtml(app.code)}</span>
                <span class="approval-channel-badge">${escapeHtml(app.channel)}</span>
                <span class="approval-sop-tag">${escapeHtml(app.sop_code)}</span>
              </div>
              <span style="font-size:11px;font-weight:700;color:${isPending ? '#fbbf24' : '#34d399'};">
                ${isPending ? '⏳ READY FOR SIGN-OFF' : `✓ ${escapeHtml(app.status.toUpperCase().replace('_', ' & '))}`}
              </span>
            </div>

            <div>
              <div class="approval-title">${escapeHtml(app.title)}</div>
              <div class="approval-recipient">To: <strong>${escapeHtml(app.recipient_name)}</strong> (${escapeHtml(app.recipient_contact)}) • Prepared by ${escapeHtml(app.agent_name)}</div>
            </div>

            <div class="beat-box">
              <span class="beat-label">1. What Happened (Shared Memory Context)</span>
              ${escapeHtml(app.what_happened)}
            </div>

            <div class="beat-box">
              <span class="beat-label">2. Editable Outbound Draft</span>
              <div style="margin-bottom:5px;">${escapeHtml(app.what_prepared)}</div>
              <textarea id="draft-${escapeHtml(app.id)}" class="draft-textarea" ${isPending ? '' : 'readonly'}>${escapeHtml(app.draft_payload)}</textarea>
            </div>

            <div class="sop-checks-list">${checksHtml}</div>

            ${isPending ? `
              <div class="beat-box" style="border-color:rgba(16,185,129,0.35);background:rgba(6,78,59,0.22);color:#d1fae5;">
                <span class="beat-label" style="color:#34d399;">3. Recommended Action</span>
                ${escapeHtml(app.recommended_action)}
              </div>
              <div class="approval-actions-row">
                <button class="btn-approve-send" type="button" data-action="approve" data-id="${escapeHtml(app.id)}">
                  <span>✓ Approve &amp; Send (${escapeHtml(app.code)})</span>
                </button>
                <button class="btn-secondary-action" type="button" data-action="hold" data-id="${escapeHtml(app.id)}">
                  ⏸ Hold
                </button>
              </div>
            ` : ''}
          </article>
        `;
      }).join('');

      approvalsEl.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const action = btn.getAttribute('data-action');
          const textarea = document.getElementById(`draft-${id}`);
          const edited = textarea ? textarea.value : null;
          triggerApprovalAction(id, action, edited);
        });
      });
    }
  }

  // 2. Budget & Browser Eye + Architect Build Specs (Tab 2: Build-Out)
  const budgetBox = document.getElementById('budget-ledger-box');
  if (budgetBox) {
    const pct = Math.min(100, Math.round((budget.costUsd / Math.max(0.01, budget.dailyBudgetUsd)) * 100));
    budgetBox.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:800;color:#38bdf8;">⏱️ Chief of Staff Daily Shift &amp; Cost Meter</span>
        <span class="approval-code">${budget.shiftsUsed} / ${budget.maxShiftsPerDay} Shifts</span>
      </div>
      <div style="font-size:11.5px;color:#cbd5e1;margin-bottom:6px;">
        • <strong>Marcus API Spend Today:</strong> <strong style="color:#34d399;">$${(budget.costUsd || 0).toFixed(3)}</strong> of <strong>$${(budget.dailyBudgetUsd || 0.5).toFixed(2)} cap</strong> (${(budget.tokensIn || 0).toLocaleString()} in / ${(budget.tokensOut || 0).toLocaleString()} out)<br/>
        • <strong>Worker Squad (@scout, @chloe, @devon):</strong> <strong style="color:#34d399;">$0.00 token cost</strong><br/>
        • <strong>Comms Bridge:</strong> Short SMS (&lt;180 chars) + Full Email (<code>${escapeHtml(budget.ownerEmail || 'feedbackdaisy@gmail.com')}</code>)
      </div>
      <div style="width:100%;height:7px;background:#0f172a;border-radius:999px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#10b981,#38bdf8);"></div>
      </div>
    `;
  }

  const browserObsEl = document.getElementById('browser-observations-container');
  if (browserObsEl) {
    const obsList = state.browserObservations || [];
    const assetBase = window.location.pathname.startsWith('/office') ? '/office' : '';
    if (obsList.length === 0) {
      browserObsEl.innerHTML = `<div class="beat-box" style="font-size:11.5px;color:#94a3b8;">No browser runs yet. Click <strong>📸 Test UI Now</strong> above to capture live Mobile &amp; Desktop screenshots.</div>`;
    } else {
      const latest = obsList.slice(0, 4);
      browserObsEl.innerHTML = `
        <div class="browser-shot-grid">
          ${latest.map(ob => {
            const vp = ob.viewport_label || ob.viewport || 'Viewport';
            const rawShot = ob.screenshot_url || ob.screenshot_path || '';
            const shot = rawShot.startsWith('/screenshots/') ? `${assetBase}${rawShot}` : rawShot;
            const status = (ob.mobile_overflow === 0 && (ob.console_errors || 0) <= 1) ? 'PASS' : 'WARN';
            const summaryText = ob.summary || ob.findings || '';
            return `
            <div class="browser-shot-card">
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;">
                <strong style="color:#38bdf8;">📸 ${escapeHtml(vp)}</strong>
                <span style="color:${status === 'PASS' ? '#34d399' : '#fbbf24'};font-weight:800;">${status}</span>
              </div>
              ${shot ? `<a href="${escapeHtml(shot)}" target="_blank" title="Open full screenshot"><img src="${escapeHtml(shot)}${shot.includes('?') ? '&' : '?'}t=${encodeURIComponent(ob.created_at)}" alt="${escapeHtml(vp)} screenshot" /></a>` : ''}
              <div style="font-size:10.5px;color:#cbd5e1;line-height:1.35;">${escapeHtml(summaryText)}</div>
            </div>
            `;
          }).join('')}
        </div>
      `;
    }
  }

  const deployBodyEl = document.getElementById('mobile-deploy-body');
  const dep = state.workspace?.deploy || state.deploy;
  if (deployBodyEl && dep) {
    const vercelProdUrl = 'https://tiberius.ai/office';
    const primaryUrl = window.location.hostname.includes('tiberius.ai')
      ? window.location.href
      : (dep.publicHttpsUrl || vercelProdUrl);
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(primaryUrl)}`;
    deployBodyEl.innerHTML = `
      <div style="display:flex;gap:14px;align-items:center;background:#0b111e;padding:12px;border-radius:12px;border:1px solid rgba(16,185,129,0.35);">
        <img src="${qrSrc}" alt="Mobile QR Code" style="width:120px;height:120px;border-radius:8px;background:#fff;padding:6px;flex-shrink:0;" />
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="font-size:12.5px;font-weight:800;color:#6ee7b7;">📱 Scan QR on Your Phone</div>
          <div style="font-size:11.5px;">
            • <strong>Live URL:</strong> <a href="${vercelProdUrl}" target="_blank" style="color:#34d399;font-weight:700;">${vercelProdUrl}</a>
          </div>
          ${dep.publicHttpsUrl ? `<div style="font-size:11.5px;">
            • <strong>Tunnel:</strong> <a href="${escapeHtml(dep.publicHttpsUrl)}" target="_blank" style="color:#38bdf8;word-break:break-all;">${escapeHtml(dep.publicHttpsUrl)}</a>
          </div>` : ''}
        </div>
      </div>
      <div class="beat-box" style="border-color:rgba(56,189,248,0.4);">
        <span class="beat-label" style="color:#38bdf8;">💬 Texting Marcus From Work</span>
        Open <a href="${vercelProdUrl}" target="_blank" style="color:#38bdf8;">tiberius.ai/office</a> on your phone and tap <strong>💬 Text Marcus</strong>, or connect Textbelt/Twilio in <strong>⚙️ Setup</strong>.
      </div>
    `;
  }

  const buildTicketsEl = document.getElementById('build-tickets-container');
  if (buildTicketsEl) {
    const tickets = state.buildTickets || [];
    buildTicketsEl.innerHTML = tickets.map(bt => {
      const isPending = bt.status === 'pending_boss';
      const replyCode = bt.code.replace('#', '').replace('-', '');
      return `
        <article class="approval-card ${isPending ? 'pending-high' : 'resolved'}">
          <div class="approval-top-bar">
            <div class="approval-code-group">
              <span class="approval-code" style="color:#38bdf8;border-color:rgba(56,189,248,0.4);background:rgba(56,189,248,0.15);">${escapeHtml(bt.code)}</span>
              <span class="approval-channel-badge">${escapeHtml(bt.category)}</span>
            </div>
            <span style="font-size:11px;font-weight:700;color:${isPending ? '#fbbf24' : '#34d399'};">
              ${isPending ? `⏳ REPLY "${replyCode}" TO APPROVE` : `✓ ${escapeHtml(bt.status.toUpperCase().replace(/_/g, ' '))}`}
            </span>
          </div>
          <div class="approval-title">${escapeHtml(bt.title)}</div>
          <div class="approval-recipient">Source: ${escapeHtml(bt.observation_source)}</div>
          <div class="beat-box">
            <span class="beat-label">What Marcus Observed</span>
            ${escapeHtml(bt.what_marcus_observed)}
          </div>
          <div class="beat-box" style="border-color:rgba(56,189,248,0.3);background:#0b111e;font-family:var(--font-mono);font-size:11px;color:#93c5fd;">
            <span class="beat-label" style="color:#38bdf8;">Architect Prompt Prepared for Antigravity</span>
            ${escapeHtml(bt.architect_prompt)}
          </div>
          ${isPending ? `
            <div class="approval-actions-row">
              <button class="btn-approve-send" type="button" style="background:linear-gradient(135deg,#0284c7,#2563eb);color:#fff;" data-build-action="approve" data-build-id="${escapeHtml(bt.id)}">
                ✓ Approve Build Spec (${escapeHtml(bt.code)})
              </button>
              <button class="btn-secondary-action" type="button" data-build-action="hold" data-build-id="${escapeHtml(bt.id)}">
                ⏸ Hold
              </button>
            </div>
          ` : ''}
        </article>
      `;
    }).join('');

    buildTicketsEl.querySelectorAll('[data-build-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ticketId = btn.getAttribute('data-build-id');
        const action = btn.getAttribute('data-build-action');
        const data = await apiPost('/build-tickets/action', { workspaceId: currentWorkspaceId, ticketId, action });
        if (data.ok) showOfficeToast(`🛠️ ${data.shortSms}`);
      });
    });
  }

  // 3. Detailed Executive Emails (Tab 3 + Phone Email View)
  const emailsEl = document.getElementById('emails-list-container');
  const phoneEmailsEl = document.getElementById('phone-emails-list');
  const emails = state.bossEmails || [];
  const emailsHtml = emails.map(em => `
    <div class="dossier-card" style="border-left:3px solid #a855f7;">
      <div class="dossier-header">
        <div>
          <div style="font-size:13px;font-weight:800;color:#fff;">📧 ${escapeHtml(em.subject)}</div>
          <div style="font-size:11px;color:var(--text-muted);">From: ${escapeHtml(em.sender_name)} • To: ${escapeHtml(em.recipient_email)}</div>
        </div>
      </div>
      <div class="beat-box" style="background:rgba(37,99,235,0.12);border-color:rgba(59,130,246,0.3);font-size:11px;color:#93c5fd;">
        <strong>📱 Short Companion SMS (${em.summary_sms_sent.length} chars):</strong><br/>
        "${escapeHtml(em.summary_sms_sent)}"
      </div>
      <div class="beat-box" style="white-space:pre-wrap;font-size:12px;line-height:1.5;color:#e2e8f0;">${formatSimpleMarkdown(em.body_markdown)}</div>
    </div>
  `).join('');

  if (emailsEl) emailsEl.innerHTML = emailsHtml || '<div class="beat-box">No detailed emails yet.</div>';
  if (phoneEmailsEl) phoneEmailsEl.innerHTML = emailsHtml || '<div class="beat-box">No detailed emails yet.</div>';

  // 4. Chief of Staff Conversation (Tab 4)
  const chatListEl = document.getElementById('chat-messages-list');
  if (chatListEl) {
    const officeMsgs = state.messages.filter(m => m.channel === 'office_chat');
    chatListEl.innerHTML = officeMsgs.map(m => {
      const isHuman = m.direction === 'human_to_agent';
      return `
        <div class="chat-msg ${isHuman ? 'human' : 'agent'}">
          <div class="chat-msg-header">
            <span>${escapeHtml(m.sender_name)} (${escapeHtml(m.sender_role)})</span>
          </div>
          <div>${formatSimpleMarkdown(m.text)}</div>
        </div>
      `;
    }).join('');
    chatListEl.scrollTop = chatListEl.scrollHeight;
  }

  // 5. Shared Memory Vault (Tab 5: Rules + Dossiers + SOPs)
  const factsEl = document.getElementById('memory-facts-container');
  if (factsEl) {
    factsEl.innerHTML = state.memoryFacts.map(f => `
      <div class="memory-fact-card">
        <div><strong>[${escapeHtml(f.category)}]</strong> ${escapeHtml(f.fact)}</div>
        <div class="memory-fact-meta">Synced by ${escapeHtml(f.added_by)} • Shared across Crew &amp; Boss</div>
      </div>
    `).join('');
  }

  const dossiersEl = document.getElementById('dossiers-container');
  if (dossiersEl) {
    dossiersEl.innerHTML = state.dossiers.map(d => {
      const findingsHtml = (d.findings || []).map(f => `<div style="font-size:11.5px;color:#cbd5e1;">• ${escapeHtml(f)}</div>`).join('');
      const notesHtml = (d.shared_notes || []).map(n => `
        <div class="dossier-note-item">
          <strong style="color:#93c5fd;">${escapeHtml(n.author)}</strong> <span style="color:#64748b;font-size:10px;">(${escapeHtml(n.time)})</span>: ${escapeHtml(n.note)}
        </div>
      `).join('');

      return `
        <div class="dossier-card">
          <div class="dossier-header">
            <div>
              <div style="font-size:13.5px;font-weight:800;color:#fff;">📁 ${escapeHtml(d.client_name)}</div>
              <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(d.vertical)} • ${escapeHtml(d.contact_name)} (${escapeHtml(d.contact_phone)})</div>
            </div>
            <span class="dossier-leak-pill">${escapeHtml(d.monthly_leak_est)}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.42;">${escapeHtml(d.summary)}</div>
          <div class="beat-box" style="display:flex;flex-direction:column;gap:4px;">
            <span class="beat-label">Verified Audit Findings (${escapeHtml(d.sop_code)})</span>
            ${findingsHtml}
          </div>
          <div class="dossier-notes-box">
            <span class="beat-label">Shared Crew + Human Memory Log</span>
            ${notesHtml}
            <div style="display:flex;gap:6px;margin-top:4px;">
              <input type="text" class="chat-input" style="padding:5px 8px;font-size:11.5px;" placeholder="Add shared note..." id="note-input-${escapeHtml(d.id)}" />
              <button class="cam-btn" type="button" data-add-note="${escapeHtml(d.id)}">+ Log</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    dossiersEl.querySelectorAll('[data-add-note]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dossierId = btn.getAttribute('data-add-note');
        const inp = document.getElementById(`note-input-${dossierId}`);
        if (!inp || !inp.value.trim()) return;
        await apiPost('/dossiers/note', { workspaceId: currentWorkspaceId, dossierId, note: inp.value.trim() });
        inp.value = '';
        showOfficeToast('🗄️ Added note to Shared Memory Vault!');
      });
    });
  }

  const sopsEl = document.getElementById('sops-container');
  if (sopsEl) {
    sopsEl.innerHTML = state.sops.map(sop => {
      const stepsHtml = (sop.steps || []).map(st => `
        <div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px dashed rgba(148,163,184,0.12);">
          <span class="approval-code" style="font-size:10px;padding:1px 6px;">Step ${st.step}</span>
          <div style="font-size:11.5px;">
            <div style="font-weight:700;color:#f8fafc;">${escapeHtml(st.name)}</div>
            <div style="color:var(--text-muted);font-size:11px;">${escapeHtml(st.rule)}</div>
          </div>
        </div>
      `).join('');

      return `
        <div class="dossier-card">
          <div class="dossier-header">
            <div>
              <span class="approval-sop-tag">${escapeHtml(sop.code)}</span>
              <span style="font-size:13px;font-weight:800;color:#fff;margin-left:6px;">${escapeHtml(sop.title)}</span>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Owner: ${escapeHtml(sop.department)}</div>
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(sop.description)}</div>
          <div class="beat-box">${stepsHtml}</div>
        </div>
      `;
    }).join('');
  }

  // 6. Floating iPhone SMS Thread
  const phoneMsgsEl = document.getElementById('phone-messages-list');
  if (phoneMsgsEl) {
    const smsMsgs = state.messages.filter(m => m.channel === 'sms_bridge');
    phoneMsgsEl.innerHTML = smsMsgs.map(m => {
      const isOutgoing = m.direction === 'sms_inbound';
      return `<div class="sms-bubble ${isOutgoing ? 'outgoing' : 'incoming'}">${escapeHtml(m.text)}</div>`;
    }).join('');
    phoneMsgsEl.scrollTop = phoneMsgsEl.scrollHeight;
  }

  const cos = state.actors.find(a => a.desk_zone === 'chief_of_staff');
  if (cos) {
    const pcName = document.getElementById('phone-contact-name');
    if (pcName) pcName.textContent = `${shortFirstName(cos)} • Chief of Staff`;
  }
  const pcSub = document.getElementById('phone-owner-number');
  if (pcSub) pcSub.textContent = `To: ${state.workspace.owner_phone} • Reply "1" to Approve`;
}

// ============================================================================
// 9. API CLIENT, DRAWER/DOCK WIRING & LIVE SSE SYNC
// ============================================================================
const IS_VERCEL_SUBPATH = window.location.pathname.startsWith('/office');
const API_BASE = IS_VERCEL_SUBPATH ? '/api/office' : '/api';

async function apiPost(route, payload = {}) {
  const res = await fetch(`${API_BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data && data.state) {
    renderFullUI(data.state);
  } else {
    loadWorkspaceState();
  }
  return data;
}

async function loadWorkspaceState() {
  const res = await fetch(`${API_BASE}/state?workspace=${encodeURIComponent(currentWorkspaceId)}`);
  const data = await res.json();
  renderFullUI(data);
}

async function triggerApprovalAction(approvalId, action = 'approve', editedPayload = null) {
  const result = await apiPost('/approvals/action', {
    workspaceId: currentWorkspaceId,
    approvalId,
    action,
    editedPayload,
    source: 'desk'
  });
  if (result.ok) {
    showOfficeToast(action === 'approve'
      ? `✅ Approved & Dispatched ${result.approval.code} to ${result.approval.recipient_name}!`
      : `⏸ Placed ${result.approval.code} on Hold.`);
  }
}

async function sendChatOrSmsMessage(text, channel = 'office_chat') {
  if (!text.trim()) return;
  await apiPost('/chat', {
    workspaceId: currentWorkspaceId,
    text: text.trim(),
    channel
  });
}

function setDrawerOpenState(isOpen) {
  const drawer = document.getElementById('executive-drawer');
  if (!drawer) return;
  drawer.classList.toggle('collapsed', !isOpen);
  document.body.classList.toggle('drawer-open', isOpen);
  setTimeout(handleResize, 260);
}

function switchDrawerTab(tabId) {
  setDrawerOpenState(true);
  document.querySelectorAll('.drawer-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === tabId);
  });
}

document.querySelectorAll('.drawer-tab').forEach(btn => {
  btn.addEventListener('click', () => switchDrawerTab(btn.getAttribute('data-tab')));
});

document.getElementById('btn-close-drawer')?.addEventListener('click', () => setDrawerOpenState(false));

document.getElementById('btn-toggle-drawer')?.addEventListener('click', () => {
  const drawer = document.getElementById('executive-drawer');
  const willOpen = drawer.classList.contains('collapsed');
  if (willOpen) {
    focusCameraOn(-5.6, -1.6, 1.36);
    switchDrawerTab('tab-desk');
  } else {
    setDrawerOpenState(false);
  }
});

document.getElementById('btn-open-vault')?.addEventListener('click', () => {
  focusCameraOn(-0.2, -3.8, 1.3);
  switchDrawerTab('tab-vault');
});

document.getElementById('btn-toggle-phone')?.addEventListener('click', () => {
  document.getElementById('phone-dock')?.classList.toggle('hidden');
});
document.getElementById('btn-close-phone')?.addEventListener('click', () => {
  document.getElementById('phone-dock')?.classList.add('hidden');
});

document.getElementById('workspace-select')?.addEventListener('change', (e) => {
  currentWorkspaceId = e.target.value;
  selectedActorId = null;
  document.getElementById('actor-inspector')?.classList.add('hidden');
  resetCameraOverview();
  loadWorkspaceState();
  showOfficeToast(`🏢 Switched Office Floor to ${e.target.options[e.target.selectedIndex].text}`);
});

document.getElementById('pill-desk-approvals')?.addEventListener('click', () => {
  const pendingApprovals = (appState?.approvals || []).filter(a => a.status === 'pending');
  const pendingBuilds = (appState?.buildTickets || []).filter(b => b.status === 'pending_boss');
  if (pendingApprovals.length > 0) {
    focusCameraOn(-5.6, -1.6, 1.38);
    switchDrawerTab('tab-desk');
  } else if (pendingBuilds.length > 0) {
    switchDrawerTab('tab-build');
  } else {
    document.getElementById('modal-prospect')?.classList.remove('hidden');
  }
});

document.getElementById('pill-shift-budget')?.addEventListener('click', () => switchDrawerTab('tab-build'));

// Camera & Standup Controls
document.getElementById('cam-reset')?.addEventListener('click', () => {
  closeActorInspector();
  resetCameraOverview();
});
document.getElementById('cam-reset-brand')?.addEventListener('click', () => {
  closeActorInspector();
  resetCameraOverview();
});
document.getElementById('cam-boss')?.addEventListener('click', () => {
  focusCameraOn(-5.6, -1.6, 1.42);
  switchDrawerTab('tab-desk');
});
document.getElementById('cam-vault')?.addEventListener('click', () => {
  focusCameraOn(-0.2, -3.8, 1.32);
  switchDrawerTab('tab-vault');
});
document.getElementById('cam-stapler')?.addEventListener('click', () => {
  focusCameraOn(-6.2, -1.5, 1.78);
  showOfficeToast('📎 Marcus: "Nobody touches your red Swingline stapler, boss!"');
});

let inHuddle = false;
document.getElementById('cam-warroom')?.addEventListener('click', async () => {
  inHuddle = !inHuddle;
  document.getElementById('cam-warroom')?.classList.toggle('active', inHuddle);
  if (inHuddle) focusCameraOn(5.1, -3.1, 1.28);
  else resetCameraOverview();
  await apiPost('/office/huddle', { workspaceId: currentWorkspaceId, mode: inHuddle ? 'huddle' : 'return' });
  showOfficeToast(inHuddle
    ? '🤝 Crew gathering in the War Room for Standup!'
    : '🏃 Crew returning to their workstations!');
});

// Run Marcus Shift
async function triggerMarcusExecutiveShift() {
  showOfficeToast('⏱️ Marcus clocked in for a metered Shift: reviewing $0 worker runs & testing UI...');
  const data = await apiPost('/shifts/run', { workspaceId: currentWorkspaceId, reason: 'Executive Build-Out & Ops Shift' });
  if (data.ok) {
    switchDrawerTab('tab-build');
    showOfficeToast(`✅ Shift ${data.shiftNumber} complete ($${data.costUsd} API cost)! Short SMS sent & full report emailed (${data.ticketCode}).`);
  } else if (data.blockedByCap) {
    showOfficeToast(data.message);
  }
}
document.getElementById('btn-run-shift')?.addEventListener('click', triggerMarcusExecutiveShift);
document.getElementById('btn-run-shift-inline')?.addEventListener('click', triggerMarcusExecutiveShift);

// Marcus Browser Eye
document.getElementById('btn-run-browser-eye')?.addEventListener('click', async () => {
  const urlInput = document.getElementById('input-browser-url');
  const targetUrl = (urlInput && urlInput.value.trim()) || window.location.origin;
  showOfficeToast(`👁️ Marcus is testing & screenshotting ${targetUrl} (Mobile + Desktop)...`);
  const data = await apiPost('/browser/inspect', {
    workspaceId: currentWorkspaceId,
    url: targetUrl,
    viewport: 'both',
    notifySms: true
  });
  if (data.ok) {
    showOfficeToast(`📸 Browser Eye captured Mobile & Desktop screenshots for ${targetUrl}!`);
  }
});

// Phone SMS vs Email Tabs
document.getElementById('phone-tab-sms')?.addEventListener('click', () => {
  document.getElementById('phone-messages-list')?.classList.remove('hidden');
  document.getElementById('phone-emails-list')?.classList.add('hidden');
  document.getElementById('phone-tab-sms').style.background = '#2563eb';
  document.getElementById('phone-tab-sms').style.color = '#fff';
  document.getElementById('phone-tab-email').style.background = '';
});

document.getElementById('phone-tab-email')?.addEventListener('click', () => {
  document.getElementById('phone-emails-list')?.classList.remove('hidden');
  document.getElementById('phone-messages-list')?.classList.add('hidden');
  document.getElementById('phone-tab-email').style.background = '#a855f7';
  document.getElementById('phone-tab-email').style.color = '#fff';
  document.getElementById('phone-tab-sms').style.background = '';
});

document.getElementById('btn-sms-nudge')?.addEventListener('click', async () => {
  document.getElementById('phone-dock')?.classList.remove('hidden');
  await apiPost('/reminders/trigger', { workspaceId: currentWorkspaceId });
  showOfficeToast('📱 Marcus texted a short (<180 char) SMS nudge to your phone!');
});

// Chat & Phone Forms
document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const inp = document.getElementById('chat-input');
  const txt = inp.value;
  inp.value = '';
  await sendChatOrSmsMessage(txt, 'office_chat');
});

document.querySelectorAll('.prompt-chip[data-prompt]').forEach(chip => {
  chip.addEventListener('click', () => {
    const prompt = chip.getAttribute('data-prompt');
    if (prompt) sendChatOrSmsMessage(prompt, 'office_chat');
  });
});

document.getElementById('phone-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const inp = document.getElementById('phone-input');
  const txt = inp.value;
  inp.value = '';
  await sendChatOrSmsMessage(txt, 'sms_bridge');
});

document.querySelectorAll('.sms-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    sendChatOrSmsMessage(chip.getAttribute('data-sms'), 'sms_bridge');
  });
});

document.getElementById('btn-add-rule-inline')?.addEventListener('click', () => {
  switchDrawerTab('tab-chat');
  const inp = document.getElementById('chat-input');
  inp.value = 'Remember: ';
  inp.focus();
});

// Modals (Prospect Audit, Settings, Mobile QR)
const modalProspect = document.getElementById('modal-prospect');
document.getElementById('btn-new-prospect')?.addEventListener('click', () => {
  modalProspect?.classList.remove('hidden');
  document.getElementById('input-prospect-url')?.focus();
});
document.getElementById('close-modal-prospect')?.addEventListener('click', () => modalProspect?.classList.add('hidden'));
document.getElementById('cancel-modal-prospect')?.addEventListener('click', () => modalProspect?.classList.add('hidden'));

document.getElementById('form-launch-prospect')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prospectName = document.getElementById('input-prospect-name').value.trim();
  const vertical = document.getElementById('input-prospect-vertical').value.trim();
  const websiteUrl = document.getElementById('input-prospect-url').value.trim();
  if (!prospectName && !websiteUrl) return;

  modalProspect?.classList.add('hidden');
  document.getElementById('input-prospect-name').value = '';
  document.getElementById('input-prospect-url').value = '';

  showOfficeToast(`🔍 @scout is running a $0 audit on ${websiteUrl || prospectName}...`);
  const data = await apiPost('/jobs/launch', { workspaceId: currentWorkspaceId, prospectName, vertical, websiteUrl });
  if (data.ok) {
    switchDrawerTab('tab-desk');
    showOfficeToast(`🚀 @scout audited ${websiteUrl || prospectName} & placed Approval ${data.code} on your Boss Desk!`);
  }
});

const modalSms = document.getElementById('modal-sms-settings');
document.getElementById('btn-sms-settings')?.addEventListener('click', () => modalSms?.classList.remove('hidden'));
document.getElementById('btn-open-settings-top')?.addEventListener('click', () => modalSms?.classList.remove('hidden'));
document.getElementById('close-modal-sms')?.addEventListener('click', () => modalSms?.classList.add('hidden'));
document.getElementById('cancel-modal-sms')?.addEventListener('click', () => modalSms?.classList.add('hidden'));

document.getElementById('form-sms-settings')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ownerPhone = document.getElementById('input-owner-phone').value.trim();
  const ownerEmail = document.getElementById('input-owner-email')?.value.trim() || 'feedbackdaisy@gmail.com';
  const maxShiftsPerDay = Number(document.getElementById('input-max-shifts')?.value || 4);
  const dailyBudgetUsd = Number(document.getElementById('input-daily-budget')?.value || 0.50);
  const simulationMode = document.getElementById('input-simulation-mode')?.value !== 'false';
  const textbeltKey = document.getElementById('input-textbelt-key').value.trim();
  const resendApiKey = document.getElementById('input-resend-key')?.value.trim() || '';
  const llmProvider = document.getElementById('input-llm-provider').value;
  const llmApiKey = document.getElementById('input-llm-key').value.trim();

  const smsConfig = {
    ownerEmail,
    maxShiftsPerDay,
    dailyBudgetUsd,
    simulationMode,
    textbeltKey,
    resendApiKey,
    llmProvider
  };
  if (llmApiKey) smsConfig.llmApiKey = llmApiKey;

  await apiPost('/settings/sms', {
    workspaceId: currentWorkspaceId,
    ownerPhone,
    smsProvider: textbeltKey ? 'textbelt' : 'simulator',
    smsConfig
  });
  modalSms?.classList.add('hidden');
  showOfficeToast('⚙️ Saved Shift Limits, Sandbox Mode & SMS/Email settings!');
});

const modalMobile = document.getElementById('modal-mobile-deploy');
document.getElementById('btn-mobile-deploy')?.addEventListener('click', () => modalMobile?.classList.remove('hidden'));
document.getElementById('close-modal-mobile')?.addEventListener('click', () => modalMobile?.classList.add('hidden'));
document.getElementById('cancel-modal-mobile')?.addEventListener('click', () => modalMobile?.classList.add('hidden'));

// Mobile Bottom Nav (Smartphones <= 768px)
document.querySelectorAll('[data-mobile-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-mobile-view');
    document.querySelectorAll('[data-mobile-view]').forEach(b => b.classList.toggle('active', b === btn));
    const phoneDock = document.getElementById('phone-dock');

    if (view === 'floor') {
      phoneDock?.classList.add('hidden');
      setDrawerOpenState(false);
    } else if (view === 'phone') {
      setDrawerOpenState(false);
      phoneDock?.classList.remove('hidden');
    } else if (view === 'desk') {
      phoneDock?.classList.add('hidden');
      switchDrawerTab('tab-desk');
    } else if (view === 'build') {
      phoneDock?.classList.add('hidden');
      switchDrawerTab('tab-build');
    } else if (view === 'emails') {
      phoneDock?.classList.add('hidden');
      switchDrawerTab('tab-emails');
    }
  });
});

function connectSSE() {
  if (!IS_VERCEL_SUBPATH) {
    try {
      const es = new EventSource(`${API_BASE}/events`);
      es.addEventListener('state_updated', (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.workspace && data.workspace.id === currentWorkspaceId) {
            renderFullUI(data);
          }
        } catch (_) {}
      });
      return;
    } catch (_) {}
  }

  setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadWorkspaceState().catch(() => {});
    }
  }, 8000);
}

// Initial Boot
handleResize();
loadWorkspaceState();
connectSSE();
