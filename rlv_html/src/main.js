import './style.css';
import { ExptParser } from './ExptParser.js';
import { ReflParser } from './ReflParser.js';
import { buildRLV, rlvToViewerFormat, SCALE }
  from './rlv_io.js';
import * as THREE from 'three';
import { TrackballControls }
  from 'three/addons/controls/TrackballControls.js';

// ── Three.js globals ──────────────────────

let scene, camera, renderer, controls;
let pointsObject = null;
let orthoZoom = 1.0;
let animating = false;

// ── Collapse button ───────────────────────

const btnCollapse =
  document.getElementById('btn-collapse');

btnCollapse.addEventListener('click', () => {
  document.getElementById('sidebar')
    .classList.toggle('hidden');
  document.getElementById('toolbar')
    .classList.toggle('hidden');
  document.body
    .classList.toggle('sidebar-hidden');
  document.body
    .classList.toggle('toolbar-hidden');
  btnCollapse.textContent =
    btnCollapse.textContent.trim() === '‹'
      ? '›' : '‹';
  // Resize renderer after transition
  setTimeout(onResize, 300);
});

// ── Collapsible sections ──────────────────

document.querySelectorAll('.section-label')
  .forEach(label => {
    label.addEventListener('click', () => {
      const id = label.dataset.section;
      const content =
        document.getElementById(
          `section-${id}`);
      if (!content) return;
      label.classList.toggle('collapsed');
      content.classList.toggle('collapsed');
    });
  });

// ── Toggle switches ───────────────────────

document.querySelectorAll(
  '#sidebar .toggle'
).forEach(tog => {
  tog.addEventListener('click', () => {
    tog.classList.toggle('on');
  });
});

// ── Experiment list ───────────────────────

const EXP_COLORS = [
  '#e69f00', '#56b4e9', '#009e73',
  '#f0e442', '#0072b2', '#d55e00',
  '#cc79a7', '#e6194b',
];

const fakeExps = [
  { id: 0, count: 342 },
  { id: 1, count: 128 },
  { id: 2, count: 891 },
  { id: 3, count:  57 },
  { id: 4, count:  47 },
  { id: 5, count:  37 },
];

function buildExpList(exps) {
  const list =
    document.getElementById('exp-list');
  list.innerHTML = '';
  exps.forEach(exp => {
    const color =
      EXP_COLORS[exp.id % EXP_COLORS.length];
    const row =
      document.createElement('div');
    row.className = 'exp-row';
    row.innerHTML = `
      <div class="exp-dot"
           style="background:${color}">
      </div>
      <span class="exp-label">
        exp ${exp.id}
      </span>
      <span class="exp-count">
        ${exp.count.toLocaleString()}
      </span>
      <div class="toggle on"
           data-expid="${exp.id}">
      </div>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.toggle')
    .forEach(el => {
      el.addEventListener('click', () => {
        el.classList.toggle('on');
      });
    });
}

buildExpList(fakeExps);

// ── Three.js init ─────────────────────────

function initThree() {
  const wrap =
    document.getElementById('canvas-wrap');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d14);

  const w = wrap.clientWidth;
  const h = wrap.clientHeight;

  camera = new THREE.OrthographicCamera(
    -w/2, w/2, h/2, -h/2, 0.1, 1e7);
  camera.position.set(0, 0, 10000);

  renderer = new THREE.WebGLRenderer({
    antialias: true });
  renderer.setPixelRatio(
    window.devicePixelRatio);
  renderer.setSize(w, h);
  wrap.appendChild(renderer.domElement);

  controls = new TrackballControls(
    camera, renderer.domElement);
  controls.rotateSpeed  = 3.0;
  controls.zoomSpeed    = 0; // ortho only
  controls.panSpeed     = 0.8;
  controls.staticMoving = true;
  controls.noZoom       = true;

  // Scroll wheel → ortho zoom
  renderer.domElement.addEventListener(
    'wheel', e => {
      e.preventDefault();
      const factor = e.deltaY > 0
        ? 1.1 : 0.9;
      orthoZoom = Math.max(0.01,
        Math.min(100,
          orthoZoom / factor));
      syncOrtho();
    }, { passive: false });

  window.addEventListener(
    'resize', onResize);
}

function onResize() {
  const wrap =
    document.getElementById('canvas-wrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h);
  syncOrtho();
  controls.handleResize();
}

function syncOrtho() {
  if (!pointsObject) return;
  const wrap =
    document.getElementById('canvas-wrap');
  const aspect =
    wrap.clientWidth / wrap.clientHeight;

  const bbox = new THREE.Box3()
    .setFromObject(pointsObject);
  const size = bbox.getSize(
    new THREE.Vector3()).length();
  const half = (size * 0.6) / orthoZoom;

  camera.left   = -half * aspect;
  camera.right  =  half * aspect;
  camera.top    =  half;
  camera.bottom = -half;
  camera.near   =  size * 0.001;
  camera.far    =  size * 10;
  camera.updateProjectionMatrix();
}

function fitCamera() {
  const bbox = new THREE.Box3()
    .setFromObject(pointsObject);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  controls.target.copy(center);
  camera.position.copy(center)
    .add(new THREE.Vector3(
      0, 0, bbox.getSize(
        new THREE.Vector3()).length() * 2));
  orthoZoom = 1.0;
  syncOrtho();
  controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  syncOrtho();
  renderer.render(scene, camera);
}

// ── Build scene from RLV data ─────────────

function buildScene(rawData) {
  // Remove old points if reloading
  if (pointsObject) {
    scene.remove(pointsObject);
    pointsObject.geometry.dispose();
    pointsObject.material.dispose();
    pointsObject = null;
  }

  const pts = rawData.points;
  const cols = rawData.colors;
  const n = pts.length;

  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    pos[i*3]   = pts[i][0];
    pos[i*3+1] = pts[i][1];
    pos[i*3+2] = pts[i][2];
    col[i*3]   = cols[i][0];
    col[i*3+1] = cols[i][1];
    col[i*3+2] = cols[i][2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',
    new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',
    new THREE.BufferAttribute(col, 3));

  const mat = new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    uniforms: {
      pointSize: { value: 5.0 },
      opacity:   { value: 0.9 },
    },
    vertexShader: `
      varying vec3 vColor;
      uniform float pointSize;
      void main() {
        vColor = color;
        gl_PointSize = pointSize;
        gl_Position = projectionMatrix
          * modelViewMatrix
          * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      uniform float opacity;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        if (dot(uv, uv) > 0.25) discard;
        gl_FragColor = vec4(
          vColor, opacity);
      }`,
  });

  pointsObject = new THREE.Points(geo, mat);
  scene.add(pointsObject);

  fitCamera();

  // Update status bar
  document.getElementById('status-count')
    .textContent =
      n.toLocaleString() + ' spots';
}

// ── Open dialog ───────────────────────────

let pendingExpt = null;
let pendingRefl = null;

document.getElementById('btn-open-dials')
  .addEventListener('click', () => {
    // Clear previous selections
    document.getElementById(
      'dlg-expt-name').value = '';
    document.getElementById(
      'dlg-refl-name').value = '';
    document.getElementById(
      'dlg-expt-input').value = '';
    document.getElementById(
      'dlg-refl-input').value = '';
    pendingExpt = null;
    pendingRefl = null;
    document.getElementById('dlg-open')
      .style.display = 'flex';
  });

document.getElementById('dlg-expt-input')
  .addEventListener('change', e => {
    pendingExpt = e.target.files[0];
    document.getElementById(
      'dlg-expt-name').value =
        pendingExpt ? pendingExpt.name : '';
  });

document.getElementById('dlg-refl-input')
  .addEventListener('change', e => {
    pendingRefl = e.target.files[0];
    document.getElementById(
      'dlg-refl-name').value =
        pendingRefl ? pendingRefl.name : '';
  });

document.getElementById('dlg-cancel')
  .addEventListener('click', () => {
    document.getElementById('dlg-open')
      .style.display = 'none';
  });

document.getElementById('dlg-load')
  .addEventListener('click', async () => {
    if (!pendingExpt || !pendingRefl) {
      alert(
        'Please select both files first');
      return;
    }
    document.getElementById('dlg-open')
      .style.display = 'none';
    await loadDIALSFiles(
      pendingExpt, pendingRefl);
    pendingExpt = null;
    pendingRefl = null;
  });

// ── Load DIALS files ──────────────────────

async function loadDIALSFiles(
  exptFile, reflFile
) {
  const loading =
    document.getElementById('loading');
  loading.textContent = 'Loading…';
  loading.style.display = 'flex';

  try {
    const exptParser = new ExptParser();
    const reflParser = new ReflParser();

    await exptParser
      .parseExperiment(exptFile);
    await reflParser
      .parseReflectionTableFromMsgpackFile(
        reflFile);

    console.log(
      'Experiments:',
      exptParser.numExperiments());
    console.log(
      'Reflections:',
      reflParser.getPanelNumbers()?.length);

    // Compute RLPs and build scene
    const rlvData = buildRLV(
      exptParser, reflParser);
    const rawData =
      rlvToViewerFormat(rlvData);

    buildScene(rawData);
    loading.style.display = 'none';

  } catch(e) {
    loading.textContent = 'Error: ' + e;
    console.error(e);
  }
}

// ── Boot ──────────────────────────────────

initThree();
if (!animating) {
  animating = true;
  animate();
}
