import * as THREE from 'three';

// ============================================================================
// GLOBAL STATE & CONFIG
// ============================================================================
let currentWorkspaceId = 'tiberius-hq';
let appState = null;
let viewMode = '3d'; // '3d' | '2d'

// Camera Spherical / Isometric Target State for 3D Diorama
const camControl = {
  target: new THREE.Vector3(0, 0.5, 0),
  goalTarget: new THREE.Vector3(0, 0.5, 0),
  azimuth: Math.PI / 4, // 45 deg isometric
  goalAzimuth: Math.PI / 4,
  elevation: 0.68,
  goalElevation: 0.68,
  zoom: 1.0,
  goalZoom: 1.0,
  isDragging: false,
  lastX: 0,
  lastY: 0
};

// Zone coordinates for 3D/2D Floor Labels
const OFFICE_ZONES = [
  { id: 'zone-boss', label: 'EXECUTIVE DESK (APPROVAL INBOX)', x: -6.2, y: 0.1, z: -0.2, tab: 'tab-desk' },
  { id: 'zone-cos', label: 'CHIEF OF STAFF STATION', x: -2.2, y: 0.1, z: 3.4, tab: 'tab-chat' },
  { id: 'zone-vault', label: 'SHARED MEMORY & SOP VAULT', x: -0.2, y: 2.9, z: -4.2, tab: 'tab-vault' },
  { id: 'zone-warroom', label: 'WAR ROOM (STANDUP & STRATEGY)', x: 5.0, y: 2.6, z: -3.2, tab: 'tab-sops' },
  { id: 'zone-bullpen', label: 'SPECIALIST AGENT BULLPEN', x: 4.0, y: 0.1, z: 5.9, tab: 'tab-desk' }
];

// ============================================================================
// 1. THREE.JS 3D ISOMETRIC ARCHITECTURAL DIORAMA (OPTION 1)
// ============================================================================
const stageEl = document.getElementById('office-stage');
const threeCanvas = document.getElementById('three-canvas');
const vectorCanvas = document.getElementById('vector-canvas');
const labelsLayer = document.getElementById('floating-labels-layer');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f17);

const frustumSize = 16.5;
const aspect = stageEl.clientWidth / Math.max(1, stageEl.clientHeight);
const camera = new THREE.OrthographicCamera(
  (-frustumSize * aspect) / 2,
  (frustumSize * aspect) / 2,
  frustumSize / 2,
  -frustumSize / 2,
  0.1,
  120
);

const renderer = new THREE.WebGLRenderer({
  canvas: threeCanvas,
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stageEl.clientWidth, stageEl.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Warm Architectural Lighting
const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.78);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xfffbeb, 0x1e293b, 0.65);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfff7ed, 1.35);
dirLight.position.set(12, 22, 14);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 60;
const d = 14;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

// Subtle Vault Accent Point Light
const vaultGlow = new THREE.PointLight(0x38bdf8, 1.4, 8);
vaultGlow.position.set(-0.2, 2.2, -3.8);
scene.add(vaultGlow);

// Dynamic scene references
const actorMeshes = new Map(); // actorId -> Group
const pendingFolderMeshes = [];
const serverLedMeshes = [];

function createProceduralWoodTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9a6b43';
  ctx.fillRect(0, 0, 512, 512);

  const planks = 16;
  const plankH = 512 / planks;
  for (let i = 0; i < planks; i++) {
    const shade = (i % 3 === 0) ? '#8c5e37' : (i % 2 === 0) ? '#a4754d' : '#95663e';
    ctx.fillStyle = shade;
    ctx.fillRect(0, i * plankH, 512, plankH - 2);
    ctx.fillStyle = 'rgba(30, 15, 5, 0.28)';
    ctx.fillRect(0, (i + 1) * plankH - 2, 512, 2);
    // Vertical plank joints
    const jointX = ((i * 137) % 440) + 30;
    ctx.fillRect(jointX, i * plankH, 2, plankH);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function buildArchitecturalOfficeScene() {
  const officeGroup = new THREE.Group();

  // 1. Base Slab & Hardwood Floor
  const slabGeo = new THREE.BoxGeometry(17.6, 0.45, 13.6);
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.set(0, -0.24, 0);
  slab.receiveShadow = true;
  officeGroup.add(slab);

  const floorGeo = new THREE.BoxGeometry(17.0, 0.08, 13.0);
  const floorMat = new THREE.MeshStandardMaterial({
    map: createProceduralWoodTexture(),
    roughness: 0.55,
    metalness: 0.05
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.set(0, 0, 0);
  floor.receiveShadow = true;
  officeGroup.add(floor);

  // Subtle Zone Rugs (Executive Suite, Chief of Staff, Bullpen)
  function addZoneRug(w, d, x, z, hexColor) {
    const rugGeo = new THREE.BoxGeometry(w, 0.02, d);
    const rugMat = new THREE.MeshStandardMaterial({ color: hexColor, roughness: 0.9 });
    const rug = new THREE.Mesh(rugGeo, rugMat);
    rug.position.set(x, 0.05, z);
    rug.receiveShadow = true;
    officeGroup.add(rug);
  }
  addZoneRug(4.6, 4.2, -5.7, -2.2, 0x3b1d26); // Executive Suite carpet
  addZoneRug(3.2, 2.6, -2.2, 1.8, 0x1e293b);  // Chief of Staff mat
  addZoneRug(5.8, 5.2, 4.0, 3.3, 0x132a2e);   // Bullpen mat

  // 2. Back & Left Architectural Cutaway Walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });

  // Back Wall (North, z = -6.5)
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(17.2, 3.2, 0.25), wallMat);
  backWall.position.set(0, 1.6, -6.5);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  officeGroup.add(backWall);

  // Left Wall (West, x = -8.5)
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 13.2), wallMat);
  leftWall.position.set(-8.5, 1.6, 0);
  leftWall.castShadow = true;
  leftWall.receiveShadow = true;
  officeGroup.add(leftWall);

  // Glass Partition: Executive Suite Divider
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x93c5fd,
    transparent: true,
    opacity: 0.24,
    roughness: 0.1,
    metalness: 0.1
  });

  const execPartition = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.5, 5.6), glassMat);
  execPartition.position.set(-3.1, 1.25, -3.6);
  officeGroup.add(execPartition);

  const execFrame = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 5.6), trimMat);
  execFrame.position.set(-3.1, 2.5, -3.6);
  officeGroup.add(execFrame);

  // 3. Glass-Walled SHARED MEMORY & SOP VAULT (Center-Back)
  const vaultGlassFront = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.6, 0.1), glassMat);
  vaultGlassFront.position.set(-0.2, 1.3, -2.0);
  officeGroup.add(vaultGlassFront);

  const vaultGlassRight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 4.4), glassMat);
  vaultGlassRight.position.set(2.4, 1.3, -4.2);
  officeGroup.add(vaultGlassRight);

  // Server Racks inside Shared Memory Vault
  const rackMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.2, 0.85), rackMat);
    rack.position.set(-2.0 + i * 1.15, 1.1, -5.6);
    rack.castShadow = true;
    officeGroup.add(rack);

    // Blinking telemetry LEDs on each server rack
    for (let row = 0; row < 5; row++) {
      const ledGeo = new THREE.BoxGeometry(0.55, 0.05, 0.04);
      const isGreen = (i + row) % 2 === 0;
      const ledMat = new THREE.MeshBasicMaterial({ color: isGreen ? 0x10b981 : 0x38bdf8 });
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.set(-2.0 + i * 1.15, 0.5 + row * 0.34, -5.16);
      officeGroup.add(led);
      serverLedMeshes.push(led);
    }
  }

  // Steel Architectural Filing Cabinets (Client Dossiers & SOP Playbooks)
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.55, 0.75), cabMat);
    cab.position.set(1.6, 0.78, -5.5 + i * 1.0);
    cab.castShadow = true;
    officeGroup.add(cab);
  }

  // 4. Glass-Walled WAR ROOM (Back-Right)
  const warGlassFront = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 0.1), glassMat);
  warGlassFront.position.set(5.3, 1.3, -0.8);
  officeGroup.add(warGlassFront);

  // Conference Table in War Room
  const woodDarkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.45 });
  const confTable = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.7), woodDarkMat);
  confTable.position.set(5.2, 0.76, -3.2);
  confTable.castShadow = true;
  officeGroup.add(confTable);

  const confBase = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.72, 0.8), trimMat);
  confBase.position.set(5.2, 0.36, -3.2);
  officeGroup.add(confBase);

  // 3 Glowing Analytics Wall Screens in War Room
  for (let s = 0; s < 3; s++) {
    const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.85, 0.08), trimMat);
    screenFrame.position.set(3.6 + s * 1.55, 1.85, -6.32);
    officeGroup.add(screenFrame);

    const screenGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 0.75),
      new THREE.MeshBasicMaterial({ color: s === 1 ? 0x0ea5e9 : 0x1d4ed8 })
    );
    screenGlow.position.set(3.6 + s * 1.55, 1.85, -6.27);
    officeGroup.add(screenGlow);
  }

  // 5. EXECUTIVE DESK (APPROVAL INBOX) + RED SWINGLINE STAPLER!
  function buildDeskStation(x, z, rotY = 0, isExecutive = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;

    const w = isExecutive ? 2.4 : 1.75;
    const d = isExecutive ? 1.15 : 0.9;
    const topMat = isExecutive
      ? new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.4 })
      : new THREE.MeshStandardMaterial({ color: 0x7c5333, roughness: 0.5 });

    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), topMat);
    top.position.y = 0.76;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.74, d - 0.1), trimMat);
    legL.position.set(-w / 2 + 0.1, 0.37, 0);
    g.add(legL);

    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.74, d - 0.1), trimMat);
    legR.position.set(w / 2 - 0.1, 0.37, 0);
    g.add(legR);

    // Monitor / Laptop
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.42, 0.05), trimMat);
    monitor.position.set(0, 1.06, -0.18);
    g.add(monitor);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.35),
      new THREE.MeshBasicMaterial({ color: isExecutive ? 0x38bdf8 : 0x34d399 })
    );
    screen.position.set(0, 1.06, -0.15);
    g.add(screen);

    // Ergonomic Chair
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.55), trimMat);
    chairSeat.position.set(0, 0.48, -0.68);
    g.add(chairSeat);

    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.08), trimMat);
    chairBack.position.set(0, 0.82, -0.92);
    g.add(chairBack);

    if (isExecutive) {
      // THE ICONIC RED SWINGLINE STAPLER on the Executive Desk!
      const staplerGroup = new THREE.Group();
      staplerGroup.position.set(-0.78, 0.84, 0.22);
      staplerGroup.rotation.y = 0.35;
      const staplerBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.04, 0.09),
        new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.3 })
      );
      const staplerTop = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.06, 0.08),
        new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.25, metalness: 0.2 })
      );
      staplerTop.position.y = 0.05;
      staplerGroup.add(staplerBase, staplerTop);
      g.add(staplerGroup);

      // Executive Approval In-Tray + Dynamic Stack of Manila Folders
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.04, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x1e293b })
      );
      tray.position.set(0.75, 0.83, 0.18);
      g.add(tray);

      for (let f = 0; f < 4; f++) {
        const folder = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.035, 0.32),
          new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.5 })
        );
        folder.position.set(0.75, 0.87 + f * 0.045, 0.18);
        folder.rotation.y = (f % 2 === 0 ? 0.08 : -0.06);
        g.add(folder);
        pendingFolderMeshes.push(folder);
      }

      // Credenza behind Executive Desk with second Red Accent Tray
      const credenza = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.72, 0.55), topMat);
      credenza.position.set(-1.6, 0.36, -1.3);
      credenza.rotation.y = Math.PI / 2;
      credenza.castShadow = true;
      g.add(credenza);
    }

    officeGroup.add(g);
  }

  // Executive Desk (Boss)
  buildDeskStation(-5.8, -1.6, 0.35, true);
  // Chief of Staff Desk (Marcus)
  buildDeskStation(-2.2, 2.3, 0, false);
  // Specialist Bullpen Desks (Scout, Chloe, Devon)
  buildDeskStation(2.6, 2.7, 0, false);
  buildDeskStation(5.4, 2.7, 0, false);
  buildDeskStation(4.0, 5.2, 0, false);

  scene.add(officeGroup);
}

buildArchitecturalOfficeScene();

// Build a Smooth Stylized 3D Character (Articulated low-poly human, not blocky Minecraft!)
function createStylizedActorMesh(actor) {
  const group = new THREE.Group();

  const suitColor = new THREE.Color(actor.avatar_color || '#2563eb');
  const accentColor = new THREE.Color(actor.accent_color || '#fbbf24');
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.6 });
  const suitMat = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.5 });
  const darkPantsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
  const tieMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4 });
  const hairMat = new THREE.MeshStandardMaterial({
    color: actor.actor_type === 'human' ? 0x27272a : 0x3f2e21,
    roughness: 0.8
  });

  // Legs
  const legGeo = new THREE.CapsuleGeometry(0.085, 0.32, 6, 10);
  const leftLeg = new THREE.Mesh(legGeo, darkPantsMat);
  leftLeg.position.set(-0.11, 0.25, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, darkPantsMat);
  rightLeg.position.set(0.11, 0.25, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  // Torso (Tailored Blazer / Shirt)
  const torsoGeo = new THREE.CapsuleGeometry(0.19, 0.36, 8, 14);
  const torso = new THREE.Mesh(torsoGeo, suitMat);
  torso.position.set(0, 0.68, 0);
  torso.castShadow = true;
  group.add(torso);

  // Collar / Tie / Badge Accent
  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.06), tieMat);
  tie.position.set(0, 0.7, 0.16);
  group.add(tie);

  // Head
  const headGeo = new THREE.SphereGeometry(0.19, 16, 16);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.set(0, 1.12, 0);
  head.castShadow = true;
  group.add(head);

  // Hair cap
  const hairGeo = new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.set(0, 1.14, -0.01);
  group.add(hair);

  // Arms
  const armGeo = new THREE.CapsuleGeometry(0.065, 0.28, 6, 10);
  const leftArm = new THREE.Mesh(armGeo, suitMat);
  leftArm.position.set(-0.26, 0.68, 0);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, suitMat);
  rightArm.position.set(0.26, 0.68, 0);
  rightArm.castShadow = true;
  group.add(rightArm);

  // Manila Approval Folder held in right hand when carrying_folder = 1
  const folderMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.22, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.4 })
  );
  folderMesh.position.set(0.32, 0.66, 0.15);
  folderMesh.rotation.y = 0.4;
  folderMesh.visible = Boolean(actor.carrying_folder);
  group.add(folderMesh);

  // Floor status ring under actor
  const ringGeo = new THREE.RingGeometry(0.28, 0.36, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: accentColor,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);

  group.position.set(actor.x || 0, 0, actor.z || 0);
  group.userData = {
    actorId: actor.id,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    folderMesh,
    walkPhase: Math.random() * Math.PI * 2
  };

  scene.add(group);
  return group;
}

// Sync 3D Actor Meshes with latest Backend State
function sync3DSceneWithState(state) {
  if (!state) return;

  // Show/hide pending manila folders on Executive Desk based on pending approvals
  const pendingCount = state.approvals.filter(a => a.status === 'pending').length;
  pendingFolderMeshes.forEach((mesh, idx) => {
    mesh.visible = idx < pendingCount;
  });

  const activeIds = new Set(state.actors.map(a => a.id));
  for (const [id, mesh] of actorMeshes.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(mesh);
      actorMeshes.delete(id);
    }
  }

  for (const actor of state.actors) {
    let mesh = actorMeshes.get(actor.id);
    if (!mesh) {
      mesh = createStylizedActorMesh(actor);
      actorMeshes.set(actor.id, mesh);
    }
    mesh.userData.targetX = actor.target_x;
    mesh.userData.targetZ = actor.target_z;
    mesh.userData.folderMesh.visible = Boolean(actor.carrying_folder);
  }
}

// ============================================================================
// 2. FLOATING DOM LABELS & CLICKABLE SPEECH BUBBLES
// ============================================================================
const domZoneEls = new Map();
const domActorEls = new Map();

function initZoneDomLabels() {
  OFFICE_ZONES.forEach(z => {
    const el = document.createElement('div');
    el.className = 'zone-floor-label';
    el.textContent = z.label;
    el.addEventListener('click', () => {
      switchDrawerTab(z.tab);
      if (z.id === 'zone-boss') focusCameraOn(-5.6, -1.6, 1.35);
      if (z.id === 'zone-vault') focusCameraOn(-0.2, -3.8, 1.3);
      if (z.id === 'zone-warroom') focusCameraOn(5.0, -3.0, 1.25);
    });
    labelsLayer.appendChild(el);
    domZoneEls.set(z.id, { el, zone: z });
  });
}
initZoneDomLabels();

function rebuildActorDomOverlays(state) {
  if (!state) return;
  const activeIds = new Set(state.actors.map(a => a.id));
  for (const [id, entry] of domActorEls.entries()) {
    if (!activeIds.has(id)) {
      entry.el.remove();
      domActorEls.delete(id);
    }
  }

  const topPending = state.approvals.find(a => a.status === 'pending');

  state.actors.forEach(actor => {
    let entry = domActorEls.get(actor.id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'actor-tag';
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const m = actorMeshes.get(actor.id);
        if (m) focusCameraOn(m.position.x, m.position.z, 1.35);
        if (actor.desk_zone === 'chief_of_staff') switchDrawerTab('tab-chat');
        else if (actor.desk_zone === 'executive_desk') switchDrawerTab('tab-desk');
      });
      labelsLayer.appendChild(el);
      entry = { el, actor };
      domActorEls.set(actor.id, entry);
    }
    entry.actor = actor;

    const isCosWithPending = actor.desk_zone === 'chief_of_staff' && topPending;
    const bubbleHtml = actor.speech_bubble
      ? `<div class="actor-speech-bubble ${isCosWithPending ? 'approval-ready' : ''}">
          <div>${escapeHtml(actor.speech_bubble)}</div>
          ${isCosWithPending ? `
            <div class="bubble-quick-actions">
              <button class="bubble-btn" data-quick-approve="${topPending.id}">✓ Approve & Send ${topPending.code}</button>
              <button class="cam-btn" style="padding:2px 6px;font-size:10px;" data-open-desk="1">Inspect</button>
            </div>
          ` : ''}
        </div>`
      : '';

    entry.el.innerHTML = `
      ${bubbleHtml}
      <div class="actor-nameplate">
        <span class="dot" style="background:${actor.accent_color};box-shadow:0 0 6px ${actor.accent_color};"></span>
        <span>${escapeHtml(actor.name.split(' ')[0])}</span>
        <span class="actor-role-sub">• ${escapeHtml(actor.status)}</span>
      </div>
    `;

    const quickBtn = entry.el.querySelector('[data-quick-approve]');
    if (quickBtn) {
      quickBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        triggerApprovalAction(topPending.id, 'approve');
      });
    }
    const inspectBtn = entry.el.querySelector('[data-open-desk]');
    if (inspectBtn) {
      inspectBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        switchDrawerTab('tab-desk');
      });
    }
  });
}

// Project 3D world position to 2D screen coordinates
function projectToScreen(x, y, z) {
  const v = new THREE.Vector3(x, y, z);
  if (viewMode === '3d') {
    v.project(camera);
    const halfW = stageEl.clientWidth / 2;
    const halfH = stageEl.clientHeight / 2;
    return {
      x: v.x * halfW + halfW,
      y: -v.y * halfH + halfH
    };
  } else {
    // 2D Isometric Vector projection
    const cx = stageEl.clientWidth / 2;
    const cy = stageEl.clientHeight * 0.52;
    const scale = 38 * camControl.zoom;
    const isoX = (x - z) * Math.cos(Math.PI / 6) * scale;
    const isoY = ((x + z) * Math.sin(Math.PI / 6) - y * 0.9) * scale;
    return { x: cx + isoX, y: cy + isoY };
  }
}

// ============================================================================
// 3. OPTION 2: 2D HIGH-CRAFT ISOMETRIC VECTOR FLOORPLAN RENDERER
// ============================================================================
function render2DVectorFloorplan() {
  const ctx = vectorCanvas.getContext('2d');
  const w = vectorCanvas.width;
  const h = vectorCanvas.height;
  ctx.clearRect(0, 0, w, h);

  // Subtle tactical grid background
  ctx.fillStyle = '#0b101b';
  ctx.fillRect(0, 0, w, h);

  function isoPt(x, y, z) {
    return projectToScreen(x, y, z);
  }

  function drawIsoTile(x1, z1, x2, z2, fill, stroke = 'rgba(148,163,184,0.22)') {
    const p1 = isoPt(x1, 0, z1);
    const p2 = isoPt(x2, 0, z1);
    const p3 = isoPt(x2, 0, z2);
    const p4 = isoPt(x1, 0, z2);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  // Main Office Floor Tile
  drawIsoTile(-8.4, -6.4, 8.4, 6.4, '#1e293b', '#475569');

  // Color-Coded Department Carpets (Option 2 Concept Style!)
  drawIsoTile(-8.0, -4.5, -3.3, 0.2, 'rgba(220, 38, 38, 0.24)', '#ef4444'); // Executive Approval Desk (Red)
  drawIsoTile(-3.2, 0.4, 0.2, 3.6, 'rgba(245, 158, 11, 0.22)', '#f59e0b');  // Chief of Staff (Amber)
  drawIsoTile(-2.8, -6.1, 2.4, -1.8, 'rgba(56, 189, 248, 0.20)', '#38bdf8'); // Shared Memory & SOP Vault (Cyan)
  drawIsoTile(2.6, -6.1, 8.0, -0.8, 'rgba(139, 92, 246, 0.20)', '#8b5cf6');  // War Room (Purple)
  drawIsoTile(1.2, 0.8, 7.6, 6.0, 'rgba(16, 185, 129, 0.20)', '#10b981');    // Specialist Bullpen (Emerald)

  // Grid subdivisions
  for (let gx = -8; gx <= 8; gx += 2) {
    const a = isoPt(gx, 0, -6.4);
    const b = isoPt(gx, 0, 6.4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.stroke();
  }
  for (let gz = -6; gz <= 6; gz += 2) {
    const a = isoPt(-8.4, 0, gz);
    const b = isoPt(8.4, 0, gz);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.stroke();
  }

  // Draw Isometric 3D-extruded Vector Desks & Filing Cabinets
  function drawIsoBox(cx, cz, bw, bd, bh, topColor, leftColor, rightColor) {
    const x1 = cx - bw / 2, x2 = cx + bw / 2;
    const z1 = cz - bd / 2, z2 = cz + bd / 2;
    const t1 = isoPt(x1, bh, z1), t2 = isoPt(x2, bh, z1), t3 = isoPt(x2, bh, z2), t4 = isoPt(x1, bh, z2);
    const b2 = isoPt(x2, 0, z1), b3 = isoPt(x2, 0, z2), b4 = isoPt(x1, 0, z2);

    // Left visible face
    ctx.beginPath();
    ctx.moveTo(t4.x, t4.y); ctx.lineTo(t3.x, t3.y); ctx.lineTo(b3.x, b3.y); ctx.lineTo(b4.x, b4.y);
    ctx.closePath(); ctx.fillStyle = leftColor; ctx.fill();

    // Right visible face
    ctx.beginPath();
    ctx.moveTo(t2.x, t2.y); ctx.lineTo(t3.x, t3.y); ctx.lineTo(b3.x, b3.y); ctx.lineTo(b2.x, b2.y);
    ctx.closePath(); ctx.fillStyle = rightColor; ctx.fill();

    // Top face
    ctx.beginPath();
    ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.lineTo(t3.x, t3.y); ctx.lineTo(t4.x, t4.y);
    ctx.closePath(); ctx.fillStyle = topColor; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Vault Filing Cabinets
  drawIsoBox(-1.6, -4.8, 0.9, 0.9, 1.5, '#64748b', '#334155', '#475569');
  drawIsoBox(-0.3, -4.8, 0.9, 0.9, 1.5, '#64748b', '#334155', '#475569');
  drawIsoBox(1.0, -4.8, 0.9, 0.9, 1.5, '#64748b', '#334155', '#475569');

  // Desks
  drawIsoBox(-5.8, -1.6, 2.2, 1.1, 0.8, '#7c2d12', '#431407', '#5c240e'); // Executive Desk
  drawIsoBox(-6.3, -1.5, 0.25, 0.15, 0.92, '#ef4444', '#b91c1c', '#dc2626'); // Red Stapler!
  drawIsoBox(-2.2, 2.3, 1.7, 0.9, 0.75, '#9a6b43', '#5c3a21', '#7c5333'); // Chief of Staff
  drawIsoBox(5.2, -3.2, 3.0, 1.6, 0.75, '#6d4c3d', '#3e2723', '#4e342e'); // War Room Table
  drawIsoBox(2.6, 2.7, 1.6, 0.9, 0.75, '#9a6b43', '#5c3a21', '#7c5333');  // Scout
  drawIsoBox(5.4, 2.7, 1.6, 0.9, 0.75, '#9a6b43', '#5c3a21', '#7c5333');  // Chloe
  drawIsoBox(4.0, 5.2, 1.6, 0.9, 0.75, '#9a6b43', '#5c3a21', '#7c5333');  // Devon

  // Draw 2D Vector Actor Sprites
  actorMeshes.forEach((mesh) => {
    const actor = appState?.actors.find(a => a.id === mesh.userData.actorId);
    if (!actor) return;
    const base = isoPt(mesh.position.x, 0, mesh.position.z);
    const head = isoPt(mesh.position.x, 1.25, mesh.position.z);

    // Shadow
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, 14, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();

    // Body pill
    ctx.beginPath();
    ctx.roundRect(base.x - 10, head.y + 8, 20, base.y - head.y - 6, 8);
    ctx.fillStyle = actor.avatar_color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Head circle
    ctx.beginPath();
    ctx.arc(head.x, head.y + 4, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#f1c27d';
    ctx.fill();
    ctx.stroke();

    // Manila folder icon if carrying
    if (actor.carrying_folder) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(base.x + 8, head.y + 14, 12, 9);
    }
  });
}

// ============================================================================
// 4. ANIMATION LOOP & CAMERA CONTROLS
// ============================================================================
function focusCameraOn(x, z, zoomLevel = 1.25) {
  camControl.goalTarget.set(x, 0.5, z);
  camControl.goalZoom = zoomLevel;
}

threeCanvas.addEventListener('pointerdown', (e) => {
  camControl.isDragging = true;
  camControl.lastX = e.clientX;
  camControl.lastY = e.clientY;
});

window.addEventListener('pointermove', (e) => {
  if (!camControl.isDragging) return;
  const dx = e.clientX - camControl.lastX;
  const dy = e.clientY - camControl.lastY;
  camControl.lastX = e.clientX;
  camControl.lastY = e.clientY;
  camControl.goalAzimuth -= dx * 0.006;
  camControl.goalElevation = Math.max(0.35, Math.min(1.25, camControl.goalElevation + dy * 0.005));
});

window.addEventListener('pointerup', () => {
  camControl.isDragging = false;
});

stageEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  camControl.goalZoom = Math.max(0.65, Math.min(2.1, camControl.goalZoom + delta));
}, { passive: false });

function handleResize() {
  const w = stageEl.clientWidth;
  const h = Math.max(1, stageEl.clientHeight);
  const asp = w / h;
  camera.left = (-frustumSize * asp) / 2;
  camera.right = (frustumSize * asp) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  vectorCanvas.width = w;
  vectorCanvas.height = h;
}
window.addEventListener('resize', handleResize);

let clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.getElapsedTime();

  // Smooth camera interpolation
  camControl.azimuth += (camControl.goalAzimuth - camControl.azimuth) * 0.12;
  camControl.elevation += (camControl.goalElevation - camControl.elevation) * 0.12;
  camControl.zoom += (camControl.goalZoom - camControl.zoom) * 0.12;
  camControl.target.lerp(camControl.goalTarget, 0.12);

  const radius = 24;
  camera.position.x = camControl.target.x + radius * Math.cos(camControl.elevation) * Math.sin(camControl.azimuth);
  camera.position.y = camControl.target.y + radius * Math.sin(camControl.elevation);
  camera.position.z = camControl.target.z + radius * Math.cos(camControl.elevation) * Math.cos(camControl.azimuth);
  camera.zoom = camControl.zoom;
  camera.lookAt(camControl.target);
  camera.updateProjectionMatrix();

  // Animate Server Rack LEDs in Shared Memory Vault
  serverLedMeshes.forEach((led, idx) => {
    led.visible = Math.sin(elapsed * 4 + idx * 1.7) > -0.4;
  });

  // Smoothly walk actors toward their target positions
  actorMeshes.forEach((mesh) => {
    const tx = typeof mesh.userData.targetX === 'number' ? mesh.userData.targetX : mesh.position.x;
    const tz = typeof mesh.userData.targetZ === 'number' ? mesh.userData.targetZ : mesh.position.z;
    const dx = tx - mesh.position.x;
    const dz = tz - mesh.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.04) {
      const speed = Math.min(dist, dt * 3.2);
      mesh.position.x += (dx / dist) * speed;
      mesh.position.z += (dz / dist) * speed;
      mesh.rotation.y = Math.atan2(dx, dz);

      // Swing arms & legs while walking
      mesh.userData.walkPhase += dt * 11;
      const swing = Math.sin(mesh.userData.walkPhase) * 0.45;
      mesh.userData.leftLeg.rotation.x = swing;
      mesh.userData.rightLeg.rotation.x = -swing;
      mesh.userData.leftArm.rotation.x = -swing * 0.7;
      mesh.userData.rightArm.rotation.x = swing * 0.7;
    } else {
      // Idle gentle breathing
      mesh.userData.leftLeg.rotation.x *= 0.85;
      mesh.userData.rightLeg.rotation.x *= 0.85;
      mesh.userData.leftArm.rotation.x *= 0.85;
      mesh.userData.rightArm.rotation.x *= 0.85;
    }
  });

  if (viewMode === '3d') {
    renderer.render(scene, camera);
  } else {
    render2DVectorFloorplan();
  }

  // Update Floating DOM Positions
  domZoneEls.forEach(({ el, zone }) => {
    const pos = projectToScreen(zone.x, zone.y, zone.z);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  });

  domActorEls.forEach(({ el }, actorId) => {
    const mesh = actorMeshes.get(actorId);
    if (!mesh) return;
    const pos = projectToScreen(mesh.position.x, 1.55, mesh.position.z);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  });
}

animate();

// ============================================================================
// 5. UI RENDERING (EXECUTIVE DESK, CHAT, SHARED MEMORY VAULT, SOPS, PHONE SMS)
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
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showOfficeToast._timer);
  showOfficeToast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 5200);
}

function renderFullUI(state) {
  appState = state;
  sync3DSceneWithState(state);
  rebuildActorDomOverlays(state);

  // Top HUD Bar
  document.getElementById('workspace-tagline').textContent = state.workspace.tagline;
  const pendingApprovals = state.approvals.filter(a => a.status === 'pending');
  const pendingBuilds = (state.buildTickets || []).filter(b => b.status === 'pending_boss');
  const budget = state.workspace.budget || { shiftsUsed: 1, maxShiftsPerDay: 4, costUsd: 0.012, dailyBudgetUsd: 0.50, simulationMode: true, ownerEmail: 'boss@tiberius.site' };

  const sandboxText = document.getElementById('pill-sandbox-text');
  if (sandboxText) {
    sandboxText.textContent = budget.simulationMode
      ? '🧪 SANDBOX: SIMULATED TASKS ($0 RISK)'
      : '🟢 LIVE OUTREACH UNLOCKED';
  }

  const budgetText = document.getElementById('pill-budget-text');
  if (budgetText) {
    budgetText.textContent = `SHIFT ${budget.shiftsUsed}/${budget.maxShiftsPerDay} • $${budget.costUsd.toFixed(3)} / $${budget.dailyBudgetUsd.toFixed(2)} CAP`;
  }

  const pillText = document.getElementById('pill-approvals-text');
  const pillBtn = document.getElementById('pill-desk-approvals');
  pillText.textContent = `${pendingApprovals.length} ON DESK • ${pendingBuilds.length} BUILD SPECS`;
  pillBtn.classList.toggle('urgent', pendingApprovals.length > 0 || pendingBuilds.length > 0);

  document.getElementById('badge-pending-count').textContent = String(pendingApprovals.length);
  const buildBadge = document.getElementById('badge-build-count');
  if (buildBadge) buildBadge.textContent = String(pendingBuilds.length);
  const emailBadge = document.getElementById('badge-email-count');
  if (emailBadge) emailBadge.textContent = String((state.bossEmails || []).length);

  const llmBtn = document.getElementById('btn-sms-settings');
  if (llmBtn && state.workspace.llm_status) {
    llmBtn.textContent = state.workspace.llm_status.active
      ? `🧠 ${state.workspace.llm_status.provider.toUpperCase()} • Cap $${budget.dailyBudgetUsd.toFixed(2)}`
      : `🧠 AI Cap & Comms`;
  }

  // 1. Render Approvals List (Tab 1: On Your Desk)
  const approvalsEl = document.getElementById('approvals-list-container');
  if (state.approvals.length === 0) {
    approvalsEl.innerHTML = `<div class="beat-box">Your desk is completely clear! Click <strong>+ Run Prospect Teardown</strong> to put the squad to work.</div>`;
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
              ${isPending ? '⏳ WAITING FOR APPROVE & SEND' : `✓ ${escapeHtml(app.status.toUpperCase().replace('_', ' & '))}`}
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
            <span class="beat-label">2. What We Prepared (Editable Outbound Payload)</span>
            <div style="margin-bottom:5px;">${escapeHtml(app.what_prepared)}</div>
            <textarea id="draft-${escapeHtml(app.id)}" class="draft-textarea" ${isPending ? '' : 'readonly'}>${escapeHtml(app.draft_payload)}</textarea>
          </div>

          <div class="sop-checks-list">
            ${checksHtml}
          </div>

          ${isPending ? `
            <div class="beat-box" style="border-color:rgba(16,185,129,0.35);background:rgba(6,78,59,0.22);color:#d1fae5;">
              <span class="beat-label" style="color:#34d399;">3. Recommended Action</span>
              ${escapeHtml(app.recommended_action)}
            </div>
            <div class="approval-actions-row">
              <button class="btn-approve-send" data-action="approve" data-id="${escapeHtml(app.id)}">
                <span>✓ Approve & Send (${escapeHtml(app.code)})</span>
              </button>
              <button class="btn-secondary-action" data-action="hold" data-id="${escapeHtml(app.id)}">
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

  // 1b. Render Architect Build-Out Queue & Shift Cost Ledger (Tab 2: Build-Out)
  const budgetBox = document.getElementById('budget-ledger-box');
  if (budgetBox) {
    const pct = Math.min(100, Math.round((budget.costUsd / Math.max(0.01, budget.dailyBudgetUsd)) * 100));
    budgetBox.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:800;color:#38bdf8;">⏱️ Chief of Staff (Argon-High) Daily Shift & Cost Meter</span>
        <span class="approval-code">${budget.shiftsUsed} / ${budget.maxShiftsPerDay} Shifts Today</span>
      </div>
      <div style="font-size:11.5px;color:#cbd5e1;margin-bottom:6px;">
        • <strong>Marcus API Spend Today:</strong> <strong style="color:#34d399;">$${budget.costUsd.toFixed(3)}</strong> of <strong>$${budget.dailyBudgetUsd.toFixed(2)} hard daily cap</strong> (${budget.tokensIn.toLocaleString()} in / ${budget.tokensOut.toLocaleString()} out tokens)<br/>
        • <strong>Continuous Worker Layer (@scout, @chloe, @devon):</strong> <strong style="color:#34d399;">$0.00 token cost</strong> (local Node/SQLite automations)<br/>
        • <strong>Comms Rule:</strong> Short text (&lt;180 chars) via SMS • Detailed reports &amp; Build Specs via Email (<code>${escapeHtml(budget.ownerEmail)}</code>)
      </div>
      <div style="width:100%;height:7px;background:#0f172a;border-radius:999px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#10b981,#38bdf8);"></div>
      </div>
    `;
  }

  // 1b-ii. Render Marcus Browser Eye Screenshots (Mobile 390x844 + Desktop 1440x900)
  const browserObsEl = document.getElementById('browser-observations-container');
  if (browserObsEl) {
    const obsList = state.browserObservations || [];
    const assetBase = window.location.pathname.startsWith('/office') ? '/office' : '';
    if (obsList.length === 0) {
      browserObsEl.innerHTML = `<div class="beat-box" style="font-size:11.5px;color:#94a3b8;">No browser runs yet. Click <strong>📸 Test UI Now</strong> above or text Marcus <code>"Browse http://localhost:3847"</code> to capture live Mobile &amp; Desktop screenshots.</div>`;
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
              ${shot ? `<a href="${escapeHtml(shot)}" target="_blank" title="Click to open full-res screenshot"><img src="${escapeHtml(shot)}${shot.includes('?') ? '&' : '?'}t=${encodeURIComponent(ob.created_at)}" alt="${escapeHtml(vp)} screenshot" /></a>` : ''}
              <div style="font-size:10.5px;color:#cbd5e1;line-height:1.35;">${escapeHtml(summaryText)}</div>
            </div>
            `;
          }).join('')}
        </div>
      `;
    }
  }

  // 1b-iii. Render Mobile Deploy & Texting Modal Body
  const deployBodyEl = document.getElementById('mobile-deploy-body');
  if (deployBodyEl && state.deploy) {
    const dep = state.deploy;
    const vercelProdUrl = 'https://tiberius.ai/office';
    const primaryUrl = window.location.hostname.includes('tiberius.ai')
      ? window.location.href
      : (dep.publicHttpsUrl || vercelProdUrl);
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(primaryUrl)}`;
    deployBodyEl.innerHTML = `
      <div style="display:flex;gap:14px;align-items:center;background:#0b0f17;padding:12px;border-radius:10px;border:1px solid rgba(16,185,129,0.35);">
        <img src="${qrSrc}" alt="Mobile QR Code" style="width:124px;height:124px;border-radius:8px;background:#fff;padding:6px;flex-shrink:0;" />
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="font-size:12.5px;font-weight:800;color:#6ee7b7;">📱 Scan QR on Your Phone (Works Anywhere!)</div>
          <div style="font-size:11.5px;">
            • <strong>Production Domain (Vercel + GitHub):</strong><br/>
            <a href="${vercelProdUrl}" target="_blank" style="color:#34d399;font-weight:700;font-family:var(--font-mono);">${vercelProdUrl}</a>
          </div>
          ${dep.publicHttpsUrl ? `<div style="font-size:11.5px;">
            • <strong>Workstation Live HTTPS Tunnel:</strong><br/>
            <a href="${escapeHtml(dep.publicHttpsUrl)}" target="_blank" style="color:#38bdf8;font-family:var(--font-mono);word-break:break-all;">${escapeHtml(dep.publicHttpsUrl)}</a>
          </div>` : ''}
          ${dep.lanUrl ? `<div style="font-size:11.5px;">
            • <strong>Local Wi-Fi LAN URL:</strong> <a href="${escapeHtml(dep.lanUrl)}" target="_blank" style="color:#93c5fd;font-family:var(--font-mono);">${escapeHtml(dep.lanUrl)}</a>
          </div>` : ''}
        </div>
      </div>

      <div class="beat-box" style="border-color:rgba(56,189,248,0.4);">
        <span class="beat-label" style="color:#38bdf8;">💬 3 Ways to Text Marcus (While You're at Work)</span>
        1. <strong>Direct Mobile Web App (Zero Carrier Setup):</strong> Open <a href="${vercelProdUrl}" target="_blank" style="color:#38bdf8;">tiberius.ai/office</a> on your phone and tap <strong>💬 Text Marcus</strong> on the bottom bar. It acts like a native messaging app with instant 1-tap replies (<code>"B1"</code>, <code>"1"</code>, <code>"Shift"</code>, <code>"Browse https://..."</code>).<br/>
        2. <strong>Outbound Real SMS to Your Phone:</strong> Click <strong>🧠 AI Cap &amp; Comms</strong> and enter your mobile number + Textbelt key (use key <code>textbelt</code> for 1 free real carrier text/day, or a paid key).<br/>
        3. <strong>Two-Way Carrier SMS Webhook (Twilio / GHL / Telnyx):</strong> Point your SMS number's incoming webhook URL to:<br/>
        <code style="color:#6ee7b7;word-break:break-all;">https://tiberius.ai/api/office/sms/webhook</code>
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
            <span class="beat-label">What Marcus Observed (Browser + Simulated Runs)</span>
            ${escapeHtml(bt.what_marcus_observed)}
          </div>
          <div class="beat-box" style="border-color:rgba(56,189,248,0.3);background:#0b0f17;font-family:var(--font-mono);font-size:11px;color:#93c5fd;">
            <span class="beat-label" style="color:#38bdf8;">Architect Prompt Prepared for Antigravity</span>
            ${escapeHtml(bt.architect_prompt)}
          </div>
          ${isPending ? `
            <div class="approval-actions-row">
              <button class="btn-approve-send" style="background:linear-gradient(135deg,#0284c7,#2563eb);" data-build-action="approve" data-build-id="${escapeHtml(bt.id)}">
                ✓ Approve Build Spec (${escapeHtml(bt.code)})
              </button>
              <button class="btn-secondary-action" data-build-action="hold" data-build-id="${escapeHtml(bt.id)}">
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
        if (data.ok) {
          showOfficeToast(`🛠️ ${data.shortSms}`);
        }
      });
    });
  }

  // 1c. Render Detailed Executive Emails (Tab 3: Emails + Phone Email Inbox)
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
        <strong>📱 Short Companion SMS Sent to Your Phone (${em.summary_sms_sent.length} chars):</strong><br/>
        "${escapeHtml(em.summary_sms_sent)}"
      </div>
      <div class="beat-box" style="white-space:pre-wrap;font-size:12px;line-height:1.5;color:#e2e8f0;">${formatSimpleMarkdown(em.body_markdown)}</div>
    </div>
  `).join('');

  if (emailsEl) emailsEl.innerHTML = emailsHtml || '<div class="beat-box">No detailed emails yet.</div>';
  if (phoneEmailsEl) phoneEmailsEl.innerHTML = emailsHtml || '<div class="beat-box">No detailed emails yet.</div>';

  // 2. Render Chief of Staff Office Chat (Tab 4)
  const chatListEl = document.getElementById('chat-messages-list');
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

  // 3. Render Shared Memory Vault (Tab 3: Rules + Dossiers)
  const factsEl = document.getElementById('memory-facts-container');
  factsEl.innerHTML = state.memoryFacts.map(f => `
    <div class="memory-fact-card">
      <div><strong>[${escapeHtml(f.category)}]</strong> ${escapeHtml(f.fact)}</div>
      <div class="memory-fact-meta">Synced by ${escapeHtml(f.added_by)} • Shared across all Agents & Human Users</div>
    </div>
  `).join('');

  const dossiersEl = document.getElementById('dossiers-container');
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
          <span class="beat-label">Shared Human + Agent Memory Log</span>
          ${notesHtml}
          <div style="display:flex;gap:6px;margin-top:4px;">
            <input type="text" class="chat-input" style="padding:5px 8px;font-size:11.5px;" placeholder="Add shared note to ${escapeHtml(d.client_name)} dossier..." id="note-input-${escapeHtml(d.id)}" />
            <button class="cam-btn" data-add-note="${escapeHtml(d.id)}">+ Log Note</button>
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
      showOfficeToast('🗄️ Added note to Shared Memory Vault dossier!');
    });
  });

  // 4. Render SOP Playbooks (Tab 4)
  const sopsEl = document.getElementById('sops-container');
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
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Owner: ${escapeHtml(sop.department)} • Strict Protocol Enforcement: ON</div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(sop.description)}</div>
        <div class="beat-box">${stepsHtml}</div>
      </div>
    `;
  }).join('');

  // 5. Render iPhone SMS Simulator Thread
  const phoneMsgsEl = document.getElementById('phone-messages-list');
  const smsMsgs = state.messages.filter(m => m.channel === 'sms_bridge');
  phoneMsgsEl.innerHTML = smsMsgs.map(m => {
    const isOutgoing = m.direction === 'sms_inbound';
    return `<div class="sms-bubble ${isOutgoing ? 'outgoing' : 'incoming'}">${escapeHtml(m.text)}</div>`;
  }).join('');
  phoneMsgsEl.scrollTop = phoneMsgsEl.scrollHeight;

  const cos = state.actors.find(a => a.desk_zone === 'chief_of_staff');
  if (cos) {
    document.getElementById('phone-contact-name').textContent = `${cos.name.split(' ')[0]} • Chief of Staff`;
  }
  document.getElementById('phone-owner-number').textContent = `To: ${state.workspace.owner_phone} • Reply "1" to Approve`;
}

// ============================================================================
// 6. API ACTIONS & EVENT WIRING (Supports Both Local Server & Vercel /office)
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

// Connect Server-Sent Events (SSE) Locally or Lightweight Sync on Vercel
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

// Tab Switching in Executive Drawer
function switchDrawerTab(tabId) {
  const drawer = document.getElementById('executive-drawer');
  drawer.classList.remove('collapsed');
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

// Top HUD Switchers & Buttons
document.getElementById('workspace-select').addEventListener('change', (e) => {
  currentWorkspaceId = e.target.value;
  loadWorkspaceState();
  showOfficeToast(`🏢 Switched Office Floor to ${e.target.options[e.target.selectedIndex].text}`);
});

document.getElementById('btn-mode-3d').addEventListener('click', () => {
  viewMode = '3d';
  document.getElementById('btn-mode-3d').classList.add('active');
  document.getElementById('btn-mode-2d').classList.remove('active');
  threeCanvas.classList.remove('hidden');
  vectorCanvas.classList.add('hidden');
  handleResize();
});

document.getElementById('btn-mode-2d').addEventListener('click', () => {
  viewMode = '2d';
  document.getElementById('btn-mode-2d').classList.add('active');
  document.getElementById('btn-mode-3d').classList.remove('active');
  vectorCanvas.classList.remove('hidden');
  threeCanvas.classList.add('hidden');
  handleResize();
});

document.getElementById('btn-toggle-drawer').addEventListener('click', () => {
  const drawer = document.getElementById('executive-drawer');
  drawer.classList.toggle('collapsed');
  setTimeout(handleResize, 240);
});

document.getElementById('btn-toggle-phone').addEventListener('click', () => {
  document.getElementById('phone-dock').classList.toggle('hidden');
});
document.getElementById('pill-sms-status')?.addEventListener('click', () => {
  document.getElementById('phone-dock').classList.remove('hidden');
});
document.getElementById('btn-close-phone').addEventListener('click', () => {
  document.getElementById('phone-dock').classList.add('hidden');
});

// Marcus Browser Eye Button (Live Playwright + Headless Edge Mobile & Desktop Inspection)
document.getElementById('btn-run-browser-eye')?.addEventListener('click', async () => {
  const urlInput = document.getElementById('input-browser-url');
  const targetUrl = (urlInput && urlInput.value.trim()) || window.location.origin;
  showOfficeToast(`👁️ Marcus is launching his headless browser to test & screenshot ${targetUrl} (Mobile + Desktop)...`);
  const data = await apiPost('/browser/inspect', {
    workspaceId: currentWorkspaceId,
    url: targetUrl,
    viewport: 'both',
    notifySms: true
  });
  if (data.ok) {
    showOfficeToast(`📸 Marcus Browser Eye: Mobile & Desktop screenshots captured for ${targetUrl}!`);
  }
});

// Mobile Deployment & Texting Modal
const modalMobile = document.getElementById('modal-mobile-deploy');
document.getElementById('btn-mobile-deploy')?.addEventListener('click', () => {
  modalMobile?.classList.remove('hidden');
});
document.getElementById('close-modal-mobile')?.addEventListener('click', () => modalMobile?.classList.add('hidden'));
document.getElementById('cancel-modal-mobile')?.addEventListener('click', () => modalMobile?.classList.add('hidden'));

// Mobile Bottom Navigation Bar (for Smartphone Viewports)
document.querySelectorAll('[data-mobile-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-mobile-view');
    document.querySelectorAll('[data-mobile-view]').forEach(b => b.classList.toggle('active', b === btn));
    const phoneDock = document.getElementById('phone-dock');
    const drawer = document.getElementById('executive-drawer');

    if (view === 'phone') {
      phoneDock.classList.remove('hidden');
    } else if (view === 'floor') {
      phoneDock.classList.add('hidden');
      drawer.classList.add('collapsed');
      setTimeout(handleResize, 120);
    } else if (view === 'desk') {
      phoneDock.classList.add('hidden');
      switchDrawerTab('tab-desk');
    } else if (view === 'build') {
      phoneDock.classList.add('hidden');
      switchDrawerTab('tab-build');
    } else if (view === 'emails') {
      phoneDock.classList.add('hidden');
      switchDrawerTab('tab-emails');
    }
  });
});

document.getElementById('pill-desk-approvals').addEventListener('click', () => {
  switchDrawerTab('tab-desk');
  focusCameraOn(-5.6, -1.6, 1.35);
});
document.getElementById('pill-shift-budget')?.addEventListener('click', () => {
  switchDrawerTab('tab-build');
});
document.getElementById('pill-sandbox-mode')?.addEventListener('click', () => {
  document.getElementById('modal-sms-settings').classList.remove('hidden');
});

// Run Marcus Executive Shift Button
async function triggerMarcusExecutiveShift() {
  showOfficeToast('⏱️ Marcus clocked in for a 30s Argon-High Shift: reviewing $0 worker runs & browser UI...');
  const data = await apiPost('/shifts/run', { workspaceId: currentWorkspaceId, reason: 'Executive Build-Out & Ops Shift' });
  if (data.ok) {
    document.getElementById('phone-dock').classList.remove('hidden');
    switchDrawerTab('tab-build');
    showOfficeToast(`✅ Shift ${data.shiftNumber} complete ($${data.costUsd} API cost)! Short SMS texted & full report emailed (${data.ticketCode}).`);
  } else if (data.blockedByCap) {
    showOfficeToast(data.message);
  }
}

document.getElementById('btn-run-shift')?.addEventListener('click', triggerMarcusExecutiveShift);
document.getElementById('btn-run-shift-inline')?.addEventListener('click', triggerMarcusExecutiveShift);

// Phone SMS vs Email Toggle inside iPhone Simulator
document.getElementById('phone-tab-sms')?.addEventListener('click', () => {
  document.getElementById('phone-messages-list').classList.remove('hidden');
  document.getElementById('phone-emails-list').classList.add('hidden');
  document.getElementById('phone-tab-sms').style.background = '#2563eb';
  document.getElementById('phone-tab-sms').style.color = '#fff';
  document.getElementById('phone-tab-email').style.background = '';
});

document.getElementById('phone-tab-email')?.addEventListener('click', () => {
  document.getElementById('phone-emails-list').classList.remove('hidden');
  document.getElementById('phone-messages-list').classList.add('hidden');
  document.getElementById('phone-tab-email').style.background = '#a855f7';
  document.getElementById('phone-tab-email').style.color = '#fff';
  document.getElementById('phone-tab-sms').style.background = '';
});

// Proactive SMS Nudge Button
document.getElementById('btn-sms-nudge').addEventListener('click', async () => {
  document.getElementById('phone-dock').classList.remove('hidden');
  await apiPost('/reminders/trigger', { workspaceId: currentWorkspaceId });
  showOfficeToast('📱 Chief of Staff just texted an SMS reminder to your phone!');
});

// Camera & Floor Choreography Buttons
document.getElementById('cam-reset').addEventListener('click', () => {
  camControl.goalTarget.set(0, 0.5, 0);
  camControl.goalAzimuth = Math.PI / 4;
  camControl.goalElevation = 0.68;
  camControl.goalZoom = 1.0;
});
document.getElementById('cam-boss').addEventListener('click', () => {
  focusCameraOn(-5.6, -1.6, 1.45);
  switchDrawerTab('tab-desk');
});
document.getElementById('cam-vault').addEventListener('click', () => {
  focusCameraOn(-0.2, -3.8, 1.35);
  switchDrawerTab('tab-vault');
});

let inHuddle = false;
document.getElementById('cam-warroom').addEventListener('click', async () => {
  inHuddle = !inHuddle;
  if (inHuddle) focusCameraOn(4.8, -3.0, 1.3);
  else focusCameraOn(0, 0.5, 1.0);
  await apiPost('/office/huddle', { workspaceId: currentWorkspaceId, mode: inHuddle ? 'huddle' : 'return' });
  showOfficeToast(inHuddle
    ? '🤝 All agents gathering in the War Room for a Shared Memory Standup!'
    : '🏃 Agents returning to their department stations!');
});

// Red Swingline Stapler Easter Egg!
document.getElementById('cam-stapler').addEventListener('click', () => {
  focusCameraOn(-6.2, -1.5, 1.85);
  showOfficeToast('📎 Marcus: "Nobody touches your red Swingline stapler, boss — and every TPS report has its SOP cover sheet."');
});

// Office Chat Form & Quick Chips
document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const inp = document.getElementById('chat-input');
  const txt = inp.value;
  inp.value = '';
  await sendChatOrSmsMessage(txt, 'office_chat');
});

document.querySelectorAll('.prompt-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const prompt = chip.getAttribute('data-prompt');
    sendChatOrSmsMessage(prompt, 'office_chat');
  });
});

// Phone SMS Simulator Form & Quick Chips
document.getElementById('phone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const inp = document.getElementById('phone-input');
  const txt = inp.value;
  inp.value = '';
  await sendChatOrSmsMessage(txt, 'sms_bridge');
});

document.querySelectorAll('.sms-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const sms = chip.getAttribute('data-sms');
    sendChatOrSmsMessage(sms, 'sms_bridge');
  });
});

// Add Institutional Rule Inline Button
document.getElementById('btn-add-rule-inline').addEventListener('click', () => {
  switchDrawerTab('tab-chat');
  const inp = document.getElementById('chat-input');
  inp.value = 'Remember: ';
  inp.focus();
});

// Modal 1: Launch New Prospect Teardown
const modalProspect = document.getElementById('modal-prospect');
document.getElementById('btn-new-prospect').addEventListener('click', () => {
  modalProspect.classList.remove('hidden');
  document.getElementById('input-prospect-url').focus();
});
document.getElementById('close-modal-prospect').addEventListener('click', () => modalProspect.classList.add('hidden'));
document.getElementById('cancel-modal-prospect').addEventListener('click', () => modalProspect.classList.add('hidden'));

document.getElementById('form-launch-prospect').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prospectName = document.getElementById('input-prospect-name').value.trim();
  const vertical = document.getElementById('input-prospect-vertical').value.trim();
  const websiteUrl = document.getElementById('input-prospect-url').value.trim();
  if (!prospectName && !websiteUrl) return;

  modalProspect.classList.add('hidden');
  document.getElementById('input-prospect-name').value = '';
  document.getElementById('input-prospect-url').value = '';

  showOfficeToast(`🌐 @scout is scraping ${websiteUrl || prospectName} live and running SOP-01...`);

  const data = await apiPost('/jobs/launch', { workspaceId: currentWorkspaceId, prospectName, vertical, websiteUrl });
  if (data.ok) {
    switchDrawerTab('tab-desk');
    const modeNote = data.telemetry?.scrapedLive
      ? `(${data.telemetry.httpStatus} OK in ${data.telemetry.responseMs}ms)`
      : '';
    showOfficeToast(`🚀 @scout audited ${websiteUrl || prospectName} ${modeNote} & @marcus placed Approval ${data.code} on your desk!`);
  }
});

// Modal 2: Live AI Brain & SMS Setup
const modalSms = document.getElementById('modal-sms-settings');
document.getElementById('btn-sms-settings').addEventListener('click', () => modalSms.classList.remove('hidden'));
document.getElementById('close-modal-sms').addEventListener('click', () => modalSms.classList.add('hidden'));
document.getElementById('cancel-modal-sms').addEventListener('click', () => modalSms.classList.add('hidden'));

document.getElementById('form-sms-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ownerPhone = document.getElementById('input-owner-phone').value.trim();
  const ownerEmail = document.getElementById('input-owner-email')?.value.trim() || 'boss@tiberius.site';
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
  modalSms.classList.add('hidden');
  showOfficeToast('🧠 Saved Daily Shift Cap, Sandbox Mode, Short SMS & Email Configuration!');
});

// Initialize
handleResize();
loadWorkspaceState();
connectSSE();
