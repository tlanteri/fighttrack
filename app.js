const videoInput = document.querySelector('#videoInput');
const video = document.querySelector('#video');
const stage = document.querySelector('#videoStage');
const canvas = document.querySelector('#overlayCanvas');
const context = canvas.getContext('2d');
const emptyState = document.querySelector('#emptyState');
const timeline = document.querySelector('#timeline');
const playButton = document.querySelector('#playButton');
const currentTimeLabel = document.querySelector('#currentTime');
const durationLabel = document.querySelector('#duration');
const frameBadge = document.querySelector('#frameBadge span');
const fileName = document.querySelector('#fileName');
const exportButton = document.querySelector('#exportButton');
const displacementChart = document.querySelector('#displacementChart');
const angleChart = document.querySelector('#angleChart');
const displacementValue = document.querySelector('#displacementValue');
const angleValue = document.querySelector('#angleValue');
const pointingStatus = document.querySelector('#pointingStatus');
const frameControls = [playButton, document.querySelector('#previousFrame'), document.querySelector('#nextFrame')];
const setStartButton = document.querySelector('#setStartButton');
const setEndButton = document.querySelector('#setEndButton');
const reviewButton = document.querySelector('#reviewButton');
const selectionLabel = document.querySelector('#selectionLabel');
const angleOverlay = document.querySelector('#angleOverlay');
const addAngleButton = document.querySelector('#addAngleButton');
const anglesList = document.querySelector('#anglesList');
const videoFps = document.querySelector('#videoFps');
const projectName = document.querySelector('#projectName');
const saveStatus = document.querySelector('#saveStatus');
const importProjectInput = document.querySelector('#importProjectInput');
const exportProjectButton = document.querySelector('#exportProjectButton');
const deleteProjectButton = document.querySelector('#deleteProjectButton');
const exportActiveVideoButton = document.querySelector('#exportActiveVideoButton');
const exportAllVideosButton = document.querySelector('#exportAllVideosButton');
const exportProgress = document.querySelector('#exportProgress');
const athleteSelect = document.querySelector('#athleteSelect');
const detectCurrentButton = document.querySelector('#detectCurrentButton');
const trackSequenceButton = document.querySelector('#trackSequenceButton');
const trackingStatus = document.querySelector('#trackingStatus');

let objectUrl = null;
let activeLandmark = 'proximal';
let fps = 120;
let speedIndex = 0;
let selectionStart = null;
let selectionEnd = null;
let currentVideoMetadata = null;
let restoredVideoMetadata = null;
let saveTimer = null;
let isRestoring = false;
let isExporting = false;
let poseLandmarker = null;
let poseLoadingPromise = null;
let trackingCancelled = false;
let isAutoTracking = false;
const speeds = [1, 0.5, 0.25, 2];
const jointSelect = document.querySelector('#jointSelect');
const angles = [{ id: 1, name: jointSelect.value, joint: jointSelect.value, samples: new Map() }];
let activeAngleId = 1;

function selectedJointName() { return jointSelect.value === 'Personnalisée' ? 'Articulation personnalisée' : jointSelect.value; }
function nextAngleName() {
  const baseName = selectedJointName();
  const sameNameCount = angles.filter((angle) => angle.name === baseName || angle.name.startsWith(`${baseName} (`)).length;
  return sameNameCount ? `${baseName} (${sameNameCount + 1})` : baseName;
}

function activeAngle() { return angles.find((angle) => angle.id === activeAngleId) || angles[0]; }
function activeSamples() { return activeAngle().samples; }

const colors = { proximal: '#00a9b7', joint: '#ee6c54', distal: '#b2c93c' };
const landmarkNames = { proximal: 'Hanche droite', joint: 'Genou droit', distal: 'Cheville droite' };
const jointLandmarks = {
  'Épaule droite': ['Hanche droite', 'Épaule droite', 'Coude droit'],
  'Épaule gauche': ['Hanche gauche', 'Épaule gauche', 'Coude gauche'],
  'Coude droit': ['Épaule droite', 'Coude droit', 'Poignet droit'],
  'Coude gauche': ['Épaule gauche', 'Coude gauche', 'Poignet gauche'],
  'Poignet droit': ['Coude droit', 'Poignet droit', 'Main droite'],
  'Poignet gauche': ['Coude gauche', 'Poignet gauche', 'Main gauche'],
  'Hanche droite': ['Épaule droite', 'Hanche droite', 'Genou droit'],
  'Hanche gauche': ['Épaule gauche', 'Hanche gauche', 'Genou gauche'],
  'Genou droit': ['Hanche droite', 'Genou droit', 'Cheville droite'],
  'Genou gauche': ['Hanche gauche', 'Genou gauche', 'Cheville gauche'],
  'Cheville droite': ['Genou droit', 'Cheville droite', 'Avant-pied droit'],
  'Cheville gauche': ['Genou gauche', 'Cheville gauche', 'Avant-pied gauche'],
  'Cou': ['Sommet de la tête', 'Cou', 'Sternum'],
  'Rachis thoracique': ['Cou', 'Rachis thoracique', 'Rachis lombaire'],
  'Rachis lombaire': ['Rachis thoracique', 'Rachis lombaire', 'Bassin'],
  'Bassin': ['Rachis lombaire', 'Bassin', 'Genou'],
  'Personnalisée': ['Point proximal', 'Sommet de l’angle', 'Point distal'],
};

function updateLandmarkLabels() {
  const labels = jointLandmarks[jointSelect.value] || jointLandmarks.Personnalisée;
  [landmarkNames.proximal, landmarkNames.joint, landmarkNames.distal] = labels;
  document.querySelector('#proximalLabel').textContent = labels[0];
  document.querySelector('#jointLabel').textContent = labels[1];
  document.querySelector('#distalLabel').textContent = labels[2];
  pointingStatus.textContent = `Prêt à pointer ${landmarkNames[activeLandmark].toLowerCase()} sur l’image actuelle.`;
}

function posePoint(landmarks, index) {
  const point = landmarks[index];
  if (!point) return null;
  return { x: point.x, y: point.y, confidence: Math.min(point.visibility ?? 1, point.presence ?? 1) };
}

function averagePosePoints(...points) {
  const valid = points.filter(Boolean); if (!valid.length) return null;
  return { x: valid.reduce((sum, point) => sum + point.x, 0) / valid.length, y: valid.reduce((sum, point) => sum + point.y, 0) / valid.length, confidence: Math.min(...valid.map((point) => point.confidence ?? 1)) };
}

function interpolatePosePoints(first, second, ratio) {
  if (!first || !second) return null;
  return { x: first.x + (second.x - first.x) * ratio, y: first.y + (second.y - first.y) * ratio, confidence: Math.min(first.confidence ?? 1, second.confidence ?? 1) };
}

function posePointsForJoint(landmarks, jointName) {
  const right = jointName.endsWith('droite');
  const shoulder = posePoint(landmarks, right ? 12 : 11); const elbow = posePoint(landmarks, right ? 14 : 13);
  const wrist = posePoint(landmarks, right ? 16 : 15); const hand = posePoint(landmarks, right ? 20 : 19);
  const hip = posePoint(landmarks, right ? 24 : 23); const knee = posePoint(landmarks, right ? 26 : 25);
  const ankle = posePoint(landmarks, right ? 28 : 27); const foot = posePoint(landmarks, right ? 32 : 31);
  const shoulderMid = averagePosePoints(posePoint(landmarks, 11), posePoint(landmarks, 12));
  const hipMid = averagePosePoints(posePoint(landmarks, 23), posePoint(landmarks, 24));
  const kneeMid = averagePosePoints(posePoint(landmarks, 25), posePoint(landmarks, 26));
  const head = averagePosePoints(posePoint(landmarks, 7), posePoint(landmarks, 8), posePoint(landmarks, 0));
  const thoracic = interpolatePosePoints(shoulderMid, hipMid, .38); const lumbar = interpolatePosePoints(shoulderMid, hipMid, .72);
  const mappings = {
    'Épaule droite': [hip, shoulder, elbow], 'Épaule gauche': [hip, shoulder, elbow],
    'Coude droit': [shoulder, elbow, wrist], 'Coude gauche': [shoulder, elbow, wrist],
    'Poignet droit': [elbow, wrist, hand], 'Poignet gauche': [elbow, wrist, hand],
    'Hanche droite': [shoulder, hip, knee], 'Hanche gauche': [shoulder, hip, knee],
    'Genou droit': [hip, knee, ankle], 'Genou gauche': [hip, knee, ankle],
    'Cheville droite': [knee, ankle, foot], 'Cheville gauche': [knee, ankle, foot],
    'Cou': [head, shoulderMid, thoracic], 'Rachis thoracique': [shoulderMid, thoracic, lumbar],
    'Rachis lombaire': [thoracic, lumbar, hipMid], 'Bassin': [lumbar, hipMid, kneeMid],
  };
  return mappings[jointName] || null;
}

async function getPoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;
  if (poseLoadingPromise) return poseLoadingPromise;
  poseLoadingPromise = (async () => {
    if (!window.Vision) throw new Error('Moteur MediaPipe introuvable');
    trackingStatus.textContent = 'Initialisation du modèle local…';
    const fileset = await Vision.FilesetResolver.forVisionTasks('assets/mediapipe/package/wasm');
    const common = { runningMode: 'IMAGE', numPoses: 2, minPoseDetectionConfidence: .45, minPosePresenceConfidence: .45, minTrackingConfidence: .45 };
    try {
      poseLandmarker = await Vision.PoseLandmarker.createFromOptions(fileset, { ...common, baseOptions: { modelAssetPath: 'assets/mediapipe/pose_landmarker_full.task', delegate: 'GPU' } });
    } catch (error) {
      poseLandmarker = await Vision.PoseLandmarker.createFromOptions(fileset, { ...common, baseOptions: { modelAssetPath: 'assets/mediapipe/pose_landmarker_full.task', delegate: 'CPU' } });
    }
    return poseLandmarker;
  })();
  try { return await poseLoadingPromise; } finally { poseLoadingPromise = null; }
}

function applyAutomaticPose(landmarks, angle, frame) {
  const jointName = angle.joint || jointSelect.value; const points = posePointsForJoint(landmarks, jointName);
  if (!points || points.some((point) => !point)) return false;
  const sample = angle.samples.get(frame) || {}; sample._source ||= {}; sample._confidence ||= {};
  ['proximal', 'joint', 'distal'].forEach((landmark, index) => {
    if (sample._source[landmark] === 'manual') return;
    sample[landmark] = { x: points[index].x, y: points[index].y };
    sample._source[landmark] = 'automatic'; sample._confidence[landmark] = points[index].confidence;
  });
  angle.samples.set(frame, sample);
  return { confidence: Math.min(...points.map((point) => point.confidence ?? 1)), estimated: ['Cou', 'Rachis thoracique', 'Rachis lombaire', 'Bassin'].includes(jointName) };
}

async function detectPoseOnCurrentFrame(angle = activeAngle()) {
  if (!video.videoWidth) return false;
  const detector = await getPoseLandmarker(); const result = detector.detect(video);
  const landmarks = result.landmarks?.[Number(athleteSelect.value)];
  if (!landmarks) { trackingStatus.textContent = `Athlète ${Number(athleteSelect.value) + 1} non détecté sur cette image.`; return false; }
  const applied = applyAutomaticPose(landmarks, angle, frameNumber());
  trackingStatus.textContent = applied ? `${angle.joint || jointSelect.value} ${applied.estimated ? 'estimé' : 'détecté'} · confiance ${(applied.confidence * 100).toFixed(0)} % · vérification requise.` : 'Cette articulation ne peut pas être estimée sur cette image.';
  updateResults(); drawOverlay(); scheduleAutosave(); return applied;
}

async function trackActiveSequence() {
  if (isAutoTracking) { trackingCancelled = true; return; }
  isAutoTracking = true; trackingCancelled = false; video.pause(); detectCurrentButton.disabled = true;
  trackSequenceButton.textContent = 'Arrêter'; trackSequenceButton.classList.add('tracking');
  const angle = activeAngle(); const start = selectionStart ?? 0; const end = selectionEnd ?? Math.floor(video.duration * fps);
  const step = Math.max(1, Math.round(fps / 30)); let detected = 0; let attempted = 0;
  try {
    const detector = await getPoseLandmarker();
    for (let frame = start; frame <= end && !trackingCancelled; frame += step) {
      await waitForSeek(Math.min(video.duration - .001, frameTime(frame)));
      const landmarks = detector.detect(video).landmarks?.[Number(athleteSelect.value)];
      attempted += 1; if (landmarks && applyAutomaticPose(landmarks, angle, frame)) detected += 1;
      const progress = ((frame - start) / Math.max(1, end - start)) * 100;
      trackingStatus.textContent = `Analyse de ${angle.joint || jointSelect.value} · ${progress.toFixed(0)} % · ${detected}/${attempted} détections`;
      if (attempted % 3 === 0) { updateResults(); drawOverlay(); await new Promise((resolve) => setTimeout(resolve, 0)); }
    }
    const estimated = ['Cou', 'Rachis thoracique', 'Rachis lombaire', 'Bassin'].includes(angle.joint || jointSelect.value);
    trackingStatus.textContent = trackingCancelled ? `Suivi arrêté · ${detected} images clés conservées.` : `Suivi terminé · ${detected} images clés ${estimated ? 'estimées' : 'automatiques'} à vérifier.`;
    updateResults(); drawOverlay(); scheduleAutosave();
  } catch (error) { trackingStatus.textContent = `Suivi indisponible : ${error.message}`; }
  finally { isAutoTracking = false; trackSequenceButton.textContent = 'Suivre la séquence'; trackSequenceButton.classList.remove('tracking'); detectCurrentButton.disabled = false; }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00.000';
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const rest = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${rest}`;
}

function frameNumber() { return Math.max(0, Math.round(video.currentTime * fps)); }
function frameTime(frame) { return frame / fps; }

function readUint64(view, offset) {
  const high = view.getUint32(offset);
  const low = view.getUint32(offset + 4);
  return high * 4294967296 + low;
}

function boxType(view, offset) {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function childBoxes(view, start = 0, end = view.byteLength) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = boxType(view, offset + 4);
    let headerSize = 8;
    if (size === 1 && offset + 16 <= end) { size = readUint64(view, offset + 8); headerSize = 16; }
    if (size === 0) size = end - offset;
    if (!Number.isFinite(size) || size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, dataStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function findChild(view, parent, type) {
  return childBoxes(view, parent.dataStart, parent.end).find((box) => box.type === type);
}

async function readMp4FrameRate(file) {
  let offset = 0;
  let moovBuffer = null;
  while (offset + 8 <= file.size) {
    const header = new DataView(await file.slice(offset, Math.min(file.size, offset + 16)).arrayBuffer());
    if (header.byteLength < 8) break;
    let size = header.getUint32(0);
    const type = boxType(header, 4);
    let headerSize = 8;
    if (size === 1) { if (header.byteLength < 16) break; size = readUint64(header, 8); headerSize = 16; }
    if (size === 0) size = file.size - offset;
    if (!Number.isFinite(size) || size < headerSize || offset + size > file.size) break;
    if (type === 'moov') { moovBuffer = await file.slice(offset + headerSize, offset + size).arrayBuffer(); break; }
    offset += size;
  }
  if (!moovBuffer) return null;
  const view = new DataView(moovBuffer);
  const root = { dataStart: 0, end: view.byteLength };
  for (const trak of childBoxes(view, root.dataStart, root.end).filter((box) => box.type === 'trak')) {
    const mdia = findChild(view, trak, 'mdia');
    if (!mdia) continue;
    const hdlr = findChild(view, mdia, 'hdlr');
    if (!hdlr || hdlr.dataStart + 12 > hdlr.end || boxType(view, hdlr.dataStart + 8) !== 'vide') continue;
    const mdhd = findChild(view, mdia, 'mdhd');
    const minf = findChild(view, mdia, 'minf');
    const stbl = minf && findChild(view, minf, 'stbl');
    const stts = stbl && findChild(view, stbl, 'stts');
    if (!mdhd || !stts) continue;
    const version = view.getUint8(mdhd.dataStart);
    const timescaleOffset = mdhd.dataStart + (version === 1 ? 20 : 12);
    if (timescaleOffset + 4 > mdhd.end || stts.dataStart + 8 > stts.end) continue;
    const timescale = view.getUint32(timescaleOffset);
    const entryCount = view.getUint32(stts.dataStart + 4);
    let samples = 0; let ticks = 0; const deltas = new Set();
    for (let index = 0; index < entryCount; index += 1) {
      const entry = stts.dataStart + 8 + index * 8;
      if (entry + 8 > stts.end) break;
      const count = view.getUint32(entry); const delta = view.getUint32(entry + 4);
      samples += count; ticks += count * delta; deltas.add(delta);
    }
    if (timescale && samples && ticks) return { fps: samples * timescale / ticks, variable: deltas.size > 1 };
  }
  return null;
}

function formatFps(value) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

function applyFps(value, message) {
  fps = value;
  videoFps.textContent = `${formatFps(fps)} fps`;
  videoFps.title = message;
  updateTransport(); updateResults();
  if (currentVideoMetadata) scheduleAutosave();
}

async function detectFrameRate(file) {
  videoFps.textContent = 'détection fps…';
  try {
    const result = await readMp4FrameRate(file);
    if (!result || !Number.isFinite(result.fps) || result.fps < 1 || result.fps > 1000) throw new Error('Cadence indisponible');
    applyFps(result.fps, `${formatFps(result.fps)} fps détectés${result.variable ? ' · cadence variable' : ''}.`);
  } catch (error) {
    applyFps(120, 'Cadence non détectée · 120 fps appliqués par défaut.');
  }
}

function interpolatedPoint(landmark, frame, angle = activeAngle()) {
  const keyframes = [...angle.samples.entries()]
    .filter(([, sample]) => sample[landmark])
    .sort((first, second) => first[0] - second[0]);
  if (!keyframes.length) return null;
  const exact = keyframes.find(([keyframe]) => keyframe === frame);
  if (exact) return exact[1][landmark];
  const before = [...keyframes].reverse().find(([keyframe]) => keyframe < frame);
  const after = keyframes.find(([keyframe]) => keyframe > frame);
  if (!before || !after) return null;
  const progress = (frame - before[0]) / (after[0] - before[0]);
  return {
    x: before[1][landmark].x + (after[1][landmark].x - before[1][landmark].x) * progress,
    y: before[1][landmark].y + (after[1][landmark].y - before[1][landmark].y) * progress,
  };
}

function interpolatedSample(frame, angle = activeAngle()) {
  return Object.keys(landmarkNames).reduce((sample, landmark) => {
    const point = interpolatedPoint(landmark, frame, angle);
    if (point) sample[landmark] = point;
    return sample;
  }, {});
}

function calculateAngle(sample) {
  if (!sample.proximal || !sample.joint || !sample.distal) return null;
  const first = { x: sample.proximal.x - sample.joint.x, y: sample.proximal.y - sample.joint.y };
  const second = { x: sample.distal.x - sample.joint.x, y: sample.distal.y - sample.joint.y };
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  if (!denominator) return null;
  const cosine = (first.x * second.x + first.y * second.y) / denominator;
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

function resizeCanvas() {
  const bounds = stage.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(bounds.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(bounds.height * devicePixelRatio));
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  drawOverlay();
}

function videoBounds() {
  const scale = Math.min(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  return { left: (stage.clientWidth - width) / 2, top: (stage.clientHeight - height) / 2, width, height };
}

function drawOverlay() {
  if (!video.videoWidth) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  context.clearRect(0, 0, width, height);
  const frame = frameNumber();
  const sample = interpolatedSample(frame);
  if (!sample) return;
  const angle = calculateAngle(sample);
  angleOverlay.hidden = angle === null;
  if (angle !== null) angleOverlay.innerHTML = `ANGLE <span>${angle.toFixed(1)}°</span>`;
  const bounds = videoBounds();
  const points = Object.entries(sample).filter(([, point]) => point);
  if (sample.proximal && sample.joint) drawLine(sample.proximal, sample.joint, bounds, colors.proximal);
  if (sample.joint && sample.distal) drawLine(sample.joint, sample.distal, bounds, colors.distal);
  points.forEach(([name, point]) => {
    const x = bounds.left + point.x * bounds.width;
    const y = bounds.top + point.y * bounds.height;
    context.beginPath(); context.arc(x, y, name === 'joint' ? 7 : 5, 0, Math.PI * 2);
    context.fillStyle = colors[name]; context.fill();
    context.lineWidth = 2; context.strokeStyle = '#ffffff'; context.stroke();
  });
}

function drawLine(first, second, bounds, color) {
  context.beginPath();
  context.moveTo(bounds.left + first.x * bounds.width, bounds.top + first.y * bounds.height);
  context.lineTo(bounds.left + second.x * bounds.width, bounds.top + second.y * bounds.height);
  context.strokeStyle = color; context.lineWidth = 2; context.stroke();
}

function calculateMeasures(angle = activeAngle()) {
  const rows = [...angle.samples.entries()].sort((a, b) => a[0] - b[0]);
  if (!rows.length) return [];
  const firstFrame = rows[0][0];
  const lastFrame = rows.at(-1)[0];
  const origin = interpolatedPoint('joint', firstFrame, angle);
  return Array.from({ length: lastFrame - firstFrame + 1 }, (_, index) => {
    const frame = firstFrame + index;
    const sample = interpolatedSample(frame, angle);
    const displacementX = origin && sample.joint ? (sample.joint.x - origin.x) * video.videoWidth : null;
    const displacementY = origin && sample.joint ? (origin.y - sample.joint.y) * video.videoHeight : null;
    const displacement = displacementX === null || displacementY === null ? null : Math.hypot(displacementX, displacementY);
    let angle = null;
    angle = calculateAngle(sample);
    return { frame, time: frameTime(frame), displacementX, displacementY, displacement, angle };
  });
}

function renderChart(element, values, color, unit) {
  const valid = values.filter((item) => item.value !== null);
  element.innerHTML = '';
  if (!valid.length) { element.innerHTML = '<div class="chart-empty">Aucune mesure disponible</div>'; return; }
  const max = Math.max(...valid.map((item) => item.value), 1);
  const min = Math.min(...valid.map((item) => item.value), 0);
  const range = max - min || 1;
  const width = 500; const height = 150; const padding = 6;
  const points = valid.map((item, index) => `${padding + (index / Math.max(valid.length - 1, 1)) * (width - padding * 2)},${height - padding - ((item.value - min) / range) * (height - padding * 2)}`).join(' ');
  const circles = valid.map((item, index) => { const x = padding + (index / Math.max(valid.length - 1, 1)) * (width - padding * 2); const y = height - padding - ((item.value - min) / range) * (height - padding * 2); return `<circle cx="${x}" cy="${y}" r="3" fill="${color}"/>`; }).join('');
  element.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Courbe ${unit}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>${circles}</svg>`;
}

function renderDisplacementChart(measures) {
  const series = [
    { values: measures.map((item) => item.displacementX), color: colors.proximal, label: 'X' },
    { values: measures.map((item) => item.displacementY), color: colors.distal, label: 'Y' },
  ];
  const valid = series.flatMap((item) => item.values).filter((value) => value !== null);
  displacementChart.innerHTML = '';
  if (!valid.length) { displacementChart.innerHTML = '<div class="chart-empty">Les positions pointées apparaîtront ici</div>'; return; }
  const max = Math.max(...valid, 1); const min = Math.min(...valid, -1); const range = max - min || 1;
  const width = 500; const height = 150; const padding = 6;
  const lines = series.map((item) => {
    const points = item.values.map((value, index) => value === null ? null : `${padding + (index / Math.max(item.values.length - 1, 1)) * (width - padding * 2)},${height - padding - ((value - min) / range) * (height - padding * 2)}`).filter(Boolean).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${item.color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  displacementChart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Courbes des déplacements X et Y">${lines}</svg>`;
}

function openProjectDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fighttrack-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function projectSnapshot() {
  return {
    format: 'fighttrack-project', version: 1, savedAt: new Date().toISOString(),
    projectName: projectName.value.trim() || 'Analyse sans titre', joint: jointSelect.value,
    fps, selectionStart, selectionEnd, activeAngleId, video: currentVideoMetadata || restoredVideoMetadata,
    angles: angles.map((angle) => ({ id: angle.id, name: angle.name, joint: angle.joint, samples: [...angle.samples.entries()] })),
  };
}

async function writeAutosave() {
  if (isRestoring) return;
  try {
    const database = await openProjectDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readwrite');
      transaction.objectStore('projects').put(projectSnapshot(), 'autosave');
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    saveStatus.textContent = `Sauvegardé localement à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) { saveStatus.textContent = 'Sauvegarde locale indisponible'; }
}

function scheduleAutosave() {
  if (isRestoring) return;
  saveStatus.textContent = 'Sauvegarde…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeAutosave, 250);
}

async function readAutosave() {
  try {
    const database = await openProjectDatabase();
    const data = await new Promise((resolve, reject) => {
      const request = database.transaction('projects', 'readonly').objectStore('projects').get('autosave');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    database.close(); return data;
  } catch (error) { return null; }
}

function applyProject(data) {
  if (!data || data.format !== 'fighttrack-project' || !Array.isArray(data.angles)) throw new Error('Projet FightTrack invalide');
  isRestoring = true;
  projectName.value = data.projectName || 'Analyse sans titre';
  if ([...jointSelect.options].some((option) => option.value === data.joint)) jointSelect.value = data.joint;
  fps = Number(data.fps) || 120; selectionStart = data.selectionStart ?? null; selectionEnd = data.selectionEnd ?? null;
  angles.splice(0, angles.length, ...data.angles.map((angle, index) => ({
    id: Number(angle.id) || index + 1, name: angle.name || `Angle ${index + 1}`, joint: angle.joint || angle.name?.replace(/ \(\d+\)$/, '') || data.joint,
    samples: new Map((angle.samples || []).map(([frame, sample]) => [Number(frame), sample])),
  })));
  if (!angles.length) angles.push({ id: 1, name: selectedJointName(), joint: jointSelect.value, samples: new Map() });
  activeAngleId = angles.some((angle) => angle.id === data.activeAngleId) ? data.activeAngleId : angles[0].id;
  restoredVideoMetadata = data.video || null;
  videoFps.textContent = `${formatFps(fps)} fps`;
  updateLandmarkLabels(); updateSelectionLabel(); renderAngles(); updateResults(); drawOverlay();
  isRestoring = false;
  saveStatus.textContent = data.savedAt ? `Travail restauré · ${new Date(data.savedAt).toLocaleString('fr-FR')}` : 'Travail restauré';
}

function safeFileName(value) {
  return (value || 'fighttrack').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'fighttrack';
}

function downloadBlob(blob, name) {
  const link = document.createElement('a'); const url = URL.createObjectURL(blob);
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderAngles() {
  anglesList.innerHTML = '';
  angles.forEach((angle) => {
    const card = document.createElement('div'); card.className = `angle-card${angle.id === activeAngleId ? ' active' : ''}`;
    const select = document.createElement('button'); select.className = 'angle-select'; select.type = 'button'; select.textContent = angle.id === activeAngleId ? '●' : '○'; select.title = 'Afficher cet angle sur la vidéo';
    select.addEventListener('click', () => { activeAngleId = angle.id; if (angle.joint && [...jointSelect.options].some((option) => option.value === angle.joint)) { jointSelect.value = angle.joint; updateLandmarkLabels(); } renderAngles(); updateResults(); drawOverlay(); scheduleAutosave(); });
    const input = document.createElement('input'); input.className = 'angle-name'; input.value = angle.name; input.setAttribute('aria-label', `Nom de ${angle.name}`);
    input.addEventListener('change', () => { angle.name = input.value.trim() || selectedJointName(); renderAngles(); scheduleAutosave(); });
    const info = document.createElement('span'); info.className = 'angle-info'; info.textContent = `${angle.samples.size} frame${angle.samples.size > 1 ? 's' : ''} clé${angle.samples.size > 1 ? 's' : ''}`;
    card.append(select, input, info); anglesList.append(card);
  });
}

function updateResults() {
  const measures = calculateMeasures();
  renderDisplacementChart(measures);
  renderChart(angleChart, measures.map((item) => ({ value: item.angle })), colors.joint, 'angle');
  const latest = measures.at(-1);
  displacementValue.textContent = latest?.displacementX === null || latest?.displacementX === undefined ? 'X -- · Y --' : `X ${latest.displacementX.toFixed(1)} · Y ${latest.displacementY.toFixed(1)} px`;
  angleValue.textContent = latest?.angle === null || latest?.angle === undefined ? '-- °' : `${latest.angle.toFixed(1)} °`;
  document.querySelector('#metricsResults').style.display = measures.length ? 'flex' : 'none';
  document.querySelector('#metricsCharts').style.display = measures.length ? 'grid' : 'none';
  exportButton.disabled = measures.length === 0 || !video.videoWidth;
  const hasVideoMeasures = Boolean(video.videoWidth && angles.some((item) => item.samples.size));
  exportActiveVideoButton.disabled = !hasVideoMeasures || isExporting;
  exportAllVideosButton.disabled = !hasVideoMeasures || isExporting;
  renderAngles();
}

function updateTransport() {
  timeline.value = video.duration ? Math.round((video.currentTime / video.duration) * 1000) : 0;
  currentTimeLabel.textContent = formatTime(video.currentTime);
  durationLabel.textContent = formatTime(video.duration);
  frameBadge.textContent = frameNumber().toString().padStart(4, '0');
  if (!isExporting && !video.paused && selectionEnd !== null && frameNumber() >= selectionEnd) {
    video.pause();
    seekToFrame(selectionStart ?? selectionEnd);
  }
  drawOverlay();
}

function seekToFrame(frame) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const target = Math.max(0, Math.min(Math.max(0, video.duration - 0.001), frameTime(frame)));
  video.pause();
  video.currentTime = target;
  updateTransport();
}

function loadVideoFile(file) {
  if (!file) return;
  const metadata = { name: file.name, size: file.size, lastModified: file.lastModified, type: file.type };
  const reference = currentVideoMetadata || restoredVideoMetadata;
  const sameVideo = reference && reference.name === metadata.name && reference.size === metadata.size && reference.lastModified === metadata.lastModified;
  const hasMarks = angles.some((angle) => angle.samples.size);
  if (hasMarks && !sameVideo && !window.confirm('Cette vidéo est différente du projet en cours. Charger cette vidéo effacera les pointages actuels. Continuer ?')) return;
  currentVideoMetadata = metadata;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl; video.load(); fileName.textContent = file.name;
  frameControls.forEach((control) => { control.disabled = false; });
  detectCurrentButton.disabled = false; trackSequenceButton.disabled = false;
  setStartButton.disabled = false; setEndButton.disabled = false;
  if (!sameVideo) {
    selectionStart = null; selectionEnd = null; selectionLabel.textContent = 'Aucune séquence sélectionnée'; reviewButton.disabled = true;
    angles.forEach((angle) => angle.samples.clear());
  } else updateSelectionLabel();
  updateResults();
  addAngleButton.disabled = false;
  detectFrameRate(file);
  scheduleAutosave();
}

videoInput.addEventListener('change', () => loadVideoFile(videoInput.files[0]));
stage.addEventListener('dragover', (event) => { event.preventDefault(); stage.classList.add('dragging'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragging'));
stage.addEventListener('drop', (event) => {
  event.preventDefault(); stage.classList.remove('dragging');
  const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('video/'));
  loadVideoFile(file);
});
video.addEventListener('loadedmetadata', () => {
  stage.classList.add('loaded'); emptyState.hidden = true;
  document.querySelector('#videoResolution').textContent = `${video.videoWidth} × ${video.videoHeight}`;
  resizeCanvas(); updateTransport();
});
video.addEventListener('timeupdate', updateTransport);
video.addEventListener('play', () => { playButton.textContent = 'Ⅱ'; });
video.addEventListener('pause', () => { playButton.textContent = '▶'; });
video.addEventListener('ended', () => { playButton.textContent = '▶'; });
window.addEventListener('resize', resizeCanvas);
playButton.addEventListener('click', () => video.paused ? video.play() : video.pause());
timeline.addEventListener('input', () => seekToFrame(Math.round((timeline.value / 1000) * fps * video.duration)));
document.querySelector('#previousFrame').addEventListener('click', () => { video.pause(); seekToFrame(frameNumber() - 1); });
document.querySelector('#nextFrame').addEventListener('click', () => { video.pause(); seekToFrame(frameNumber() + 1); });
video.addEventListener('seeked', updateTransport);
document.querySelector('#speedButton').addEventListener('click', (event) => { speedIndex = (speedIndex + 1) % speeds.length; video.playbackRate = speeds[speedIndex]; event.currentTarget.textContent = `${speeds[speedIndex]}×`; });
function updateSelectionLabel() {
  if (selectionStart === null || selectionEnd === null) { selectionLabel.textContent = selectionStart === null ? 'Aucune séquence sélectionnée' : `Début : ${formatTime(frameTime(selectionStart))} · choisissez une fin`; reviewButton.disabled = true; return; }
  selectionLabel.textContent = `Séquence : ${formatTime(frameTime(selectionStart))} → ${formatTime(frameTime(selectionEnd))}`;
  reviewButton.disabled = false;
}
setStartButton.addEventListener('click', () => { selectionStart = frameNumber(); if (selectionEnd !== null && selectionEnd <= selectionStart) selectionEnd = null; updateSelectionLabel(); scheduleAutosave(); });
setEndButton.addEventListener('click', () => { const current = frameNumber(); if (selectionStart === null) selectionStart = 0; selectionEnd = Math.max(selectionStart + 1, current); updateSelectionLabel(); scheduleAutosave(); });
reviewButton.addEventListener('click', () => { if (selectionStart === null || selectionEnd === null) return; seekToFrame(selectionStart); video.play(); });
addAngleButton.addEventListener('click', () => { const id = Math.max(...angles.map((angle) => angle.id)) + 1; angles.push({ id, name: nextAngleName(), joint: jointSelect.value, samples: new Map() }); activeAngleId = id; renderAngles(); updateResults(); scheduleAutosave(); });
jointSelect.addEventListener('change', () => { updateLandmarkLabels(); const angle = activeAngle(); if (angle.samples.size === 0) { angle.joint = jointSelect.value; angle.name = nextAngleName(); renderAngles(); } scheduleAutosave(); });
projectName.addEventListener('input', scheduleAutosave);
detectCurrentButton.addEventListener('click', () => detectPoseOnCurrentFrame());
trackSequenceButton.addEventListener('click', trackActiveSequence);
document.querySelectorAll('.landmark').forEach((button) => button.addEventListener('click', () => {
  activeLandmark = button.dataset.landmark;
  document.querySelectorAll('.landmark').forEach((item) => item.classList.toggle('active', item === button));
  pointingStatus.textContent = `Prêt à pointer ${landmarkNames[activeLandmark].toLowerCase()} sur l’image actuelle.`;
}));
window.addEventListener('keydown', (event) => { if (event.target.matches('input, select')) return; const selected = { '1': 'proximal', '2': 'joint', '3': 'distal' }[event.key]; if (selected) document.querySelector(`[data-landmark="${selected}"]`).click(); if (event.code === 'Space') { event.preventDefault(); playButton.click(); } if (event.key === 'ArrowLeft') seekToFrame(frameNumber() - 1); if (event.key === 'ArrowRight') seekToFrame(frameNumber() + 1); });
canvas.addEventListener('click', (event) => {
  if (!video.videoWidth) return;
  const bounds = videoBounds();
  const stageBounds = stage.getBoundingClientRect();
  const x = (event.clientX - stageBounds.left - bounds.left) / bounds.width;
  const y = (event.clientY - stageBounds.top - bounds.top) / bounds.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  const frame = frameNumber();
  const sample = activeSamples().get(frame) || {};
  sample[activeLandmark] = { x, y };
  sample._source ||= {}; sample._source[activeLandmark] = 'manual';
  activeSamples().set(frame, sample);
  pointingStatus.textContent = `Frame clé enregistrée : ${landmarkNames[activeLandmark]} à l’image ${frame.toString().padStart(4, '0')}.`;
  updateResults(); drawOverlay(); scheduleAutosave();
});
function csvValue(value, digits = 2) { return value === null || value === undefined ? '' : value.toFixed(digits).replace('.', ','); }

exportButton.addEventListener('click', () => {
  const lines = ['projet;angle;frame;temps_s;deplacement_x_px;deplacement_y_px;deplacement_total_px;angle_deg'];
  angles.forEach((angle) => calculateMeasures(angle).forEach((row) => lines.push([
    projectName.value.trim(), angle.name, row.frame, row.time.toFixed(6).replace('.', ','),
    csvValue(row.displacementX), csvValue(row.displacementY), csvValue(row.displacement), csvValue(row.angle),
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';'))));
  downloadBlob(new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }), `${safeFileName(projectName.value)}-mesures.csv`);
});

exportProjectButton.addEventListener('click', () => {
  const content = JSON.stringify(projectSnapshot(), null, 2);
  downloadBlob(new Blob([content], { type: 'application/json' }), `${safeFileName(projectName.value)}.fighttrack.json`);
});

importProjectInput.addEventListener('change', async () => {
  const file = importProjectInput.files[0]; if (!file) return;
  try { applyProject(JSON.parse(await file.text())); await writeAutosave(); }
  catch (error) { window.alert('Ce fichier ne contient pas un projet FightTrack valide.'); }
  importProjectInput.value = '';
});

deleteProjectButton.addEventListener('click', async () => {
  if (!window.confirm('Effacer définitivement la sauvegarde locale et tous les pointages du projet en cours ?')) return;
  try {
    const database = await openProjectDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readwrite'); transaction.objectStore('projects').delete('autosave');
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch (error) { /* L’état en mémoire est tout de même réinitialisé. */ }
  angles.splice(0, angles.length, { id: 1, name: selectedJointName(), joint: jointSelect.value, samples: new Map() }); activeAngleId = 1;
  selectionStart = null; selectionEnd = null; restoredVideoMetadata = null; currentVideoMetadata = null;
  projectName.value = 'Analyse sans titre'; updateSelectionLabel(); updateResults(); drawOverlay(); renderAngles();
  saveStatus.textContent = 'Données locales effacées';
});

function drawAnnotatedAngle(exportContext, angle, frame, hueIndex, combined) {
  const sample = interpolatedSample(frame, angle); const angleValueForFrame = calculateAngle(sample);
  if (!Object.keys(sample).length) return;
  const palette = ['#10c8f4', '#ee6c54', '#b2c93c', '#b889ff', '#ffca55', '#46df9b'];
  const color = combined ? palette[hueIndex % palette.length] : '#10c8f4';
  const points = Object.fromEntries(Object.entries(sample).map(([key, point]) => [key, { x: point.x * video.videoWidth, y: point.y * video.videoHeight }]));
  exportContext.save(); exportContext.lineWidth = Math.max(3, video.videoWidth / 500); exportContext.strokeStyle = color;
  if (points.proximal && points.joint) { exportContext.beginPath(); exportContext.moveTo(points.proximal.x, points.proximal.y); exportContext.lineTo(points.joint.x, points.joint.y); exportContext.stroke(); }
  if (points.joint && points.distal) { exportContext.beginPath(); exportContext.moveTo(points.joint.x, points.joint.y); exportContext.lineTo(points.distal.x, points.distal.y); exportContext.stroke(); }
  Object.entries(points).forEach(([name, point]) => {
    exportContext.beginPath(); exportContext.arc(point.x, point.y, Math.max(name === 'joint' ? 8 : 6, video.videoWidth / 180), 0, Math.PI * 2);
    exportContext.fillStyle = name === 'joint' ? '#ee6c54' : color; exportContext.fill(); exportContext.strokeStyle = '#fff'; exportContext.stroke();
  });
  if (points.joint && angleValueForFrame !== null) {
    const fontSize = Math.max(18, Math.round(video.videoWidth / 55)); exportContext.font = `600 ${fontSize}px Arial`;
    const label = `${angle.name} · ${angleValueForFrame.toFixed(1)}°`; const x = points.joint.x + fontSize; const y = points.joint.y - fontSize;
    const width = exportContext.measureText(label).width; exportContext.fillStyle = 'rgba(2,13,26,.82)'; exportContext.fillRect(x - 7, y - fontSize, width + 14, fontSize * 1.35);
    exportContext.fillStyle = '#fff'; exportContext.fillText(label, x, y);
  }
  exportContext.restore();
}

function recorderFormat() {
  const formats = [
    { mime: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mime: 'video/webm', extension: 'webm' },
    { mime: 'video/mp4', extension: 'mp4' },
  ];
  return formats.find((format) => MediaRecorder.isTypeSupported(format.mime));
}

function waitForSeek(time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.002) { resolve(); return; }
    video.addEventListener('seeked', resolve, { once: true }); video.currentTime = time;
  });
}

async function recordAnnotatedVideo(includedAngles, outputName, progressPrefix) {
  const format = recorderFormat(); if (!format) throw new Error('Aucun format d’export vidéo compatible avec ce navigateur.');
  const exportCanvas = document.createElement('canvas'); exportCanvas.width = video.videoWidth; exportCanvas.height = video.videoHeight;
  const exportContext = exportCanvas.getContext('2d'); const canvasStream = exportCanvas.captureStream(Math.min(120, Math.max(1, Math.round(fps))));
  let sourceStream = null; try { sourceStream = video.captureStream ? video.captureStream() : null; } catch (error) { sourceStream = null; }
  const outputStream = new MediaStream([...canvasStream.getVideoTracks(), ...(sourceStream ? sourceStream.getAudioTracks() : [])]);
  const recorder = new MediaRecorder(outputStream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000 }); const chunks = [];
  recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
  const result = new Promise((resolve, reject) => { recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: format.mime })), { once: true }); recorder.addEventListener('error', () => reject(recorder.error), { once: true }); });
  const startFrame = selectionStart ?? 0; const endFrame = selectionEnd ?? Math.max(startFrame + 1, Math.floor(video.duration * fps));
  const startTime = frameTime(startFrame); const endTime = Math.min(video.duration, frameTime(endFrame));
  await waitForSeek(startTime); video.playbackRate = 1; recorder.start(1000);
  let stopped = false;
  const paint = () => {
    exportContext.drawImage(video, 0, 0, exportCanvas.width, exportCanvas.height);
    const frame = frameNumber(); includedAngles.forEach((angle, index) => drawAnnotatedAngle(exportContext, angle, frame, index, includedAngles.length > 1));
    const progress = Math.min(100, Math.max(0, ((video.currentTime - startTime) / Math.max(0.001, endTime - startTime)) * 100));
    exportProgress.textContent = `${progressPrefix} · ${progress.toFixed(0)} %`;
    if (!stopped && !video.paused && video.currentTime < endTime) requestAnimationFrame(paint);
  };
  const finish = () => { if (stopped) return; stopped = true; video.pause(); if (recorder.state !== 'inactive') recorder.stop(); };
  video.addEventListener('timeupdate', () => { if (video.currentTime >= endTime) finish(); }, { signal: (() => { const controller = new AbortController(); recorder.addEventListener('stop', () => controller.abort(), { once: true }); return controller.signal; })() });
  video.addEventListener('ended', finish, { once: true });
  await video.play(); paint();
  if (video.currentTime >= endTime) finish();
  const blob = await result; outputStream.getTracks().forEach((track) => track.stop());
  downloadBlob(blob, `${safeFileName(projectName.value)}-${safeFileName(outputName)}.${format.extension}`);
}

async function runVideoExports(mode) {
  if (isExporting || !video.videoWidth) return;
  isExporting = true; updateResults(); const originalTime = video.currentTime; const originalRate = video.playbackRate;
  try {
    const populated = angles.filter((angle) => angle.samples.size);
    if (mode === 'active') await recordAnnotatedVideo([activeAngle()], activeAngle().name, `Export ${activeAngle().name}`);
    else {
      exportButton.click();
      await recordAnnotatedVideo(populated, 'tous-les-angles', 'Vidéo avec tous les angles');
      for (let index = 0; index < populated.length; index += 1) await recordAnnotatedVideo([populated[index]], populated[index].name, `Vidéo ${index + 1}/${populated.length}`);
    }
    exportProgress.textContent = 'Export vidéo terminé';
  } catch (error) { exportProgress.textContent = `Échec de l’export : ${error.message}`; }
  finally { isExporting = false; video.playbackRate = originalRate; await waitForSeek(originalTime); updateResults(); }
}

exportActiveVideoButton.addEventListener('click', () => runVideoExports('active'));
exportAllVideosButton.addEventListener('click', () => runVideoExports('all'));

async function initializeProject() {
  renderAngles(); updateLandmarkLabels();
  const saved = await readAutosave(); if (saved) { try { applyProject(saved); } catch (error) { saveStatus.textContent = 'Sauvegarde locale illisible'; } }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

initializeProject();
