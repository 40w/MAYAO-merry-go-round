import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================
// COLOR UTILS — desaturate hex by factor (0–1)
// ============================================
function hexToHsl(hex) {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h, s, l };
}
function hslToHex({ h, s, l }) {
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const nr = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const ng = Math.round(hue2rgb(p, q, h) * 255);
    const nb = Math.round(hue2rgb(p, q, h - 1/3) * 255);
    return (nr << 16) | (ng << 8) | nb;
}
function desaturateHex(hex, factor = 0.20) {
    const hsl = hexToHsl(hex);
    hsl.s = Math.max(0, hsl.s * (1 - factor));
    return hslToHex(hsl);
}

// ============================================
// SEEN TRACKING â€” which cutouts have been clicked
// ============================================
let seenIndices = new Set();
try {
    const raw = localStorage.getItem('mayao-seen');
    if (raw) seenIndices = new Set(JSON.parse(raw));
} catch(e) {}

function markSeen(idx) {
    if (!seenIndices.has(idx)) {
        seenIndices.add(idx);
        localStorage.setItem('mayao-seen', JSON.stringify([...seenIndices]));
    }
}

// ============================================
// DATA â€” load from localStorage (shared with admin/submit)
// ============================================
const SHAPE_DEFS = {
    text:  { shape: 'circle',   color: 0xffffff, glow: 0xf0f0f0, label: 'Text' },
    audio: { shape: 'triangle', color: desaturateHex(0x00ffff), glow: desaturateHex(0x00e0e0), label: 'Audio' },
    image: { shape: 'longrect', color: desaturateHex(0xffff00), glow: desaturateHex(0xe0e000), label: 'Image' },
    video: { shape: 'ring',     color: desaturateHex(0xff00ff), glow: desaturateHex(0xe000e0), label: 'Video' },
    wish:  { shape: 'petal',    color: desaturateHex(0xb8ffd0), glow: desaturateHex(0x90f0b8), label: 'Wish' }
};

function formatDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function normalizeMessage(m) {
    if (m.title !== undefined) {
        return { id: m.id, type: m.type, title: m.title, content: m.content, author: m.author || 'Anonymous', date: m.date };
    }
    // Convert from admin/supabase format
    const date = m.timestamp ? formatDate(m.timestamp) : '2026.04.01';
    let title = '';
    let content = m.content || '';
    const type = m.type || 'text';

    if (type === 'text') {
        title = content.slice(0, 36) + (content.length > 36 ? '...' : '');
    } else {
        title = content.slice(0, 36) || 'Untitled';
        content = m.media_url || m.mediaUrl || m.mediaData || content || '';
    }
    return { id: m.id || Date.now(), type, title, content, author: m.author || 'Anonymous', date };
}

let messages = [];
let viewMode = 'panorama';
let selectedIdx = -1;
let demoMode = false;
let demoTimer = null;
let demoIndex = 0;

function assignPositions() {
    const rows = 3;
    messages.forEach((msg, i) => {
        const row = i % rows;
        const perRow = Math.ceil(messages.length / rows);
        const idx = Math.floor(i / rows);
        msg._pos = {
            angle: (idx / perRow) * Math.PI * 2 + row * 0.35,
            y: 2.0 - 0.35 - row * 0.65,
            stringLen: (0.7 + row * 0.45 + Math.random() * 0.25) * 0.9,
            row
        };
    });
}
// assignPositions() is called after Supabase data loads

// ============================================
// SCENE
// ============================================
const ROOM_RADIUS = 9;
const RING_RADIUS = 1.7;
const RING_Y = 2.0;

const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f2ee);
scene.fog = new THREE.Fog(0xf5f2ee, 10, 22);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 2.2, 9.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 4;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.72;
controls.minPolarAngle = Math.PI * 0.22;
controls.enablePan = false;
controls.target.set(0, 1.0, 0);

// ============================================
// MATERIALS
// ============================================
const wallMat = new THREE.MeshStandardMaterial({ color: 0xeae7e3, roughness: 0.65, metalness: 0, side: THREE.BackSide });
const floorMat = new THREE.MeshStandardMaterial({ color: 0xf5f2ee, roughness: 0.92, metalness: 0 });
const ringMat = new THREE.MeshStandardMaterial({ color: 0xf0eeeb, roughness: 0.35, metalness: 0.06 });
const stringMat = new THREE.MeshStandardMaterial({ color: 0xeae7e3, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.82 });
const orbCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff8f0, transparent: true, opacity: 0.95 });

// ============================================
// ROOM
// ============================================
// (Shader materials created below after projection shader definitions)
const wall = new THREE.Mesh(new THREE.CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, 9, 56, 1, true), null); // mat assigned later
wall.position.y = 1;
scene.add(wall);

const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM_RADIUS * 2, 56), null); // mat assigned later
floor.rotation.x = -Math.PI / 2;
floor.position.y = -3.5;
scene.add(floor);

const ceiling = new THREE.Mesh(new THREE.CircleGeometry(ROOM_RADIUS, 56), null); // mat assigned later
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 5.5;
scene.add(ceiling);

// ============================================
// MOBILE
// ============================================
const mobileGroup = new THREE.Group();
scene.add(mobileGroup);

// ============================================
// DUST PARTICLES — floating motes in light beam (gallery atmosphere)
// ============================================
const DUST_COUNT = 120;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_COUNT * 3);
const dustSpeed = new Float32Array(DUST_COUNT * 3);
for (let i = 0; i < DUST_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const radius = Math.random() * 2.5;
    dustPos[i*3]   = Math.cos(theta) * radius;
    dustPos[i*3+1] = RING_Y - 0.3 + (Math.random() - 0.5) * 3.5;
    dustPos[i*3+2] = Math.sin(theta) * radius;
    dustSpeed[i*3]   = (Math.random() - 0.5) * 0.0008;
    dustSpeed[i*3+1] = (Math.random() - 0.5) * 0.0006;
    dustSpeed[i*3+2] = (Math.random() - 0.5) * 0.0008;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({
    color: 0xfff5ee,
    size: 0.018,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
});
const dustParticles = new THREE.Points(dustGeo, dustMat);
scene.add(dustParticles);

const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, 0.032, 12, 72), ringMat);
ring.rotation.x = Math.PI / 2;
ring.position.y = RING_Y;
mobileGroup.add(ring);

const barG = new THREE.CylinderGeometry(0.01, 0.01, RING_RADIUS * 2, 6);
const bar1 = new THREE.Mesh(barG, ringMat); bar1.rotation.z = Math.PI / 2; bar1.position.y = RING_Y; mobileGroup.add(bar1);
const bar2 = new THREE.Mesh(barG, ringMat); bar2.rotation.x = Math.PI / 2; bar2.position.y = RING_Y; mobileGroup.add(bar2);

const lightOrb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 24), orbCoreMat);
lightOrb.position.y = RING_Y - 0.25;
mobileGroup.add(lightOrb);

// Soft radial glow halo â€” like a real lamp with smooth falloff
function createOrbGlowTexture() {
    const cvs = document.createElement('canvas');
    cvs.width = 256; cvs.height = 256;
    const ctx = cvs.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255, 248, 240, 1.0)');
    g.addColorStop(0.15, 'rgba(255, 248, 240, 0.55)');
    g.addColorStop(0.45, 'rgba(255, 248, 240, 0.12)');
    g.addColorStop(1, 'rgba(255, 248, 240, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(cvs);
}
const orbGlowTex = createOrbGlowTexture();
const orbGlowMat = new THREE.SpriteMaterial({ map: orbGlowTex, transparent: true, opacity: 0.40, blending: THREE.AdditiveBlending, depthWrite: false });
const orbGlow = new THREE.Sprite(orbGlowMat);
orbGlow.scale.set(2.2, 2.2, 1);
orbGlow.position.copy(lightOrb.position);
mobileGroup.add(orbGlow);

const centerLight = new THREE.PointLight(0xfff5ee, 5, 16, 1.3);
centerLight.position.set(0, RING_Y - 0.25, 0);
scene.add(centerLight);

scene.add(new THREE.AmbientLight(0xfff8f0, 0.55));
const fill = new THREE.DirectionalLight(0xf0ece6, 0.30);
fill.position.set(-4, 5, -4);
scene.add(fill);

// Elegant rim light for cutout edge definition
const rimLight = new THREE.DirectionalLight(0xfff0e0, 0.35);
rimLight.position.set(4, 3, 4);
scene.add(rimLight);

// ============================================
// SHAPE BUILDERS
// ============================================
function makeShape(type) {
    const s = 0.24;
    switch (type) {
        case 'circle': return new THREE.CircleGeometry(s, 32);
        case 'star': {
            const sh = new THREE.Shape();
            for (let i = 0; i < 10; i++) {
                const a = (i/10)*Math.PI*2 - Math.PI/2;
                const r = i%2===0 ? s : s*0.42;
                if (i===0) sh.moveTo(Math.cos(a)*r, Math.sin(a)*r);
                else sh.lineTo(Math.cos(a)*r, Math.sin(a)*r);
            }
            sh.closePath(); return new THREE.ShapeGeometry(sh);
        }
        case 'square': {
            const sh = new THREE.Shape();
            const r = s*0.82;
            sh.moveTo(-r,-r); sh.lineTo(r,-r); sh.lineTo(r,r); sh.lineTo(-r,r);
            sh.closePath(); return new THREE.ShapeGeometry(sh);
        }
        case 'ring': return new THREE.RingGeometry(s*0.42, s, 32);
        case 'triangle': {
            const sh = new THREE.Shape();
            const r = s;
            sh.moveTo(0, r);
            sh.lineTo(-r * 0.866, -r * 0.5);
            sh.lineTo(r * 0.866, -r * 0.5);
            sh.closePath();
            return new THREE.ShapeGeometry(sh);
        }
        case 'longrect': {
            const sh = new THREE.Shape();
            const w = s * 0.35;
            const h = s * 1.2;
            sh.moveTo(-w, -h); sh.lineTo(w, -h); sh.lineTo(w, h); sh.lineTo(-w, h);
            sh.closePath();
            return new THREE.ShapeGeometry(sh);
        }
        case 'petal': {
            const sh = new THREE.Shape();
            sh.moveTo(0, s);
            sh.bezierCurveTo(s*0.55, s*0.25, s*0.55, -s*0.25, 0, -s);
            sh.bezierCurveTo(-s*0.55, -s*0.25, -s*0.55, s*0.25, 0, s);
            return new THREE.ShapeGeometry(sh);
        }
        default: return new THREE.CircleGeometry(s, 32);
    }
}

// ============================================
// CUTOUTS + WALL SHADOWS
// ============================================
const cutouts = [];
const hitboxes = [];

// ============================================
// PROJECTION SHADER (shared by wall / floor / ceiling)
// Ray-marches from light through each cutout to the surface pixel.
// ============================================
const MAX_CUTOUTS = 12;
const projectionUniforms = {
    uLightPos: { value: centerLight.position },
    uCutoutCount: { value: 0 },
    uCutoutPositions: { value: Array(MAX_CUTOUTS).fill().map(() => new THREE.Vector3()) },
    uCutoutColors: { value: Array(MAX_CUTOUTS).fill().map(() => new THREE.Color()) },
    uCutoutRadii: { value: new Float32Array(MAX_CUTOUTS) },
    uBaseColor: { value: new THREE.Color(0xffffff) },
    uProjIntensity: { value: 1.0 }
};

const projectionVertexShader = `
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

const projectionFragmentShader = `
    uniform vec3 uLightPos;
    uniform int uCutoutCount;
    uniform vec3 uCutoutPositions[12];
    uniform vec3 uCutoutColors[12];
    uniform float uCutoutRadii[12];
    uniform vec3 uBaseColor;
    uniform float uProjIntensity;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
        // Ambient + diffuse â€” darker base so coloured light-gel projections pop
        vec3 ambient = vec3(0.85);
        vec3 lightDir = normalize(vec3(0.3, 1.0, 0.2));
        float diff = max(dot(normalize(vNormal), lightDir), 0.0);
        vec3 base = uBaseColor * (ambient + vec3(0.25) * diff) * 1.0;

        // Ray from light to this pixel
        vec3 toPixel = vWorldPosition - uLightPos;
        float pixelDist = length(toPixel);
        vec3 rayDir = toPixel / max(pixelDist, 0.001);

        vec3 projColor = vec3(0.0);
        float projAlpha = 0.0;

        for (int i = 0; i < 12; i++) {
            if (i >= uCutoutCount) break;

            vec3 cPos = uCutoutPositions[i];
            vec3 cCol = uCutoutColors[i];
            float cRadius = uCutoutRadii[i];

            // Cutout plane faces the light
            vec3 cNormal = normalize(cPos - uLightPos);
            float denom = dot(rayDir, cNormal);
            if (abs(denom) < 0.001) continue;

            float t = dot(cPos - uLightPos, cNormal) / denom;
            if (t < 0.0 || t > pixelDist) continue;

            vec3 hit = uLightPos + rayDir * t;
            float dist = distance(hit, cPos);

            // Large, soft projection like coloured light-gels in a gallery
            float projRadius = cRadius * (1.0 + t * 1.5);
            float edge = projRadius * 0.55; // very soft, atmospheric falloff

            if (dist < projRadius) {
                float alpha = 1.0 - smoothstep(projRadius - edge, projRadius, dist);
                // White (text) cutouts project 50% dimmer
                float isWhite = step(0.95, (cCol.r + cCol.g + cCol.b) / 3.0);
                float dim = 1.0 - isWhite * 0.5;
                float strength = alpha * 0.30 * uProjIntensity * dim;
                // Saturated colours that mix where they overlap (red+blue=magenta, etc.)
                projColor += cCol * alpha * 1.15 * dim;
                // Over-operator keeps brightness growth gentle even with many overlaps
                projAlpha += (1.0 - projAlpha) * strength;
            }
        }

        projColor = min(projColor, vec3(1.15));
        projAlpha = min(projAlpha, 0.80);
        // Soft additive blend â€” like transparent coloured gels casting light on a white wall
        vec3 finalColor = base + projColor * projAlpha * 0.85;
        // Hard ceiling prevents blown-out white even with 5-10 overlapping projections
        finalColor = min(finalColor, vec3(0.95));
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

// Helper to share cutout uniforms but allow independent base colour
function makeRoomUniforms(baseColorHex) {
    return {
        uLightPos: projectionUniforms.uLightPos,
        uCutoutCount: projectionUniforms.uCutoutCount,
        uCutoutPositions: projectionUniforms.uCutoutPositions,
        uCutoutColors: projectionUniforms.uCutoutColors,
        uCutoutRadii: projectionUniforms.uCutoutRadii,
        uBaseColor: { value: new THREE.Color(baseColorHex) },
        uProjIntensity: projectionUniforms.uProjIntensity
    };
}

const wallShaderMat = new THREE.ShaderMaterial({
    uniforms: makeRoomUniforms(0xeae7e3),
    vertexShader: projectionVertexShader,
    fragmentShader: projectionFragmentShader,
    side: THREE.BackSide,
    depthWrite: false
});
const floorShaderMat = new THREE.ShaderMaterial({
    uniforms: makeRoomUniforms(0xf5f2ee),
    vertexShader: projectionVertexShader,
    fragmentShader: projectionFragmentShader
});
const ceilingShaderMat = new THREE.ShaderMaterial({
    uniforms: makeRoomUniforms(0xf5f2ee),
    vertexShader: projectionVertexShader,
    fragmentShader: projectionFragmentShader
});

wall.material = wallShaderMat;
floor.material = floorShaderMat;
ceiling.material = ceilingShaderMat;

function buildMobile() {
    cutouts.forEach(c => { mobileGroup.remove(c.group); });
    cutouts.length = 0;
    hitboxes.length = 0;

    messages.forEach((msg, i) => {
        const def = SHAPE_DEFS[msg.type] || SHAPE_DEFS.text;
        const pos = msg._pos;
        const group = new THREE.Group();

        // String
        const paperRadius = 0.24;
        const stringLen = Math.max(pos.stringLen - paperRadius, 0.3);
        const str = new THREE.Mesh(new THREE.CylinderGeometry(0.00125, 0.00125, stringLen, 4), stringMat);
        str.position.y = -stringLen / 2;
        group.add(str);

        // Desaturated elegant colour selection for audio / image / video
        let paperColor = def.color;
        let glowColor = def.glow;
        if (msg.type === 'audio') {
            paperColor = desaturateHex(0x00ffff);
            glowColor  = desaturateHex(0x00e0e0);
        } else if (msg.type === 'image') {
            paperColor = desaturateHex(0xffff91);
            glowColor  = desaturateHex(0xe0e060);
        } else if (msg.type === 'video') {
            const isPink = Math.random() > 0.5;
            paperColor = isPink ? desaturateHex(0xff91e7) : desaturateHex(0xcc91ff);
            glowColor  = isPink ? desaturateHex(0xe070c0) : desaturateHex(0xa070d0);
        }

        // Paper — frosted acrylic with subtle sheen (gallery-grade)
        const paperMat = new THREE.MeshPhysicalMaterial({
            color: paperColor, emissive: paperColor, emissiveIntensity: 0.12,
            roughness: 0.38, metalness: 0.0, transmission: 0.45, thickness: 0.20,
            transparent: true, opacity: 0.84, side: THREE.DoubleSide,
            clearcoat: 0.25, clearcoatRoughness: 0.35,
            sheen: 0.45, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff)
        });
        const paper = new THREE.Mesh(makeShape(def.shape), paperMat);
        if (msg.type === 'text') paper.scale.set(0.7, 0.7, 0.7);
        paper.position.y = -pos.stringLen;
        // Random initial facing so cutouts don't all look identical
        paper.rotation.y = (Math.random() - 0.5) * Math.PI * 1.6;
        paper.userData = { idx: i, msg, def: { ...def, color: paperColor, glow: glowColor }, origY: -pos.stringLen, origEmissive: 0.12, isHovered: false };
        group.add(paper);

        // Hitbox
        const hb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hb.userData.parent = paper;
        hb.position.y = -pos.stringLen;
        group.add(hb);
        hitboxes.push(hb);

        group.position.set(Math.cos(pos.angle)*RING_RADIUS, RING_Y, Math.sin(pos.angle)*RING_RADIUS);
        mobileGroup.add(group);
        // Each cutout gets unique sway parameters for organic, non-uniform motion
        cutouts.push({ group, paper, msg, def, idx: i, pos: { ...pos, origY: -pos.stringLen }, baseRotY: paper.rotation.y, sway: {
            phase: Math.random() * Math.PI * 2,
            speedX: 0.25 + Math.random() * 0.35,
            speedY: 0.15 + Math.random() * 0.25,
            speedZ: 0.35 + Math.random() * 0.45,
            ampX: 0.02 + Math.random() * 0.02,
            ampY: 0.04 + Math.random() * 0.05,
            ampZ: 0.03 + Math.random() * 0.03
        } });
    });
}

// buildMobile() is called after Supabase data loads

// ============================================
// WALL PROJECTION (CanvasTexture for detail mode)
// ============================================
const projCanvas = document.createElement('canvas');
projCanvas.width = 1200; projCanvas.height = 900;
const pCtx = projCanvas.getContext('2d');
const projTex = new THREE.CanvasTexture(projCanvas);
projTex.colorSpace = THREE.SRGBColorSpace;

const projMat = new THREE.MeshBasicMaterial({
    map: projTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
});
const projMesh = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 5.625), projMat);
projMesh.position.set(-ROOM_RADIUS * 0.95, 1.3, 0.5);
projMesh.rotation.y = Math.PI / 2;
scene.add(projMesh);

const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 7.875), glowMat);
glowMesh.position.copy(projMesh.position); glowMesh.position.x += 0.06; glowMesh.position.z += 0.02; glowMesh.rotation.y = Math.PI / 2;
scene.add(glowMesh);

// Media plane â€” sits slightly in front of projection for images/video
// Smaller and positioned lower so it never covers title or caption
const mediaPlaneMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
const mediaPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.5), mediaPlaneMat);
mediaPlane.position.copy(projMesh.position);
mediaPlane.position.x += 0.04; // slightly in front of projMesh
// centred vertically inside the 4:3 panel
mediaPlane.rotation.y = Math.PI / 2;
scene.add(mediaPlane);

let currentVideoEl = null;
let currentAudioEl = null;
let currentMediaTex = null;
let targetMediaOpacity = 0;
const texLoader = new THREE.TextureLoader();

function fitMediaPlane(mediaW, mediaH) {
    const planeW = 3.5, planeH = 2.5;
    const mediaAspect = mediaW / mediaH;
    const planeAspect = planeW / planeH;
    if (mediaAspect > planeAspect) {
        mediaPlane.scale.set(1, planeAspect / mediaAspect, 1);
    } else {
        mediaPlane.scale.set(mediaAspect / planeAspect, 1, 1);
    }
}

function setDetailMedia(msg) {
    // Clean up previous media
    if (currentVideoEl) { currentVideoEl.pause(); currentVideoEl = null; }
    if (currentAudioEl) { currentAudioEl.pause(); currentAudioEl = null; }
    if (currentMediaTex) { currentMediaTex.dispose(); currentMediaTex = null; }
    mediaPlaneMat.map = null;
    targetMediaOpacity = 0;
    mediaPlane.scale.set(1, 1, 1);
    mediaPlaneMat.needsUpdate = true;

    if (!msg) return;

    if (msg.type === 'image' && msg.content) {
        texLoader.load(msg.content, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            currentMediaTex = tex;
            mediaPlaneMat.map = tex;
            targetMediaOpacity = 0.92;
            mediaPlaneMat.needsUpdate = true;
            if (tex.image) fitMediaPlane(tex.image.width, tex.image.height);
        }, undefined, () => {
            mediaPlaneMat.map = null;
            targetMediaOpacity = 0;
        });
    } else if (msg.type === 'video' && msg.content) {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.src = msg.content;
        video.loop = false;
        video.muted = false; // try with sound first
        video.playsInline = true;
        currentVideoEl = video;
        const vTex = new THREE.VideoTexture(video);
        vTex.colorSpace = THREE.SRGBColorSpace;
        currentMediaTex = vTex;
        mediaPlaneMat.map = vTex;
        targetMediaOpacity = 0.92;
        mediaPlaneMat.needsUpdate = true;
        video.addEventListener('loadedmetadata', () => {
            if (video.videoWidth && video.videoHeight) {
                fitMediaPlane(video.videoWidth, video.videoHeight);
            }
        }, { once: true });
        video.load();
        // Play immediately within user-gesture stack (works when entered via click)
        video.play().catch(() => {
            // Fallback to muted autoplay for non-interaction contexts (demo mode)
            video.muted = true;
            video.play().catch(() => {});
        });
    } else if (msg.type === 'audio' && msg.content) {
        const audio = document.createElement('audio');
        audio.crossOrigin = 'anonymous';
        audio.src = msg.content;
        audio.loop = false;
        currentAudioEl = audio;
        audio.play().catch(() => {});
    }
    // text/wish â€” media plane stays hidden, canvas projection shows text/ui
}

function drawProjection(msg, def) {
    const ctx = pCtx, w = projCanvas.width, h = projCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const r = (def.glow>>16)&0xff, g = (def.glow>>8)&0xff, b = def.glow&0xff;

    // === OUTER LAYER: Irregular coloured halo ===
    const halos = [
        { cx: 0.50, cy: 0.48, r: 0.65, a0: 0.32, a1: 0 },
        { cx: 0.32, cy: 0.35, r: 0.42, a0: 0.22, a1: 0 },
        { cx: 0.65, cy: 0.60, r: 0.38, a0: 0.18, a1: 0 },
        { cx: 0.45, cy: 0.65, r: 0.32, a0: 0.14, a1: 0 },
        { cx: 0.60, cy: 0.40, r: 0.28, a0: 0.12, a1: 0 },
    ];
    for (const hl of halos) {
        const gd = ctx.createRadialGradient(w*hl.cx, h*hl.cy, 0, w*hl.cx, h*hl.cy, w*hl.r);
        gd.addColorStop(0, `rgba(${r},${g},${b},${hl.a0})`);
        gd.addColorStop(1, `rgba(${r},${g},${b},${hl.a1})`);
        ctx.fillStyle = gd;
        ctx.fillRect(0, 0, w, h);
    }

    // === INNER LAYER: Grey-white 4:3 panel ===
    const panelW = Math.min(w * 0.82, 980);
    const panelH = panelW * 0.75;
    const px = (w - panelW) / 2;
    const py = (h - panelH) / 2;

    // Soft coloured shadow behind panel
    ctx.shadowColor = `rgba(${r},${g},${b},0.30)`;
    ctx.shadowBlur = 50;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10;

    ctx.fillStyle = 'rgba(250, 249, 247, 0.96)';
    roundRect(ctx, px, py, panelW, panelH, 18);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Subtle border
    ctx.strokeStyle = `rgba(${r},${g},${b},0.40)`;
    ctx.lineWidth = 2;
    roundRect(ctx, px, py, panelW, panelH, 18);
    ctx.stroke();

    // === CONTENT INSIDE PANEL ===
    const pad = 42;
    const cx = px + pad;
    const cw = panelW - pad * 2;

    ctx.textBaseline = 'top';
    ctx.fillStyle = '#0a0a0a';

    // Label
    ctx.font = '500 18px Cinzel, serif';
    ctx.fillText(def.label.toUpperCase(), cx, py + pad);

    // Title
    ctx.font = '600 48px Cinzel, serif';
    const words = msg.title.split(' ');
    let line = '', y = py + pad + 38;
    for (let word of words) {
        const test = line + (line ? ' ' : '') + word;
        if (ctx.measureText(test).width > cw && line) {
            ctx.fillText(line, cx, y);
            y += 58;
            line = word;
        } else line = test;
    }
    if (line) { ctx.fillText(line, cx, y); y += 74; }

    if (msg.type === 'text' || msg.type === 'wish') {
        ctx.font = '500 26px Inter, sans-serif';
        ctx.fillStyle = '#2a2a2a';
        const bwords = msg.content.split(' ');
        line = '';
        let by = y;
        for (let word of bwords) {
            const test = line + (line ? ' ' : '') + word;
            if (ctx.measureText(test).width > cw && line) {
                ctx.fillText(line, cx, by);
                by += 40;
                line = word;
            } else line = test;
        }
        if (line) ctx.fillText(line, cx, by);
    }

    if (msg.type === 'audio') {
        ctx.globalAlpha = 0.55;
        const barCount = 26, barW = 5, barGap = 8, startX = cx, waveY = y + 30;
        for (let i = 0; i < barCount; i++) {
            const barH = 5 + Math.abs(Math.sin(i * 0.8 + msg.title.length)) * 28;
            ctx.fillStyle = `rgba(${r},${g},${b},0.60)`;
            ctx.fillRect(startX + i * (barW + barGap), waveY - barH / 2, barW, barH);
        }
        ctx.globalAlpha = 0.80;
        ctx.font = '500 20px Inter, sans-serif';
        ctx.fillStyle = '#1a1a1a';
        ctx.fillText('Audio message', cx, waveY + 30);
        ctx.globalAlpha = 1;
    }

    // Date / Author â€” same style as body text, slightly smaller
    ctx.font = '500 22px Inter, sans-serif';
    ctx.fillStyle = '#444444';
    ctx.fillText(`${msg.date}  Â·  ${msg.author || 'Anonymous'}`, cx, py + panelH - pad - 16);

    projTex.needsUpdate = true;
}

function roundRect(ctx, x, y, w, h, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// ============================================
// CAMERA
// ============================================
const CAM_PAN = { pos: new THREE.Vector3(0, 0.6, 9.5), target: new THREE.Vector3(0, 0.0, 0), fov: 48 };
const CAM_DET = { pos: new THREE.Vector3(8.5, 0.5, 7.5), target: new THREE.Vector3(-5.5, 2.2, 0), fov: 40 };

let camT = null;
let rotT = null; // for rotating mobile to face wall

function toMode(mode, dur = 1600) {
    viewMode = mode;
    const end = mode === 'detail' ? CAM_DET : CAM_PAN;
    camT = { t0: performance.now() + 400, dur, sp: camera.position.clone(), st: controls.target.clone(), sf: camera.fov, ep: end.pos, et: end.target, ef: end.fov };
    if (mode === 'detail') {
        controls.autoRotate = false;
        // Rotate mobile so selected cutout faces the wall (left side, angle PI)
        if (selectedIdx >= 0 && cutouts[selectedIdx]) {
            const c = cutouts[selectedIdx];
            const targetRot = Math.PI - c.pos.angle;
            let current = mobileGroup.rotation.y % (Math.PI*2);
            if (current < 0) current += Math.PI*2;
            let diff = targetRot - current;
            while (diff > Math.PI) diff -= Math.PI*2;
            while (diff < -Math.PI) diff += Math.PI*2;
            const final = current + diff;
            rotT = { t0: performance.now() + 400, dur: 1200, sr: current, er: final };
            // Load media for wall projection
            const msg = messages[selectedIdx];
            if (msg) setDetailMedia(msg);
        }
    } else {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.0125;
        selectedIdx = -1;
        rotT = null;
        setDetailMedia(null);
    }
}

function updateCam() {
    if (!camT) return;
    const e = performance.now() - camT.t0;
    if (e < 0) return; // wait for light transition to start first
    let t = Math.min(e / camT.dur, 1);
    t = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
    camera.position.lerpVectors(camT.sp, camT.ep, t);
    controls.target.lerpVectors(camT.st, camT.et, t);
    camera.fov = THREE.MathUtils.lerp(camT.sf, camT.ef, t);
    camera.updateProjectionMatrix();
    if (viewMode === 'detail') { projMat.opacity = t*0.98; mediaPlaneMat.opacity = targetMediaOpacity * t; }
    else { projMat.opacity = (1-t)*0.98; mediaPlaneMat.opacity = (1-t)*targetMediaOpacity; }
    if (t >= 1) camT = null;
}

function updateMobileRot() {
    if (!rotT) return;
    const e = performance.now() - rotT.t0;
    if (e < 0) return; // wait for light transition to start first
    let t = Math.min(e / rotT.dur, 1);
    t = 1 - Math.pow(1 - t, 3);
    mobileGroup.rotation.y = rotT.sr + (rotT.er - rotT.sr) * t;
    if (t >= 1) rotT = null;
}

controls.autoRotate = true;
controls.autoRotateSpeed = 0.0125;

// ============================================
// INTERACTION
// ============================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hovered = null;

function onMove(e) {
    const cx = e.clientX || (e.touches ? e.touches[0].clientX : 0);
    const cy = e.clientY || (e.touches ? e.touches[0].clientY : 0);
    mouse.x = (cx / window.innerWidth) * 2 - 1;
    mouse.y = -(cy / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(hitboxes);
    if (hits.length) {
        const p = hits[0].object.userData.parent;
        if (hovered !== p) {
            if (hovered) hovered.userData.isHovered = false;
            p.userData.isHovered = true;
            hovered = p;
            document.body.style.cursor = 'pointer';
        }
    } else {
        if (hovered) {
            hovered.userData.isHovered = false;
            hovered = null;
            document.body.style.cursor = 'default';
        }
    }
}

let detailSwitch = null; // { t0, toIdx, phase: 'fadeOut'|'fadeIn' }

function startDetailSwitch(toIdx) {
    detailSwitch = { t0: performance.now(), toIdx, phase: 'fadeOut' };
    // Start mobile rotation immediately toward the new cutout
    const c = cutouts[toIdx];
    if (c) {
        const targetRot = Math.PI - c.pos.angle;
        let current = mobileGroup.rotation.y % (Math.PI*2);
        if (current < 0) current += Math.PI*2;
        let diff = targetRot - current;
        while (diff > Math.PI) diff -= Math.PI*2;
        while (diff < -Math.PI) diff += Math.PI*2;
        rotT = { t0: performance.now() + 400, dur: 1200, sr: current, er: current + diff };
    }
    controls.autoRotate = false;
}

function handleCanvasClick(e) {
    if (e.target.closest('.corner-trigger') || e.target.closest('.legend')) return;
    if (demoMode) { stopDemo(); return; }

    // Re-raycast on click to avoid stale hovered state
    raycaster.setFromCamera(mouse, camera);

    // Check if clicking on wall projection (in detail mode)
    if (viewMode === 'detail') {
        const projHits = raycaster.intersectObject(projMesh);
        if (projHits.length > 0 && selectedIdx >= 0) {
            openDetailModal(cutouts[selectedIdx].msg, cutouts[selectedIdx].def);
            return;
        }
    }

    const hits = raycaster.intersectObjects(hitboxes);
    if (hits.length) {
        const d = hits[0].object.userData.parent.userData;

        if (viewMode === 'detail' && selectedIdx !== d.idx) {
            // Switching cutouts within detail mode: fade out, rotate, fade in
            startDetailSwitch(d.idx);
        } else if (viewMode !== 'detail') {
            selectedIdx = d.idx;
            markSeen(d.idx);
            drawProjection(d.msg, d.def);
            toMode('detail');
        }
    } else if (viewMode === 'detail') {
        toMode('panorama');
    }
}

renderer.domElement.addEventListener('mousemove', onMove);
renderer.domElement.addEventListener('click', handleCanvasClick);

let touchStart = null;
renderer.domElement.addEventListener('touchstart', e => { touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
renderer.domElement.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    if (touchStart && Math.abs(t.clientX - touchStart.x) < 10 && Math.abs(t.clientY - touchStart.y) < 10) {
        mouse.x = (t.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(t.clientY / window.innerHeight) * 2 + 1;
        handleCanvasClick(e);
    }
}, { passive: true });

// ============================================
// DETAIL MODAL (popup for media playback)
// ============================================
function openDetailModal(msg, def) {
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('detailBody');
    // Pause wall media so modal can take over
    if (currentVideoEl) currentVideoEl.pause();
    if (currentAudioEl) currentAudioEl.pause();
    let mediaHtml = '';
    if (msg.type === 'image') {
        mediaHtml = `<div class="detail-media"><img src="${msg.content}" alt="${escapeHtml(msg.title)}" onerror="this.style.display='none'"></div>`;
    } else if (msg.type === 'video') {
        mediaHtml = `<div class="detail-media"><video controls autoplay src="${msg.content}"></video></div>`;
    } else if (msg.type === 'audio') {
        mediaHtml = `<div class="detail-media"><audio controls autoplay src="${msg.content}"></audio></div>`;
    } else {
        mediaHtml = `<div class="detail-text">${escapeHtml(msg.content)}</div>`;
    }
    body.innerHTML = `
        <div class="detail-type">${def.label}</div>
        <div class="detail-title">${escapeHtml(msg.title)}</div>
        ${mediaHtml}
        <div class="detail-meta">
            <span>${msg.date}</span>
            <span>${escapeHtml(msg.author || 'Anonymous')}</span>
        </div>
    `;
    modal.classList.add('active');
}

window.closeDetailModal = function() {
    document.getElementById('detailModal').classList.remove('active');
    const aud = document.querySelector('#detailModal audio');
    const vid = document.querySelector('#detailModal video');
    if (aud) aud.pause();
    if (vid) vid.pause();
    // Resume wall media if still in detail mode
    if (viewMode === 'detail') {
        if (currentVideoEl) currentVideoEl.play().catch(() => {});
        if (currentAudioEl) currentAudioEl.play().catch(() => {});
    }
};

function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}

// ============================================
// DEMO MODE
// ============================================
window.toggleDemoMode = () => demoMode ? stopDemo() : startDemo();

function fadeAudio(mediaEl, duration = 1000) {
    if (!mediaEl) return;
    const startVol = mediaEl.volume || 1.0;
    const startTime = performance.now();
    (function tick() {
        const e = performance.now() - startTime;
        const t = Math.min(e / duration, 1);
        mediaEl.volume = Math.max(0, startVol * (1 - t));
        if (t < 1) requestAnimationFrame(tick);
        else { mediaEl.pause(); mediaEl.volume = startVol; }
    })();
}

function startDemo() {
    if (!cutouts.length) return;
    demoMode = true;
    document.getElementById('demoBtn').classList.add('active');
    document.getElementById('demoIcon').innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>';
    demoIndex = 0;
    showDemoCutout();
}

function showDemoCutout() {
    if (!demoMode) return;

    // Fade out current projection before switching to next (0.5s, synced with rotation)
    if (viewMode === 'detail' && projMat.opacity > 0.05) {
        if (currentAudioEl) fadeAudio(currentAudioEl, 1200);
        if (currentVideoEl) fadeAudio(currentVideoEl, 1200);
        const nextIdx = cutouts[demoIndex % cutouts.length].idx;
        demoIndex++;
        startDetailSwitch(nextIdx);
        return;
    }

    loadDemoCutout();
}

function loadDemoCutout() {
    const c = cutouts[demoIndex % cutouts.length];
    demoIndex++;
    selectedIdx = c.idx;
    drawProjection(c.msg, c.def);
    toMode('detail');
    scheduleDemoTimer();
}

function scheduleDemoTimer() {
    const c = cutouts[selectedIdx];
    if (!c) return;
    const delay = (c.msg.type === 'audio' || c.msg.type === 'video') ? 10000 : 5500;
    demoTimer = setTimeout(showDemoCutout, delay);
}

function stopDemo() {
    demoMode = false;
    document.getElementById('demoBtn').classList.remove('active');
    document.getElementById('demoIcon').innerHTML = '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>';
    if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
    detailSwitch = null;
    toMode('panorama');
}

// ============================================
// QR MODAL
// ============================================
window.openQRModal = () => document.getElementById('qrModal').classList.add('active');
window.closeQRModal = () => document.getElementById('qrModal').classList.remove('active');

// ============================================
// SMOOTH TRANSITION STATE (panorama ↔ detail)
// ============================================
let smoothedProjIntensity = 0.60;
let smoothedOrbBase = 0.78;
let smoothedLightBase = 5.4;

// ============================================
// ANIMATION
// ============================================
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();

    // Mobile rotation â€” panorama: very slow; detail: 10x slower
    if (!rotT) {
        const rotSpeed = viewMode === 'detail' ? 0.00015 : 0.0015;
        mobileGroup.rotation.y += rotSpeed;
    }

    updateMobileRot();

    cutouts.forEach((c, i) => {
        const p = c.paper;
        const sw = c.sway;
        // Organic sway: each cutout has unique speed/phase/amplitude on all 3 axes
        p.rotation.x = Math.cos(time * sw.speedX + sw.phase) * sw.ampX;
        p.rotation.y = c.baseRotY + Math.sin(time * sw.speedY + sw.phase * 0.5) * sw.ampY;
        p.rotation.z = Math.sin(time * sw.speedZ + sw.phase * 1.3) * sw.ampZ;

        // Update shader uniforms for ray-traced projections
        if (i < MAX_CUTOUTS) {
            const wp = new THREE.Vector3();
            p.getWorldPosition(wp);
            projectionUniforms.uCutoutPositions.value[i].copy(wp);
            projectionUniforms.uCutoutColors.value[i].setHex(c.def.color);
            projectionUniforms.uCutoutRadii.value[i] = 0.24;
        }

        if (i === selectedIdx && viewMode === 'detail') {
            // Selected cutout stays in place; only emissive/active glow changes
            p.position.y += (c.pos.origY - p.position.y) * 0.04;
            // Active glow: brighter than hover for clear visual hierarchy
            p.material.emissiveIntensity += (0.70 - p.material.emissiveIntensity) * 0.05;
            p.material.opacity += (0.95 - p.material.opacity) * 0.05;
        } else {
            p.position.y += (c.pos.origY - p.position.y) * 0.04;
            // In detail mode, dim unselected cutouts so the selected one + wall projection pop
            let targetEmissive = (viewMode === 'detail') ? 0.06 : p.userData.origEmissive;
            // Unseen cutouts pulse gently in panorama mode to invite clicks
            if (viewMode === 'panorama' && !seenIndices.has(i)) {
                const pulse = Math.sin(time * 2.5 + i * 1.3) * 0.5 + 0.5;
                targetEmissive = 0.15 + pulse * 0.45;
            }
            // Hover: inner glow instead of scale change
            let targetOpacity = 0.72;
            if (p.userData.isHovered && viewMode !== 'detail') {
                targetEmissive = 0.55;
                targetOpacity = 0.92;
            }
            p.material.emissiveIntensity += (targetEmissive - p.material.emissiveIntensity) * 0.08;
            p.material.opacity += (targetOpacity - p.material.opacity) * 0.08;
            const gx = c.group.position.x, gz = c.group.position.z;
            const tx = Math.cos(c.pos.angle) * RING_RADIUS;
            const tz = Math.sin(c.pos.angle) * RING_RADIUS;
            c.group.position.x += (tx - gx) * 0.04;
            c.group.position.z += (tz - gz) * 0.04;
        }
    });

    // Sync cutout count to shader for ray-traced projections
    projectionUniforms.uCutoutCount.value = Math.min(cutouts.length, MAX_CUTOUTS);
    const targetProjIntensity = (viewMode === 'panorama') ? 0.60 : 0.15;
    smoothedProjIntensity += (targetProjIntensity - smoothedProjIntensity) * 0.03;
    projectionUniforms.uProjIntensity.value = smoothedProjIntensity;

    // Dim the mobile light in detail mode so the wall projection is the hero (smooth transition)
    const targetOrbBase = viewMode === 'detail' ? 0.30 : 0.78;
    smoothedOrbBase += (targetOrbBase - smoothedOrbBase) * 0.03;
    lightOrb.material.opacity = smoothedOrbBase + Math.sin(time * 0.5) * 0.15;
    orbGlow.material.opacity = (smoothedOrbBase * 0.50) + Math.sin(time * 0.5 + 0.6) * 0.18;
    const targetLightBase = viewMode === 'detail' ? 2.2 : 5.4;
    smoothedLightBase += (targetLightBase - smoothedLightBase) * 0.03;
    centerLight.intensity = smoothedLightBase + Math.sin(time * 0.35) * (smoothedLightBase < 3.5 ? 0.6 : 1.2);
    centerLight.color.setHSL(0.08, 0.15, 0.98 + Math.sin(time * 0.4) * 0.02);
    // Keep glowMesh hidden at all times
    glowMat.opacity = 0;

    // Keep video texture updating frame-by-frame
    if (currentMediaTex && currentMediaTex.isVideoTexture && currentVideoEl && !currentVideoEl.paused) {
        currentMediaTex.needsUpdate = true;
    }

    // Animate dust particles
    const dPos = dustParticles.geometry.attributes.position.array;
    for (let i = 0; i < DUST_COUNT; i++) {
        dPos[i*3]   += dustSpeed[i*3]   + Math.sin(time * 0.3 + i) * 0.00015;
        dPos[i*3+1] += dustSpeed[i*3+1] + Math.cos(time * 0.2 + i * 0.7) * 0.00012;
        dPos[i*3+2] += dustSpeed[i*3+2] + Math.sin(time * 0.25 + i * 1.3) * 0.00015;
        // Soft boundary wrap
        const dx = dPos[i*3], dy = dPos[i*3+1] - RING_Y, dz = dPos[i*3+2];
        if (dx*dx + dy*dy + dz*dz > 14) {
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * 1.2;
            dPos[i*3]   = Math.cos(theta) * r;
            dPos[i*3+1] = RING_Y - 0.3 + (Math.random() - 0.5) * 2;
            dPos[i*3+2] = Math.sin(theta) * r;
        }
    }
    dustParticles.geometry.attributes.position.needsUpdate = true;

    // Detail switch: fade-out synced with mobile rotation (1600ms), then swap, then fade-in (500ms)
    if (detailSwitch) {
        const e = performance.now() - detailSwitch.t0;
        if (detailSwitch.phase === 'fadeOut') {
            let t = Math.min(e / 1600, 1);
            t = 1 - Math.pow(1 - t, 3); // ease-out cubic
            projMat.opacity = 0.98 * (1 - t);
            mediaPlaneMat.opacity = targetMediaOpacity * (1 - t);
            if (t >= 1) {
                selectedIdx = detailSwitch.toIdx;
                markSeen(selectedIdx);
                const c = cutouts[selectedIdx];
                if (c) {
                    drawProjection(c.msg, c.def);
                    setDetailMedia(messages[selectedIdx]);
                }
                detailSwitch.phase = 'fadeIn';
                detailSwitch.t0 = performance.now();
            }
        } else {
            let t = Math.min(e / 1000, 1);
            t = 1 - Math.pow(1 - t, 3); // ease-out cubic
            projMat.opacity = 0.98 * t;
            mediaPlaneMat.opacity = targetMediaOpacity * t;
            if (t >= 1) {
                detailSwitch = null;
                if (demoMode) scheduleDemoTimer();
            }
        }
    }

    updateCam();
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================
// SUPABASE INTEGRATION
// ============================================
const SUPABASE_URL = 'https://kggcyurkabnxtqfzfqex.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnZ2N5dXJrYWJueHRxZnpmcWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0OTM0OTAsImV4cCI6MjA5MjA2OTQ5MH0.0Nx_1pDCgR8eBf9S1O_2e4kuU4iW3H610322cK1eabg';

let sbClient = null;
try {
    if (window.supabase && window.supabase.createClient) {
        sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
} catch (e) { console.error('Supabase init failed:', e); }

async function loadMessagesFromSupabase() {
    if (!sbClient) return [];
    const { data, error } = await sbClient
        .from('messages')
        .select('*')
        .eq('hidden', false)
        .order('timestamp', { ascending: false });
    if (error) { console.error('Supabase load error:', error); return []; }
    return (data || []).map(normalizeMessage);
}

// ============================================
// INIT
// ============================================
async function init() {
    messages = await loadMessagesFromSupabase();
    assignPositions();
    buildMobile();
    document.getElementById('cutoutCount').textContent = messages.length;
    setTimeout(() => {
        const loader = document.getElementById('loader');
        if (loader) { loader.classList.add('hidden'); document.body.classList.add('loaded'); }
    }, 800);
}

init();

// Poll Supabase every 20s for new messages
setInterval(async () => {
    if (viewMode === 'detail') return; // don't refresh while reading
    const fresh = await loadMessagesFromSupabase();
    if (fresh.length !== messages.length) {
        messages = fresh;
        assignPositions();
        buildMobile();
        document.getElementById('cutoutCount').textContent = messages.length;
    }
}, 20000);

animate();
