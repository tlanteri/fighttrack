const videoInput = document.querySelector('#videoInput');
const video = document.querySelector('#video');
const stage = document.querySelector('#videoStage');
const canvas = document.querySelector('#overlayCanvas');
const context = canvas.getContext('2d');
const markerLayer = document.querySelector('#markerLayer');
const emptyState = document.querySelector('#emptyState');
const timeline = document.querySelector('#timeline');
const timelineAngleSegments = document.querySelector('#timelineAngleSegments');
const playButton = document.querySelector('#playButton');
const currentTimeLabel = document.querySelector('#currentTime');
const durationLabel = document.querySelector('#duration');
const frameBadge = document.querySelector('#frameBadge span');
const fileName = document.querySelector('#fileName');
const exportButton = document.querySelector('#exportButton');
const pointingStatus = document.querySelector('#pointingStatus');
const frameControls = [playButton, document.querySelector('#previousFrame'), document.querySelector('#nextFrame')];
const setStartButton = document.querySelector('#setStartButton');
const setEndButton = document.querySelector('#setEndButton');
const reviewButton = document.querySelector('#reviewButton');
const selectionLabel = document.querySelector('#selectionLabel');
const undoButton = document.querySelector('#undoButton');
const selectionOverlay = document.querySelector('#selectionOverlay');
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
const shareButton = document.querySelector('#shareButton');
const shareDialog = document.querySelector('#shareDialog');
const shareDialogClose = document.querySelector('#shareDialogClose');

shareButton.addEventListener('click', () => shareDialog.showModal());
shareDialogClose.addEventListener('click', () => shareDialog.close());
shareDialog.addEventListener('click', (event) => {
  const bounds = shareDialog.getBoundingClientRect();
  const isOutside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  if (isOutside) shareDialog.close();
});

let objectUrl = null;
let activeLandmark = 'joint';
let fps = 120;
let speedIndex = 0;
let currentVideoMetadata = null;
let restoredVideoMetadata = null;
let saveTimer = null;
let isRestoring = false;
let isExporting = false;
const undoStack = [];
const redoStack = [];
const historyLimit = 60;
const speeds = [1, 0.5, 0.25, 2];
const jointSelect = document.querySelector('#jointSelect');
const angles = [{ id: 1, name: jointSelect.value, joint: jointSelect.value, selectionStart: null, selectionEnd: null, samples: new Map() }];
let activeAngleId = 1;

function selectedJointName() { return jointSelect.value === 'Personnalisée' ? 'Articulation personnalisée' : jointSelect.value; }
function nextAngleName() {
  const baseName = selectedJointName();
  const sameNameCount = angles.filter((angle) => angle.name === baseName || angle.name.startsWith(`${baseName} (`)).length;
  return sameNameCount ? `${baseName} (${sameNameCount + 1})` : baseName;
}

function activeAngle() { return angles.find((angle) => angle.id === activeAngleId) || angles[0]; }
function activeSamples() { return activeAngle().samples; }

function editingSnapshot() {
  return {
    activeAngleId,
    joint: jointSelect.value,
    angles: angles.map((angle) => ({ ...angle, samples: new Map(structuredClone([...angle.samples.entries()])) })),
  };
}

function updateUndoButton() { undoButton.disabled = undoStack.length === 0; }
function rememberForUndo() {
  undoStack.push(editingSnapshot());
  if (undoStack.length > historyLimit) undoStack.shift();
  redoStack.length = 0;
  updateUndoButton();
}

function restoreEditingSnapshot(snapshot) {
  angles.splice(0, angles.length, ...snapshot.angles.map((angle) => ({ ...angle, samples: new Map(angle.samples) })));
  activeAngleId = angles.some((angle) => angle.id === snapshot.activeAngleId) ? snapshot.activeAngleId : angles[0].id;
  jointSelect.value = activeAngle().joint || snapshot.joint;
  updateLandmarkLabels(); updateSelectionLabel(); updateResults(); drawOverlay(); scheduleAutosave();
}

function undoEditing() {
  if (!undoStack.length) return;
  redoStack.push(editingSnapshot());
  restoreEditingSnapshot(undoStack.pop());
  updateUndoButton();
}

function redoEditing() {
  if (!redoStack.length) return;
  undoStack.push(editingSnapshot());
  restoreEditingSnapshot(redoStack.pop());
  updateUndoButton();
}

const colors = { proximal: '#00a9b7', joint: '#ee6c54', distal: '#b2c93c' };
const angleColors = ['#10c8f4', '#ee6c54', '#b2c93c', '#b889ff', '#ffca55', '#46df9b'];
function angleColor(angle) { return angleColors[Math.max(0, angles.findIndex((item) => item.id === angle.id)) % angleColors.length]; }
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
  markerLayer.innerHTML = '';
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
    context.beginPath(); context.arc(x, y, name === 'joint' ? 11 : 9, 0, Math.PI * 2);
    context.fillStyle = 'rgba(0, 0, 0, .45)'; context.fill();
    context.beginPath(); context.arc(x, y, name === 'joint' ? 8 : 6, 0, Math.PI * 2);
    context.fillStyle = colors[name]; context.fill();
    context.lineWidth = 3; context.strokeStyle = '#ffffff'; context.stroke();
    const marker = document.createElement('span');
    marker.className = `video-marker ${name}${name === activeLandmark ? ' selected' : ''}`;
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    marker.title = landmarkNames[name];
    markerLayer.append(marker);
  });
}

function drawLine(first, second, bounds, color) {
  context.beginPath();
  context.moveTo(bounds.left + first.x * bounds.width, bounds.top + first.y * bounds.height);
  context.lineTo(bounds.left + second.x * bounds.width, bounds.top + second.y * bounds.height);
  context.strokeStyle = color; context.lineWidth = 2; context.stroke();
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
    fps, activeAngleId, video: currentVideoMetadata || restoredVideoMetadata,
    angles: angles.map((angle) => ({ id: angle.id, name: angle.name, joint: angle.joint, selectionStart: angle.selectionStart, selectionEnd: angle.selectionEnd, samples: [...angle.samples.entries()] })),
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
  fps = Number(data.fps) || 120;
  angles.splice(0, angles.length, ...data.angles.map((angle, index) => ({
    id: Number(angle.id) || index + 1, name: angle.name || `Angle ${index + 1}`, joint: angle.joint || angle.name?.replace(/ \(\d+\)$/, '') || data.joint,
    selectionStart: angle.selectionStart ?? data.selectionStart ?? null, selectionEnd: angle.selectionEnd ?? data.selectionEnd ?? null,
    samples: new Map((angle.samples || []).map(([frame, sample]) => [Number(frame), sample])),
  })));
  if (!angles.length) angles.push({ id: 1, name: selectedJointName(), joint: jointSelect.value, selectionStart: null, selectionEnd: null, samples: new Map() });
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
    card.style.setProperty('--angle-color', angleColor(angle));
    const color = document.createElement('i'); color.className = 'angle-color'; color.title = `Couleur de ${angle.name}`;
    const select = document.createElement('button'); select.className = 'angle-select'; select.type = 'button'; select.textContent = angle.id === activeAngleId ? '●' : '○'; select.title = 'Afficher cet angle sur la vidéo';
    select.addEventListener('click', () => { activeAngleId = angle.id; if (angle.joint && [...jointSelect.options].some((option) => option.value === angle.joint)) { jointSelect.value = angle.joint; updateLandmarkLabels(); } updateSelectionLabel(); renderAngles(); updateResults(); drawOverlay(); scheduleAutosave(); });
    const input = document.createElement('input'); input.className = 'angle-name'; input.value = angle.name; input.setAttribute('aria-label', `Nom de ${angle.name}`);
    input.addEventListener('change', () => {
      const newName = input.value.trim() || selectedJointName();
      if (newName === angle.name) return;
      rememberForUndo(); angle.name = newName; input.value = newName;
      input.setAttribute('aria-label', `Nom de ${newName}`);
      renderTimelineAngleSegments(); scheduleAutosave();
    });
    const landmarkCount = [...angle.samples.values()].reduce((total, sample) => total + ['proximal', 'joint', 'distal'].filter((name) => sample[name]).length, 0);
    const sequenceCount = angle.selectionStart !== null && angle.selectionEnd !== null ? angle.selectionEnd - angle.selectionStart + 1 : 0;
    const info = document.createElement('span'); info.className = 'angle-info'; info.textContent = `${angle.samples.size} clé${angle.samples.size > 1 ? 's' : ''} · ${landmarkCount} repère${landmarkCount > 1 ? 's' : ''}${sequenceCount ? ` · ${sequenceCount} images` : ''}`;
    const remove = document.createElement('button'); remove.className = 'angle-delete'; remove.type = 'button'; remove.textContent = '×'; remove.disabled = angles.length === 1; remove.title = angles.length === 1 ? 'Le projet doit conserver au moins un angle' : `Supprimer ${angle.name}`;
    remove.addEventListener('click', () => {
      if (angles.length === 1 || !window.confirm(`Supprimer l’angle « ${angle.name} » et tous ses pointages ?`)) return;
      rememberForUndo();
      const index = angles.findIndex((item) => item.id === angle.id);
      angles.splice(index, 1);
      if (activeAngleId === angle.id) activeAngleId = angles[Math.min(index, angles.length - 1)].id;
      jointSelect.value = activeAngle().joint || jointSelect.value;
      card.remove();
      updateLandmarkLabels(); updateSelectionLabel(); updateResults(); drawOverlay(); scheduleAutosave();
    });
    card.append(color, select, input, info, remove); anglesList.append(card);
  });
}

function renderTimelineAngleSegments() {
  timelineAngleSegments.innerHTML = '';
  if (!video.duration || !Number.isFinite(video.duration)) return;
  const totalFrames = Math.max(1, Math.floor(video.duration * fps));
  const addSelectionMarker = (angle, frame, type) => {
    if (frame === null) return;
    const marker = document.createElement('button');
    marker.type = 'button'; marker.className = `timeline-selection-marker ${type}${angle.id === activeAngleId ? ' active-angle' : ''}`;
    marker.style.setProperty('--angle-color', angleColor(angle));
    marker.style.left = `${Math.min(100, frame / totalFrames * 100)}%`;
    marker.textContent = '';
    marker.title = `${angle.name} · ${type === 'start' ? 'début' : 'fin'} · image ${frame} · ${formatTime(frameTime(frame))}`;
    marker.setAttribute('aria-label', marker.title);
    marker.addEventListener('click', () => { activeAngleId = angle.id; if (angle.joint) jointSelect.value = angle.joint; updateLandmarkLabels(); updateSelectionLabel(); seekToFrame(frame); updateResults(); });
    timelineAngleSegments.append(marker);
  };
  angles.forEach((angle) => {
    addSelectionMarker(angle, angle.selectionStart ?? null, 'start');
    addSelectionMarker(angle, angle.selectionEnd ?? null, 'end');
  });
}

function updateResults() {
  const hasAnySamples = angles.some((item) => item.samples.size > 0);
  exportButton.disabled = !hasAnySamples;
  const hasVideoMeasures = Boolean(video.videoWidth && hasAnySamples);
  exportActiveVideoButton.disabled = !hasVideoMeasures || isExporting;
  exportAllVideosButton.disabled = !hasVideoMeasures || isExporting;
  renderAngles();
  renderTimelineAngleSegments();
}

function updateTransport() {
  timeline.value = video.duration ? Math.round((video.currentTime / video.duration) * 1000) : 0;
  currentTimeLabel.textContent = formatTime(video.currentTime);
  durationLabel.textContent = formatTime(video.duration);
  frameBadge.textContent = frameNumber().toString().padStart(4, '0');
  const angle = activeAngle();
  if (!isExporting && !video.paused && angle.selectionEnd !== null && frameNumber() >= angle.selectionEnd) {
    video.pause();
    seekToFrame(angle.selectionStart ?? angle.selectionEnd);
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
  setStartButton.disabled = false; setEndButton.disabled = false;
  if (!sameVideo) {
    angles.forEach((angle) => { angle.selectionStart = null; angle.selectionEnd = null; angle.samples.clear(); }); updateSelectionLabel();
  } else updateSelectionLabel();
  updateResults();
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
  requestAnimationFrame(() => { resizeCanvas(); updateTransport(); renderTimelineAngleSegments(); });
});
new ResizeObserver(resizeCanvas).observe(stage);
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
  const angle = activeAngle(); const selectionStart = angle.selectionStart ?? null; const selectionEnd = angle.selectionEnd ?? null;
  if (selectionStart === null || selectionEnd === null) {
    selectionLabel.textContent = selectionStart === null ? 'Aucune séquence sélectionnée' : `Début : image ${selectionStart} · ${formatTime(frameTime(selectionStart))} · choisissez une fin`;
    selectionOverlay.hidden = selectionStart === null;
    selectionOverlay.textContent = selectionStart === null ? '' : `DÉBUT · IMAGE ${selectionStart}`;
    renderTimelineAngleSegments();
    reviewButton.disabled = true; return;
  }
  const frameCount = selectionEnd - selectionStart + 1;
  selectionLabel.textContent = `Images ${selectionStart} → ${selectionEnd} · ${frameCount} images · ${formatTime(frameTime(selectionStart))} → ${formatTime(frameTime(selectionEnd))}`;
  selectionOverlay.hidden = false;
  selectionOverlay.innerHTML = `DÉBUT <strong>${selectionStart}</strong><span>${frameCount} IMAGES</span>FIN <strong>${selectionEnd}</strong>`;
  renderTimelineAngleSegments();
  reviewButton.disabled = false;
}
undoButton.addEventListener('click', undoEditing);
setStartButton.addEventListener('click', () => { rememberForUndo(); const angle = activeAngle(); angle.selectionStart = frameNumber(); if (angle.selectionEnd !== null && angle.selectionEnd <= angle.selectionStart) angle.selectionEnd = null; updateSelectionLabel(); scheduleAutosave(); });
setEndButton.addEventListener('click', () => { rememberForUndo(); const angle = activeAngle(); const current = frameNumber(); if (angle.selectionStart === null) angle.selectionStart = 0; angle.selectionEnd = Math.max(angle.selectionStart + 1, current); updateSelectionLabel(); scheduleAutosave(); });
reviewButton.addEventListener('click', () => { const angle = activeAngle(); if (angle.selectionStart === null || angle.selectionEnd === null) return; seekToFrame(angle.selectionStart); video.play(); });
addAngleButton.addEventListener('click', () => {
  rememberForUndo();
  const id = Math.max(0, ...angles.map((angle) => angle.id)) + 1;
  const name = nextAngleName();
  angles.push({ id, name, joint: jointSelect.value, selectionStart: null, selectionEnd: null, samples: new Map() });
  activeAngleId = id;
  updateLandmarkLabels();
  updateSelectionLabel();
  updateResults();
  drawOverlay();
  pointingStatus.textContent = `${name} ajouté · pointez maintenant l’articulation ciblée.`;
  scheduleAutosave();
});
jointSelect.addEventListener('change', () => { const angle = activeAngle(); if (angle.samples.size === 0) rememberForUndo(); updateLandmarkLabels(); if (angle.samples.size === 0) { angle.joint = jointSelect.value; angle.name = nextAngleName(); } updateResults(); drawOverlay(); scheduleAutosave(); });
projectName.addEventListener('input', scheduleAutosave);
document.querySelectorAll('.landmark').forEach((button) => button.addEventListener('click', () => {
  activeLandmark = button.dataset.landmark;
  document.querySelectorAll('.landmark').forEach((item) => item.classList.toggle('active', item === button));
  pointingStatus.textContent = `Prêt à pointer ${landmarkNames[activeLandmark].toLowerCase()} sur l’image actuelle.`;
  drawOverlay();
}));
window.addEventListener('keydown', (event) => {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'z' && !event.target.matches('input, textarea')) { event.preventDefault(); event.shiftKey ? redoEditing() : undoEditing(); return; }
  if (modifier && event.key.toLowerCase() === 'y' && !event.target.matches('input, textarea')) { event.preventDefault(); redoEditing(); return; }
  if (event.target.matches('input, select')) return;
  const selected = { '1': 'proximal', '2': 'joint', '3': 'distal' }[event.key];
  if (selected) document.querySelector(`[data-landmark="${selected}"]`).click();
  if (event.code === 'Space') { event.preventDefault(); playButton.click(); }
  if (event.key === 'ArrowLeft') seekToFrame(frameNumber() - 1);
  if (event.key === 'ArrowRight') seekToFrame(frameNumber() + 1);
});
canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (!video.videoWidth) return;
  video.pause();
  const bounds = videoBounds();
  const stageBounds = stage.getBoundingClientRect();
  const x = (event.clientX - stageBounds.left - bounds.left) / bounds.width;
  const y = (event.clientY - stageBounds.top - bounds.top) / bounds.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  const frame = frameNumber();
  const sample = activeSamples().get(frame) || {};
  rememberForUndo();
  sample[activeLandmark] = { x, y };
  sample._source ||= {}; sample._source[activeLandmark] = 'manual';
  activeSamples().set(frame, sample);
  pointingStatus.textContent = `Frame clé enregistrée : ${landmarkNames[activeLandmark]} à l’image ${frame.toString().padStart(4, '0')}.`;
  renderAngles();
  drawOverlay();
  requestAnimationFrame(drawOverlay);
  updateResults(); scheduleAutosave();
});
function csvValue(value, digits = 2) { return value === null || value === undefined ? '' : Number(value).toFixed(digits).replace('.', ','); }
function pixelCoordinate(point, axis) {
  if (!point) return null;
  return point[axis] * (axis === 'x' ? video.videoWidth : video.videoHeight);
}

function createCsvExport() {
  const lines = ['projet;angle;frame;temps_s;proximal_x_px;proximal_y_px;sommet_x_px;sommet_y_px;distal_x_px;distal_y_px'];
  angles.forEach((angle) => [...angle.samples.entries()].sort((a, b) => a[0] - b[0]).forEach(([frame, sample]) => lines.push([
    projectName.value.trim(), angle.name, frame, frameTime(frame).toFixed(6).replace('.', ','),
    csvValue(pixelCoordinate(sample.proximal, 'x')), csvValue(pixelCoordinate(sample.proximal, 'y')),
    csvValue(pixelCoordinate(sample.joint, 'x')), csvValue(pixelCoordinate(sample.joint, 'y')),
    csvValue(pixelCoordinate(sample.distal, 'x')), csvValue(pixelCoordinate(sample.distal, 'y')),
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';'))));
  return {
    blob: new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }),
    name: `${safeFileName(projectName.value)}-pointages.csv`,
  };
}

exportButton.addEventListener('click', async () => {
  try {
    const file = createCsvExport();
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: file.name,
        types: [{ description: 'Fichier CSV', accept: { 'text/csv': ['.csv'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(file.blob);
      await writable.close();
      saveStatus.textContent = `CSV enregistré · ${file.name}`;
    } else {
      downloadBlob(file.blob, file.name);
      saveStatus.textContent = `Téléchargement CSV lancé · ${file.name}`;
    }
  } catch (error) {
    if (error.name === 'AbortError') { saveStatus.textContent = 'Export CSV annulé'; return; }
    try {
      const file = createCsvExport();
      downloadBlob(file.blob, file.name);
      saveStatus.textContent = `Téléchargement CSV lancé · ${file.name}`;
    } catch (fallbackError) {
      saveStatus.textContent = `Échec de l’export CSV · ${fallbackError.message}`;
    }
  }
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
  angles.splice(0, angles.length, { id: 1, name: selectedJointName(), joint: jointSelect.value, selectionStart: null, selectionEnd: null, samples: new Map() }); activeAngleId = 1;
  restoredVideoMetadata = null; currentVideoMetadata = null;
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
  const starts = includedAngles.map((angle) => angle.selectionStart).filter((frame) => frame !== null && frame !== undefined);
  const ends = includedAngles.map((angle) => angle.selectionEnd).filter((frame) => frame !== null && frame !== undefined);
  const startFrame = starts.length ? Math.min(...starts) : 0;
  const endFrame = ends.length ? Math.max(...ends) : Math.max(startFrame + 1, Math.floor(video.duration * fps));
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
  return { blob, name: `${safeFileName(projectName.value)}-${safeFileName(outputName)}.${format.extension}` };
}

async function writeFileToFolder(folder, file) {
  const handle = await folder.getFileHandle(file.name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file.blob);
  await writable.close();
}

async function runVideoExports(mode) {
  if (isExporting || !video.videoWidth) return;
  let exportFolder = null;
  if (mode === 'all' && window.showDirectoryPicker) {
    try {
      const parentFolder = await window.showDirectoryPicker({ mode: 'readwrite' });
      exportFolder = await parentFolder.getDirectoryHandle(`${safeFileName(projectName.value)}-exports`, { create: true });
    } catch (error) {
      if (error.name === 'AbortError') { exportProgress.textContent = 'Export annulé'; return; }
      exportProgress.textContent = 'Dossier inaccessible · téléchargements classiques utilisés.';
    }
  }
  isExporting = true; updateResults(); const originalTime = video.currentTime; const originalRate = video.playbackRate;
  try {
    const populated = angles.filter((angle) => angle.samples.size);
    if (mode === 'active') {
      const file = await recordAnnotatedVideo([activeAngle()], activeAngle().name, `Export ${activeAngle().name}`);
      downloadBlob(file.blob, file.name);
    }
    else {
      const csv = createCsvExport();
      const videoFolder = exportFolder ? await exportFolder.getDirectoryHandle('videos', { create: true }) : null;
      if (exportFolder) await writeFileToFolder(exportFolder, csv); else downloadBlob(csv.blob, csv.name);
      const combined = await recordAnnotatedVideo(populated, 'tous-les-angles', 'Vidéo avec tous les angles');
      if (videoFolder) await writeFileToFolder(videoFolder, combined); else downloadBlob(combined.blob, combined.name);
      for (let index = 0; index < populated.length; index += 1) {
        const file = await recordAnnotatedVideo([populated[index]], populated[index].name, `Vidéo ${index + 1}/${populated.length}`);
        if (videoFolder) await writeFileToFolder(videoFolder, file); else downloadBlob(file.blob, file.name);
      }
    }
    exportProgress.textContent = exportFolder ? `Export terminé dans ${exportFolder.name}` : 'Export vidéo terminé';
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
