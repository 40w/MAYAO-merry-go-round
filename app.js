import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================
// DATA — load from localStorage (shared with admin/submit)
// ============================================
const SHAPE_DEFS = {
    text:  { shape: 'circle', color: 0xffd0e0, glow: 0xffa8c0, label: 'Text' },
    audio: { shape: 'star',   color: 0xb0e0ff, glow: 0x88c8ff, label: 'Audio' },
    image: { shape: 'square', color: 0xffe8a0, glow: 0xffd060, label: 'Image' },
    video: { shape: 'ring',   color: 0xd0b8ff, glow: 0xb898ff, label: 'Video' },
    wish:  { shape: 'petal',  color: 0xb8ffd0, glow: 0x90f0b8, label: 'Wish' }
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

function loadMessages() {
    const stored = localStorage.getItem('mayao-messages');
    if (stored) {
        try {
            const raw = JSON.parse(stored);
            return raw.map(normalizeMessage).filter(m => m && !m.hidden);
        } catch (e) { console.error('Failed to load messages:', e); }
    }
    return [];
}

let messages = loadMessages();
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
            stringLen: 0.7 + row * 0.45 + Math.random() * 0.25,
            row
        };
    });
}
assignPositions();

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
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
scene.fog = new THREE.Fog(0xffffff, 12, 24);

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
const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.BackSide });
const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
const ringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 });
const stringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.85 });
const orbCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff8f0, transparent: true, opacity: 0.85 });

// ============================================
// ROOM
// ============================================
// Helper to share cutout uniforms but allow independent base colour
function makeRoomUniforms(baseColorHex) {
    return {
        uLightPos: projectionUniforms.uLightPos,
        uCutoutCount: projectionUniforms.uCutoutCount,
        uCutoutPositions: projectionUniforms.uCutoutPositions,
        uCutoutColors: projectionUniforms.uCutoutColors,
        uCutoutRadii: projectionUniforms.uCutoutRadii,
        uBaseColor: { value: new THREE.Color(baseColorHex) }
    };
}

const wallShaderMat = new THREE.ShaderMaterial({
    uniforms: makeRoomUniforms(0xffffff),
    vertexShader: projectionVertexShader,
    fragmentShader: projectionFragmentShader,
    side: THREE.BackSide
});

const floorShaderMat = new THREE.ShaderMaterial({
    uniforms: makeRoomUniforms(0xffffff),
    vertexShader: projectionVertexShader,
    fragmentShader: projectionFragmentShader
});

const ceilingShaderMat = new THREE.ShaderMaterial({
    uniforms: makeRoomUniforms(0xbbbbbb),
    vertexShader: projectionVertexShader,
    fragmentShader: projectionFragmentShader
});

const wall = new THREE.Mesh(new THREE.CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, 9, 56, 1, true), wallShaderMat);
wall.position.y = 1;
scene.add(wall);

const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM_RADIUS * 2, 56), floorShaderMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -3.5;
scene.add(floor);

const ceiling = new THREE.Mesh(new THREE.CircleGeometry(ROOM_RADIUS, 56), ceilingShaderMat);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 5.5;
scene.add(ceiling);

// ============================================
// MOBILE
// ============================================
const mobileGroup = new THREE.Group();
scene.add(mobileGroup);

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

const centerLight = new THREE.PointLight(0xfff5ee, 5, 16, 1.3);
centerLight.position.set(0, RING_Y - 0.25, 0);
scene.add(centerLight);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const fill = new THREE.DirectionalLight(0xf0f0f0, 0.25);
fill.position.set(-4, 5, -4);
scene.add(fill);

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
    uBaseColor: { value: new THREE.Color(0xffffff) }
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
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
        // Simple ambient + diffuse lighting for the room surface
        vec3 ambient = vec3(0.55);
        vec3 lightDir = normalize(vec3(0.3, 1.0, 0.2));
        float diff = max(dot(normalize(vNormal), lightDir), 0.0);
        vec3 base = uBaseColor * (ambient + vec3(0.30) * diff);

        // Ray from light to this pixel
        vec3 toPixel = vWorldPosition - uLightPos;
        float pixelDist = length(toPixel);
        vec3 rayDir = toPixel / max(pixelDist, 0.001);

        vec3 projColor = vec3(0.0);

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

            // Projection grows with distance from light (perspective)
            float projRadius = cRadius * (1.0 + t * 3.0);
            float edge = projRadius * 0.5;

            if (dist < projRadius) {
                float alpha = 1.0 - smoothstep(projRadius - edge, projRadius, dist);
                projColor += cCol * alpha * 0.22;
            }
        }

        vec3 finalColor = base + projColor;
        finalColor = min(finalColor, vec3(1.0));
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

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

        // Paper — iridescent holographic plastic gel
        const paperMat = new THREE.MeshPhysicalMaterial({
            color: def.color, emissive: def.color, emissiveIntensity: 0.15,
            roughness: 0.22, metalness: 0.02, transmission: 0.70, thickness: 0.35,
            transparent: true, opacity: 0.78, side: THREE.DoubleSide,
            clearcoat: 0.9, clearcoatRoughness: 0.08,
            iridescence: 1.0, iridescenceIOR: 1.3,
            iridescenceThicknessRange: [100, 400]
        });
        const paper = new THREE.Mesh(makeShape(def.shape), paperMat);
        paper.position.y = -pos.stringLen;
        paper.userData = { idx: i, msg, def, origY: -pos.stringLen, origEmissive: 0.15 };
        group.add(paper);

        // Hitbox
        const hb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hb.userData.parent = paper;
        hb.position.y = -pos.stringLen;
        group.add(hb);
        hitboxes.push(hb);

        group.position.set(Math.cos(pos.angle)*RING_RADIUS, RING_Y, Math.sin(pos.angle)*RING_RADIUS);
        mobileGroup.add(group);
        cutouts.push({ group, paper, msg, def, idx: i, pos: { ...pos, origY: -pos.stringLen } });
    });
}

buildMobile();

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
const projMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 4.5), projMat);
projMesh.position.set(-ROOM_RADIUS * 0.82, 1.4, 0);
projMesh.rotation.y = Math.PI / 2;
scene.add(projMesh);

const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 6.3), glowMat);
glowMesh.position.copy(projMesh.position); glowMesh.position.x += 0.06; glowMesh.rotation.y = Math.PI / 2;
scene.add(glowMesh);

// Media plane — sits slightly in front of projection for images/video
// Smaller and positioned lower so it never covers title or caption
const mediaPlaneMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
const mediaPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.0), mediaPlaneMat);
mediaPlane.position.copy(projMesh.position);
mediaPlane.position.x += 0.04; // slightly in front of projMesh
mediaPlane.position.y -= 0.6;  // lower on the wall — below title, above date
mediaPlane.rotation.y = Math.PI / 2;
scene.add(mediaPlane);

let currentVideoEl = null;
let currentAudioEl = null;
let currentMediaTex = null;
let targetMediaOpacity = 0;
const texLoader = new THREE.TextureLoader();

function fitMediaPlane(mediaW, mediaH) {
    const planeW = 2.8, planeH = 2.0;
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
        video.loop = true;
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
        audio.loop = true;
        currentAudioEl = audio;
        audio.play().catch(() => {});
    }
    // text/wish — media plane stays hidden, canvas projection shows text/ui
}

function drawProjection(msg, def) {
    const ctx = pCtx, w = projCanvas.width, h = projCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const r = (def.glow>>16)&0xff, g = (def.glow>>8)&0xff, b = def.glow&0xff;
    const grad = ctx.createRadialGradient(w*0.3, h*0.42, 0, w*0.45, h*0.5, w*0.85);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.32)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},0.14)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
    const core = ctx.createRadialGradient(w*0.28, h*0.38, 0, w*0.28, h*0.38, w*0.4);
    core.addColorStop(0, `rgba(${Math.min(r+20,255)},${Math.min(g+20,255)},${Math.min(b+20,255)},0.18)`);
    core.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = core; ctx.fillRect(0,0,w,h);
    ctx.textBaseline = 'top'; ctx.fillStyle = '#1a1a1a';
    ctx.font = '300 20px Cinzel, serif'; ctx.fillText(def.label.toUpperCase(), 70, 70);
    ctx.font = '400 54px Cinzel, serif';
    const words = msg.title.split(' ');
    let line = '', y = 145;
    for (let word of words) {
        const test = line + (line?' ':'') + word;
        if (ctx.measureText(test).width > w-140 && line) { ctx.fillText(line,70,y); y+=72; line=word; }
        else line=test;
    }
    if (line) { ctx.fillText(line,70,y); y+=88; }
    if (msg.type==='text'||msg.type==='wish') {
        ctx.font = '300 27px Inter, sans-serif'; ctx.globalAlpha=0.88;
        const bwords = msg.content.split(' ');
        line=''; let by=y;
        for (let word of bwords) {
            const test = line + (line?' ':'') + word;
            if (ctx.measureText(test).width > w-140 && line) { ctx.fillText(line,70,by); by+=44; line=word; }
            else line=test;
        }
        if (line) ctx.fillText(line,70,by);
        ctx.globalAlpha=1;
    }
    if (msg.type === 'audio') {
        // Draw a simple audio-wave graphic on the canvas projection
        ctx.globalAlpha = 0.45;
        const barCount = 32, barW = 6, barGap = 10, startX = 70, waveY = y + 40;
        for (let i = 0; i < barCount; i++) {
            const barH = 6 + Math.abs(Math.sin(i * 0.8 + msg.title.length)) * 36;
            ctx.fillStyle = `rgba(${r},${g},${b},0.55)`;
            ctx.fillRect(startX + i * (barW + barGap), waveY - barH / 2, barW, barH);
        }
        ctx.fillStyle = '#1a1a1a';
        ctx.font = '300 21px Inter, sans-serif';
        ctx.globalAlpha = 0.6;
        ctx.fillText('Audio message', 70, waveY + 40);
        ctx.globalAlpha = 1;
    }
    ctx.font='300 17px Cinzel, serif'; ctx.globalAlpha=0.5;
    ctx.fillText(`${msg.date}  ·  ${msg.author||'Anonymous'}`, 70, h-85);
    ctx.globalAlpha=1;
    projTex.needsUpdate = true;
}

// ============================================
// CAMERA
// ============================================
const CAM_PAN = { pos: new THREE.Vector3(0, 2.2, 9.5), target: new THREE.Vector3(0, 0.9, 0), fov: 48 };
const CAM_DET = { pos: new THREE.Vector3(8.5, 2.0, 5.0), target: new THREE.Vector3(-4.5, 1.4, 0), fov: 40 };

let camT = null;
let rotT = null; // for rotating mobile to face wall

function toMode(mode, dur = 1600) {
    viewMode = mode;
    const end = mode === 'detail' ? CAM_DET : CAM_PAN;
    camT = { t0: performance.now(), dur, sp: camera.position.clone(), st: controls.target.clone(), sf: camera.fov, ep: end.pos, et: end.target, ef: end.fov };
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
            rotT = { t0: performance.now(), dur: 1200, sr: current, er: final };
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
    let t = Math.min(e / camT.dur, 1);
    t = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
    camera.position.lerpVectors(camT.sp, camT.ep, t);
    controls.target.lerpVectors(camT.st, camT.et, t);
    camera.fov = THREE.MathUtils.lerp(camT.sf, camT.ef, t);
    camera.updateProjectionMatrix();
    if (viewMode === 'detail') { projMat.opacity = t*0.9; glowMat.opacity = t*0.12; mediaPlaneMat.opacity = targetMediaOpacity * t; }
    else { projMat.opacity = (1-t)*0.9; glowMat.opacity = (1-t)*0.12; mediaPlaneMat.opacity = (1-t)*targetMediaOpacity; }
    if (t >= 1) camT = null;
}

function updateMobileRot() {
    if (!rotT) return;
    const e = performance.now() - rotT.t0;
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
        if (hovered !== p) { setH(p, true); hovered = p; document.body.style.cursor = 'pointer'; }
    } else {
        if (hovered) { setH(hovered, false); hovered = null; document.body.style.cursor = 'default'; }
    }
}

function setH(paper, on) {
    const target = on ? 1.3 : 1.0;
    const startX = paper.scale.x;
    const t0 = performance.now();
    (function tick() {
        const t = Math.min((performance.now() - t0) / 220, 1);
        const e = 1 - Math.pow(1 - t, 3);
        const v = startX + (target - startX) * e;
        paper.scale.set(v, v, v);
        paper.material.emissiveIntensity = on ? 0.45 : paper.userData.origEmissive;
        if (t < 1) requestAnimationFrame(tick);
    })();
}

// Click on canvas
function onClk(e) {
    if (e.target.closest('.corner-trigger') || e.target.closest('.legend')) return;
    if (demoMode) { stopDemo(); return; }

    // Check if clicking on wall projection (in detail mode)
    if (viewMode === 'detail') {
        raycaster.setFromCamera(mouse, camera);
        const projHits = raycaster.intersectObject(projMesh);
        if (projHits.length > 0 && selectedIdx >= 0) {
            openDetailModal(cutouts[selectedIdx].msg, cutouts[selectedIdx].def);
            return;
        }
    }

    if (hovered) {
        const d = hovered.userData;
        selectedIdx = d.idx;
        drawProjection(d.msg, d.def);
        toMode('detail');
    } else if (viewMode === 'detail') {
        toMode('panorama');
    }
}

renderer.domElement.addEventListener('mousemove', onMove);
renderer.domElement.addEventListener('click', onClk);

let touchStart = null;
renderer.domElement.addEventListener('touchstart', e => { touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
renderer.domElement.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    if (touchStart && Math.abs(t.clientX - touchStart.x) < 10 && Math.abs(t.clientY - touchStart.y) < 10) {
        mouse.x = (t.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(t.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
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
            selectedIdx = d.idx; drawProjection(d.msg, d.def); toMode('detail');
        } else if (viewMode === 'detail') {
            toMode('panorama');
        }
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
    const c = cutouts[demoIndex % cutouts.length];
    demoIndex++;
    selectedIdx = c.idx;
    drawProjection(c.msg, c.def);
    toMode('detail');
    const delay = (c.msg.type === 'audio' || c.msg.type === 'video') ? 10000 : 5500;
    demoTimer = setTimeout(showDemoCutout, delay);
}

function stopDemo() {
    demoMode = false;
    document.getElementById('demoBtn').classList.remove('active');
    document.getElementById('demoIcon').innerHTML = '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>';
    if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
    toMode('panorama');
}

// ============================================
// QR MODAL
// ============================================
window.openQRModal = () => document.getElementById('qrModal').classList.add('active');
window.closeQRModal = () => document.getElementById('qrModal').classList.remove('active');

// ============================================
// ANIMATION
// ============================================
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();

    // Mobile rotation — panorama: very slow; detail: 10x slower
    if (!rotT) {
        const rotSpeed = viewMode === 'detail' ? 0.00015 : 0.0015;
        mobileGroup.rotation.y += rotSpeed;
    }

    updateMobileRot();

    cutouts.forEach((c, i) => {
        const p = c.paper;
        const ph = i * 1.7;
        p.rotation.z = Math.sin(time * 0.6 + ph) * 0.045;
        p.rotation.x = Math.cos(time * 0.4 + ph) * 0.025;

        // Update shader uniforms for ray-traced projections
        if (i < MAX_CUTOUTS) {
            const wp = new THREE.Vector3();
            p.getWorldPosition(wp);
            projectionUniforms.uCutoutPositions.value[i].copy(wp);
            projectionUniforms.uCutoutColors.value[i].setHex(c.def.color);
            projectionUniforms.uCutoutRadii.value[i] = 0.24;
        }

        if (i === selectedIdx && viewMode === 'detail') {
            const targetY = c.pos.origY - 0.8;
            p.position.y += (targetY - p.position.y) * 0.04;
            // Lower emissive so the projection wall stays readable
            p.material.emissiveIntensity += (0.40 - p.material.emissiveIntensity) * 0.05;
            p.material.opacity += (0.92 - p.material.opacity) * 0.05;
            const gx = c.group.position.x, gz = c.group.position.z;
            const angle = Math.atan2(gz, gx);
            c.group.position.x += (Math.cos(angle) * (RING_RADIUS + 0.5) - gx) * 0.03;
            c.group.position.z += (Math.sin(angle) * (RING_RADIUS + 0.5) - gz) * 0.03;
        } else {
            p.position.y += (c.pos.origY - p.position.y) * 0.04;
            // In detail mode, dim unselected cutouts so the selected one + wall projection pop
            const targetEmissive = (viewMode === 'detail') ? 0.06 : p.userData.origEmissive;
            p.material.emissiveIntensity += (targetEmissive - p.material.emissiveIntensity) * 0.04;
            p.material.opacity += (0.72 - p.material.opacity) * 0.04;
            const gx = c.group.position.x, gz = c.group.position.z;
            const tx = Math.cos(c.pos.angle) * RING_RADIUS;
            const tz = Math.sin(c.pos.angle) * RING_RADIUS;
            c.group.position.x += (tx - gx) * 0.04;
            c.group.position.z += (tz - gz) * 0.04;
        }
    });

    // Sync cutout count to shader for ray-traced projections
    projectionUniforms.uCutoutCount.value = Math.min(cutouts.length, MAX_CUTOUTS);

    // Dim the mobile light in detail mode so the wall projection is the hero
    const orbBase = viewMode === 'detail' ? 0.30 : 0.65;
    lightOrb.material.opacity = orbBase + Math.sin(time * 0.5) * 0.15;
    const lightBase = viewMode === 'detail' ? 2.2 : 4.5;
    centerLight.intensity = lightBase + Math.sin(time * 0.35) * (viewMode === 'detail' ? 0.6 : 1.2);
    centerLight.color.setHSL(0.08, 0.15, 0.98 + Math.sin(time * 0.4) * 0.02);
    if (glowMat.opacity > 0.01) {
        const base = viewMode === 'detail' ? 0.18 : 0.02;
        glowMat.opacity = base + Math.sin(time * 0.5) * 0.03;
    }

    // Keep video texture updating frame-by-frame
    if (currentMediaTex && currentMediaTex.isVideoTexture && currentVideoEl && !currentVideoEl.paused) {
        currentMediaTex.needsUpdate = true;
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
// INIT
// ============================================
document.getElementById('cutoutCount').textContent = messages.length;

setTimeout(() => {
    const loader = document.getElementById('loader');
    if (loader) { loader.classList.add('hidden'); document.body.classList.add('loaded'); }
}, 1200);

animate();