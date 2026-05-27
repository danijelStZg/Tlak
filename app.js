// Tlakomjer OCR v4.0 — Mobile-first PWA
// UI layer + complete OCR pipeline iz v3.12

// ============================================================
//                  DOM ELEMENTI
// ============================================================
const $ = id => document.getElementById(id);

// UUID fallback — crypto.randomUUID je dostupan SAMO u secure context (HTTPS/localhost).
// Bez ovoga, klikanje "Spremi" baca grešku na HTTP serverima.
function makeUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try { return crypto.randomUUID(); } catch (e) { /* fallthrough */ }
  }
  // RFC4122 v4 fallback (ne kriptografski siguran, ali dovoljno za lokalne ID-eve)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Ekrani
const screenHome   = $('screenHome');
const screenCamera = $('screenCamera');
const screenManual = $('screenManual');

// Home
const captureBtn  = $('captureBtn');
const cameraFileInput = $('cameraFileInput');
const manualBtn   = $('manualBtn');
const menuBtn     = $('menuBtn');
const historyList = $('historyList');
const emptyState  = $('emptyState');
const statsBar    = $('statsBar');
const statAvg     = $('statAvg');
const statCount   = $('statCount');
const statLast    = $('statLast');

// Kamera
const cameraVideo     = $('cameraVideo');
const captureCanvas   = $('captureCanvas');
const workCanvas      = $('workCanvas');
const cameraCloseBtn  = $('cameraCloseBtn');
const cameraFlipBtn   = $('cameraFlipBtn');
const snapBtn         = $('snapBtn');
const captureGuide    = $('captureGuide');
const analyzingOverlay= $('analyzingOverlay');
const resultOverlay   = $('resultOverlay');
const resultSys       = $('resultSys');
const resultDia       = $('resultDia');
const resultPulse     = $('resultPulse');
const resultConfidence= $('resultConfidence');
const resultRetryBtn  = $('resultRetryBtn');
const resultSaveBtn   = $('resultSaveBtn');

// Manual unos
const manualBackBtn  = $('manualBackBtn');
const manualTitle    = $('manualTitle');
const manualSys      = $('manualSys');
const manualDia      = $('manualDia');
const manualPulse    = $('manualPulse');
const manualTime     = $('manualTime');
const manualNote     = $('manualNote');
const manualSaveBtn  = $('manualSaveBtn');

// Menu / Dijagnostika
const menuOverlay    = $('menuOverlay');
const menuCloseBtn   = $('menuCloseBtn');
const menuExportBtn  = $('menuExportBtn');
const menuClearBtn   = $('menuClearBtn');
const menuDiagBtn    = $('menuDiagBtn');
const diagModal      = $('diagModal');
const diagCloseBtn   = $('diagCloseBtn');
const diagOrigImg    = $('diagOrigImg');
const diagProcImg    = $('diagProcImg');
const diagJsonText   = $('diagJsonText');

// Toast
const toast = $('toast');

// ============================================================
//                  STATE
// ============================================================
const STORAGE_KEY = 'tlakomjer-history-v4-0';
let cameraStream = null;
let currentFacing = 'environment';
let lastAnalysis = null;
let lastSnapBitmap = null;
let editingId = null;  // ako uređujemo postojeći entry

// ============================================================
//                  EKRAN MANAGEMENT
// ============================================================
function showScreen(which) {
  screenHome.hidden = which !== 'home';
  screenCamera.hidden = which !== 'camera';
  screenManual.hidden = which !== 'manual';
  // Ako napustimo kameru, ugasi je i resetiraj UI
  if (which !== 'camera' && cameraStream) {
    stopCamera();
  }
  if (which !== 'camera') {
    // Reset overlays
    if (analyzingOverlay) analyzingOverlay.hidden = true;
    if (resultOverlay) resultOverlay.hidden = true;
    if (captureGuide) captureGuide.hidden = false;
    const snapBar = document.querySelector('.snap-bar');
    if (snapBar) snapBar.style.display = '';
    if (cameraVideo) {
      cameraVideo.hidden = false;
      cameraVideo.poster = '';
    }
  }
}

// ============================================================
//                  TOAST
// ============================================================
let toastTimer = null;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
}

// ============================================================
//                  POVIJEST — STORAGE
// ============================================================
function getHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveHistory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
function addEntry(entry) {
  const items = getHistory();
  items.unshift(entry);
  saveHistory(items);
  renderHistory();
}
function updateEntry(id, patch) {
  const items = getHistory();
  const idx = items.findIndex(x => x.id === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...patch };
    saveHistory(items);
    renderHistory();
  }
}
function deleteEntry(id) {
  saveHistory(getHistory().filter(x => x.id !== id));
  renderHistory();
}

// ============================================================
//                  POVIJEST — RENDER
// ============================================================
function renderHistory() {
  const items = getHistory();
  // Sortiraj po timestamp DESC
  items.sort((a, b) => (b.timestamp || b.createdAt).localeCompare(a.timestamp || a.createdAt));

  // Detach emptyState ako je u DOM-u
  if (emptyState.parentNode) emptyState.parentNode.removeChild(emptyState);
  historyList.innerHTML = '';

  if (!items.length) {
    historyList.appendChild(emptyState);
    statsBar.hidden = true;
    return;
  }

  statsBar.hidden = false;
  const avgSys = Math.round(items.reduce((s,i) => s+(+i.sys||0), 0) / items.length);
  const avgDia = Math.round(items.reduce((s,i) => s+(+i.dia||0), 0) / items.length);
  statAvg.textContent = `${avgSys}/${avgDia}`;
  statCount.textContent = items.length;
  statLast.textContent = items[0] ? `${items[0].sys}/${items[0].dia}` : '—';

  // Grupiraj po danu
  const groups = new Map();
  for (const it of items) {
    const day = (it.timestamp || it.createdAt).slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(it);
  }

  historyList.innerHTML = '';
  for (const [day, entries] of groups) {
    const hdr = document.createElement('div');
    hdr.className = 'history-day-header';
    hdr.textContent = formatDay(day);
    historyList.appendChild(hdr);

    for (const e of entries) {
      const card = document.createElement('div');
      card.className = 'history-item';
      const isCam = e.source && e.source.includes('omron');
      card.innerHTML = `
        <div class="history-item-time">
          <span class="${isCam ? 'history-item-source-cam' : ''}">${formatTime(e.timestamp || e.createdAt)}</span>
        </div>
        <div class="history-item-values">
          <div class="history-val"><span class="history-val-label">SYS</span><span class="history-val-num sys">${e.sys}</span></div>
          <div class="history-val"><span class="history-val-label">DIA</span><span class="history-val-num dia">${e.dia}</span></div>
          <div class="history-val"><span class="history-val-label">Puls</span><span class="history-val-num pulse">${e.pulse}</span></div>
        </div>
        <div class="history-item-actions">
          <button class="edit-btn" data-id="${e.id}">Uredi</button>
          <button class="del-btn" data-id="${e.id}">×</button>
        </div>
        ${e.note ? `<div class="history-item-note">${escapeHtml(e.note)}</div>` : ''}
      `;
      historyList.appendChild(card);
    }
  }

  historyList.querySelectorAll('.del-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (confirm('Obriši mjerenje?')) deleteEntry(b.dataset.id);
    });
  });
  historyList.querySelectorAll('.edit-btn').forEach(b => {
    b.addEventListener('click', () => openManualEdit(b.dataset.id));
  });
}

function formatDay(yyyymmdd) {
  const d = new Date(yyyymmdd);
  const today = new Date();
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const sameDate = (a, b) => a.toISOString().slice(0,10) === b.toISOString().slice(0,10);
  if (sameDate(d, today)) return 'Danas';
  if (sameDate(d, yest)) return 'Jučer';
  return new Intl.DateTimeFormat('hr-HR', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}
function formatTime(iso) {
  return new Intl.DateTimeFormat('hr-HR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

// ============================================================
//                  KAMERA
// ============================================================
async function startCamera() {
  if (cameraStream) return;

  // 1) Provjeri secure context — getUserMedia traži HTTPS ili localhost
  if (!window.isSecureContext) {
    showCameraError(
      'Kamera zahtijeva HTTPS',
      'Browser dopušta pristup kameri samo na sigurnoj vezi (HTTPS) ili localhost-u. ' +
      'Otvori aplikaciju preko HTTPS URL-a, ili koristi ručni unos.',
      true
    );
    return;
  }

  // 2) Provjeri da li getUserMedia uopće postoji
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraError(
      'Kamera nije podržana',
      'Tvoj browser ne podržava pristup kameri. Koristi noviju verziju Chrome/Safari/Firefox-a.',
      true
    );
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: currentFacing },
        width:  { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
  } catch (err) {
    console.error('Camera error:', err);
    let title = 'Greška kamere';
    let msg = err.message || String(err);
    // Mapiraj poznate greške
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      title = 'Pristup kameri odbijen';
      msg = 'Dopusti pristup kameri u postavkama browsera i pokušaj opet.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      title = 'Kamera nije pronađena';
      msg = 'Uređaj nema dostupnu kameru.';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      title = 'Kamera je zauzeta';
      msg = 'Druga aplikacija već koristi kameru. Zatvori ju i pokušaj opet.';
    } else if (err.name === 'OverconstrainedError') {
      title = 'Kamera ne podržava traženu rezoluciju';
      msg = 'Pokušavam s drugim postavkama…';
      // Retry s minimalnim constraintima
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraVideo.srcObject = cameraStream;
        await cameraVideo.play();
        return;
      } catch (e2) {
        msg = 'Nije uspjelo ni s minimalnim postavkama: ' + (e2.message || e2);
      }
    }
    showCameraError(title, msg, true);
  }
}

// Prikaži grešku kamere kao full-screen poruku unutar camera screen-a
function showCameraError(title, msg, goHome) {
  showToast(title + ': ' + msg, 'error');
  console.warn('[Camera]', title, msg);
  if (goHome) {
    setTimeout(() => showScreen('home'), 100);
  }
}
function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
}
async function flipCamera() {
  currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
  stopCamera();
  await startCamera();
}

// Snimanje frame-a
async function captureFrame() {
  if (!cameraStream || !cameraVideo.videoWidth) return null;
  const vw = cameraVideo.videoWidth, vh = cameraVideo.videoHeight;
  captureCanvas.width = vw; captureCanvas.height = vh;
  captureCanvas.getContext('2d').drawImage(cameraVideo, 0, 0, vw, vh);
  return await createImageBitmap(captureCanvas);
}

// Glavni snap → analyze → show result
async function onSnap() {
  // Sakrij guide, prikaži analizu
  captureGuide.hidden = true;
  analyzingOverlay.hidden = false;
  try {
    const bmp = await captureFrame();
    if (!bmp) { showToast('Greška pri snimanju', 'error'); return; }
    lastSnapBitmap = bmp;
    // Pauziraj video da slika "zamrznuta" stoji
    cameraVideo.pause();
    // Analiza (može potrajati 1-2s)
    await new Promise(r => setTimeout(r, 50));  // pusti UI da renderira
    const analysis = analyzeOmronPrecise(bmp);
    lastAnalysis = analysis;
    // Popuni rezultat
    resultSys.value = analysis.reading.sys || '';
    resultDia.value = analysis.reading.dia || '';
    resultPulse.value = analysis.reading.pulse || '';
    const conf = Math.round((analysis.confidence || 0) * 100);
    resultConfidence.textContent = conf + '%';
    resultConfidence.className = 'result-confidence ' + (conf >= 70 ? 'high' : 'low');
    // Sakrij analizu, pokaži rezultat
    analyzingOverlay.hidden = true;
    resultOverlay.hidden = false;
  } catch (err) {
    console.error(err);
    showToast('Greška pri analizi: ' + err.message, 'error');
    analyzingOverlay.hidden = true;
    captureGuide.hidden = false;
    cameraVideo.play();
  }
}

function onRetry() {
  resultOverlay.hidden = true;
  if (cameraStream) {
    // Live mode — vrati guide i resume video
    captureGuide.hidden = false;
    cameraVideo.play();
  } else {
    // File mode — vrati na home da korisnik pokuša ponovo
    showScreen('home');
    setTimeout(() => cameraFileInput.click(), 100);
  }
}

function onSaveResult() {
  const sys = +resultSys.value, dia = +resultDia.value, pulse = +resultPulse.value;
  if (!sys || !dia || !pulse) {
    showToast('Popuni sve vrijednosti', 'error');
    return;
  }
  const entry = {
    id: makeUUID(),
    sys, dia, pulse,
    timestamp: lastAnalysis?.reading.time
      ? combineDateWithTime(new Date(), lastAnalysis.reading.time)
      : new Date().toISOString(),
    createdAt: new Date().toISOString(),
    source: 'omron-precise-4.0',
    confidence: lastAnalysis?.confidence
  };
  addEntry(entry);
  showToast('Mjerenje spremljeno ✓', 'success');
  showScreen('home');
}

function combineDateWithTime(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// ============================================================
//                  MANUAL UNOS
// ============================================================
function openManualNew() {
  editingId = null;
  manualTitle.textContent = 'Novo mjerenje';
  manualSys.value = ''; manualDia.value = ''; manualPulse.value = '';
  manualNote.value = '';
  setDefaultTime(manualTime);
  showScreen('manual');
  setTimeout(() => manualSys.focus(), 100);
}
function openManualEdit(id) {
  const item = getHistory().find(x => x.id === id);
  if (!item) return;
  editingId = id;
  manualTitle.textContent = 'Uredi mjerenje';
  manualSys.value = item.sys;
  manualDia.value = item.dia;
  manualPulse.value = item.pulse;
  manualNote.value = item.note || '';
  manualTime.value = (item.timestamp || item.createdAt).slice(0, 16);
  showScreen('manual');
}
function setDefaultTime(input) {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  input.value = now.toISOString().slice(0, 16);
}
function onManualSave() {
  const sys = +manualSys.value, dia = +manualDia.value, pulse = +manualPulse.value;
  if (!sys || !dia || !pulse) {
    showToast('Popuni SYS, DIA i PULS', 'error');
    return;
  }
  if (!manualTime.value) {
    showToast('Postavi datum/vrijeme', 'error');
    return;
  }
  const entry = {
    id: editingId || makeUUID(),
    sys, dia, pulse,
    note: manualNote.value.trim(),
    timestamp: new Date(manualTime.value).toISOString(),
    createdAt: editingId ? getHistory().find(x => x.id === editingId)?.createdAt : new Date().toISOString(),
    source: editingId ? 'edited' : 'manual'
  };
  if (editingId) updateEntry(editingId, entry);
  else addEntry(entry);
  showToast(editingId ? 'Mjerenje ažurirano ✓' : 'Mjerenje spremljeno ✓', 'success');
  showScreen('home');
}

// ============================================================
//                  IZBORNIK
// ============================================================
function exportCSV() {
  const items = getHistory();
  if (!items.length) {
    showToast('Nema podataka za izvoz', 'error');
    return;
  }
  const hdr = ['datum_vrijeme', 'sys', 'dia', 'puls', 'napomena', 'izvor'];
  const csvEsc = s => `"${String(s).replaceAll('"', '""')}"`;
  const rows = items.map(x => [
    x.timestamp || x.createdAt, x.sys, x.dia, x.pulse,
    csvEsc(x.note || ''), csvEsc(x.source || '')
  ]);
  const csv = [hdr.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tlakomjer_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV preuzet ✓', 'success');
}

function clearAll() {
  if (!confirm('Obrisati SVA mjerenja? Ova akcija je nepovratna.')) return;
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
  showToast('Povijest obrisana', 'success');
}

function showDiagnostics() {
  if (!lastAnalysis) {
    showToast('Snimi mjerenje prvo', 'error');
    return;
  }
  diagOrigImg.src = lastAnalysis.debug.previewDataUrl;
  diagProcImg.src = lastAnalysis.debug.processedDataUrl;
  diagJsonText.textContent = JSON.stringify(lastAnalysis.debug.report, null, 2);
  showDiagTab('orig');
  diagModal.hidden = false;
}
function showDiagTab(which) {
  diagOrigImg.hidden = which !== 'orig';
  diagProcImg.hidden = which !== 'processed';
  diagJsonText.hidden = which !== 'json';
  document.querySelectorAll('.diag-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === which);
  });
}

// ============================================================
//                  EVENT LISTENERS
// ============================================================
// ============================================================
//                  CAPTURE BUTTON LOGIC
// ============================================================
// Strategija:
//  1) Ako smo u secure context (HTTPS / localhost) — koristi live kameru (getUserMedia).
//  2) Inače — fallback na file input s capture="environment" (otvori OS kameru).
//     Slika dolazi kao File pa idemo u alternativni tijek "analiziraj sliku, prikaži rezultat".
captureBtn.addEventListener('click', async () => {
  if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) {
    // Live kamera
    showScreen('camera');
    await startCamera();
  } else {
    // Fallback — nativna kamera preko file input-a
    console.log('[Capture] Secure context unavailable, using file input fallback');
    cameraFileInput.click();
  }
});

cameraFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';  // omogući biranje iste slike opet kasnije
  if (!file) return;
  await analyzeFileImage(file);
});

// Analiza slike iz File-a (od file inputa) — pokaži result direktno
async function analyzeFileImage(file) {
  showScreen('camera');  // koristimo camera screen za prikaz rezultata
  captureGuide.hidden = true;
  cameraVideo.hidden = true;
  analyzingOverlay.hidden = false;
  document.querySelector('.snap-bar').style.display = 'none';
  try {
    const bmp = await createImageBitmap(file);
    lastSnapBitmap = bmp;
    // Prikaži sliku u pozadini (umjesto video)
    const ctx = captureCanvas.getContext('2d');
    captureCanvas.width = bmp.width; captureCanvas.height = bmp.height;
    ctx.drawImage(bmp, 0, 0);
    // Promijeni video element na static image preview
    cameraVideo.poster = captureCanvas.toDataURL('image/jpeg', 0.8);
    cameraVideo.hidden = false;
    await new Promise(r => setTimeout(r, 50));
    const analysis = analyzeOmronPrecise(bmp);
    lastAnalysis = analysis;
    fillResultOverlay(analysis);
    analyzingOverlay.hidden = true;
    resultOverlay.hidden = false;
  } catch (err) {
    console.error('File analyze error:', err);
    showToast('Greška pri analizi: ' + err.message, 'error');
    showScreen('home');
  }
}

function fillResultOverlay(analysis) {
  resultSys.value = analysis.reading.sys || '';
  resultDia.value = analysis.reading.dia || '';
  resultPulse.value = analysis.reading.pulse || '';
  const conf = Math.round((analysis.confidence || 0) * 100);
  resultConfidence.textContent = conf + '%';
  resultConfidence.className = 'result-confidence ' + (conf >= 70 ? 'high' : 'low');
}
manualBtn.addEventListener('click', openManualNew);
manualBackBtn.addEventListener('click', () => showScreen('home'));
manualSaveBtn.addEventListener('click', onManualSave);

cameraCloseBtn.addEventListener('click', () => {
  // Ako je rezultat overlay open, samo ga zatvori
  if (!resultOverlay.hidden) {
    if (cameraStream) {
      resultOverlay.hidden = true;
      captureGuide.hidden = false;
      cameraVideo.play();
    } else {
      // File mode — samo se vrati doma
      resultOverlay.hidden = true;
      showScreen('home');
    }
    return;
  }
  showScreen('home');
});
cameraFlipBtn.addEventListener('click', flipCamera);
snapBtn.addEventListener('click', onSnap);
resultRetryBtn.addEventListener('click', onRetry);
resultSaveBtn.addEventListener('click', onSaveResult);

menuBtn.addEventListener('click', () => menuOverlay.hidden = false);
menuCloseBtn.addEventListener('click', () => menuOverlay.hidden = true);
menuOverlay.addEventListener('click', e => {
  if (e.target === menuOverlay) menuOverlay.hidden = true;
});
menuExportBtn.addEventListener('click', () => { menuOverlay.hidden = true; exportCSV(); });
menuClearBtn.addEventListener('click', () => { menuOverlay.hidden = true; clearAll(); });
menuDiagBtn.addEventListener('click', () => { menuOverlay.hidden = true; showDiagnostics(); });

diagCloseBtn.addEventListener('click', () => diagModal.hidden = true);
diagModal.addEventListener('click', e => {
  if (e.target === diagModal) diagModal.hidden = true;
});
document.querySelectorAll('.diag-tab').forEach(t => {
  t.addEventListener('click', () => showDiagTab(t.dataset.tab));
});

// Zatvori kameru kad korisnik napusti tab
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cameraStream) stopCamera();
});

// ============================================================
//                  PWA: Service Worker + Install
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW reg fail', err));
  });
}

// ============================================================
//                  STARTUP
// ============================================================
renderHistory();
showScreen('home');

// Dijagnostika kapaciteta
console.log('[Startup] Tlakomjer v4.1');
console.log('[Startup] Secure context:', window.isSecureContext);
console.log('[Startup] getUserMedia available:', !!navigator.mediaDevices?.getUserMedia);
console.log('[Startup] crypto.randomUUID available:', !!(typeof crypto !== 'undefined' && crypto.randomUUID));
if (!window.isSecureContext) {
  console.warn('[Startup] Aplikacija NIJE u secure context — live kamera neće raditi.');
  console.warn('[Startup] Koristit će se file-input fallback (nativna kamera preko OS-a).');
  console.warn('[Startup] Za live preview deploy preko HTTPS (npr. GitHub Pages, Netlify, Vercel).');
}

// ============================================================
//                     MAIN ANALYSIS
// ============================================================

function analyzeOmronPrecise(imageBitmap) {
  const maxW = 1280;
  const scale = Math.min(1, maxW / imageBitmap.width);
  const W = Math.round(imageBitmap.width * scale);
  const H = Math.round(imageBitmap.height * scale);

  workCanvas.width = W; workCanvas.height = H;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(imageBitmap, 0, 0, W, H);

  // v3.6/3.7/3.8: Auto-rotacija prije svega.
  // v3.10: SAFER ROTATION
  // Problem u v3.8/v3.10: safer rotation (empirical sign + 20° safety cap) + aspect-cap bbox trim.
  // sliku do 90° (45° po prolazu) jer detectRotation na već rotiranoj slici s crnom
  // pozadinom daje nesigurne kutove.
  // Novi pristup:
  //  1. Detektiraj kut JEDNOM na originalu.
  //  2. Ako je |angle| > 20° → preskoči (vjerojatno bug u detekciji, ne pravi nagib).
  //  3. Ako je 0.5° ≤ |angle| ≤ 20° → empirijski testiraj smjer:
  //     - Rotiraj testno za malu vrijednost (npr. 2°) u + smjeru, pomjeri pa izmjeri ostatak.
  //     - Onaj smjer koji smanji apsolutni ostatak je ispravan.
  //  4. Primijeni stvarnu rotaciju u potvrđenom smjeru, ali ograniči na ±15°.
  //  5. Bez druge iteracije — opasnost od kaskadnih grešaka.
  let totalRotation = 0;
  let usedW = W, usedH = H;
  const initialCtx = workCanvas.getContext('2d', { willReadFrequently: true });
  const initialRot = detectRotation(initialCtx, usedW, usedH);
  console.log(`[Rotation] initial detected: ${initialRot.angle.toFixed(2)}°`);

  const ANGLE_MAX = 45;  // v3.12: prošireno na ±45° za izrazitije nagibe
  const ANGLE_MIN = 0.5;
  if (Math.abs(initialRot.angle) >= ANGLE_MIN && Math.abs(initialRot.angle) <= ANGLE_MAX) {
    // Empirijski test smjera: malo rotiraj u + i u −, vidi koji smanji rezidual.
    const testStep = Math.min(3, Math.abs(initialRot.angle));
    let bestDir = 0, bestResidual = Math.abs(initialRot.angle);
    for (const dir of [1, -1]) {
      const candCanvas = rotateCanvas(workCanvas, dir * testStep);
      const testCanvas = document.createElement('canvas');
      testCanvas.width = candCanvas.width; testCanvas.height = candCanvas.height;
      testCanvas.getContext('2d').drawImage(candCanvas, 0, 0);
      const testCtx = testCanvas.getContext('2d', { willReadFrequently: true });
      const testRot = detectRotation(testCtx, candCanvas.width, candCanvas.height);
      const residual = Math.abs(testRot.angle);
      console.log(`[Rotation] test ${dir * testStep}° → residual ${testRot.angle.toFixed(2)}° (|${residual.toFixed(2)}|)`);
      if (residual < bestResidual) {
        bestResidual = residual;
        bestDir = dir;
      }
    }

    if (bestDir !== 0) {
      // Pravu rotaciju: |initialRot.angle| u smjeru bestDir, ograničeno na ±45°.
      const finalAngle = bestDir * Math.min(45, Math.abs(initialRot.angle));
      console.log(`[Rotation] APPLY ${finalAngle.toFixed(2)}° (dir=${bestDir})`);
      const rotated = rotateCanvas(workCanvas, finalAngle);
      usedW = rotated.width; usedH = rotated.height;
      workCanvas.width = usedW; workCanvas.height = usedH;
      const ctxR = workCanvas.getContext('2d', { willReadFrequently: true });
      ctxR.clearRect(0, 0, usedW, usedH);
      ctxR.drawImage(rotated, 0, 0);
      totalRotation = finalAngle;
    } else {
      console.warn(`[Rotation] neither direction reduced tilt — leaving image as is`);
    }
  } else if (Math.abs(initialRot.angle) > ANGLE_MAX) {
    console.warn(`[Rotation] detected angle ${initialRot.angle.toFixed(2)}° exceeds ±${ANGLE_MAX}° safety limit, skipping`);
  } else {
    console.log(`[Rotation] |${initialRot.angle.toFixed(2)}°| below ${ANGLE_MIN}° threshold, skipping`);
  }
  const rotInfo = { angle: totalRotation, initialDetected: initialRot.angle };

  // v3.12: NAKON ROTACIJE — pronađi LCD kao KVADRAT u gornjoj polovici slike i crop-aj samo njega.
  // Razlog: rotacija ravna sliku, ali screen-box detekcija može i dalje obuhvatiti
  // "Intelli sense" labelu ili plastiku ispod LCD-a. Sad kad je slika ravna, LCD je
  // jasno kvadratan blob u gornjoj polovici — krop-amo samo to područje prije autoScreenSearch.
  const ctxFinal = workCanvas.getContext('2d', { willReadFrequently: true });
  const lcdCrop = findSquareLcdCrop(ctxFinal, usedW, usedH);
  if (lcdCrop) {
    console.log(`[LCD-square] cropped to ${lcdCrop.x},${lcdCrop.y},${lcdCrop.w}x${lcdCrop.h}`);
    // Kopiraj crop u workCanvas
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = lcdCrop.w; cropCanvas.height = lcdCrop.h;
    cropCanvas.getContext('2d').drawImage(workCanvas, lcdCrop.x, lcdCrop.y, lcdCrop.w, lcdCrop.h, 0, 0, lcdCrop.w, lcdCrop.h);
    workCanvas.width = lcdCrop.w; workCanvas.height = lcdCrop.h;
    workCanvas.getContext('2d').drawImage(cropCanvas, 0, 0);
    usedW = lcdCrop.w; usedH = lcdCrop.h;
  }

  // Sada radimo na (eventualno rotiranom i cropanom) workCanvas-u
  const ctxAfter = workCanvas.getContext('2d', { willReadFrequently: true });
  let screen = autoScreenSearch(ctxAfter, usedW, usedH);

  // v3.8: Stegni screen bbox po horizontalnoj i vertikalnoj projekciji.
  screen = trimBboxByDensity(ctxAfter, usedW, usedH, screen);

  const raw = ctxAfter.getImageData(screen.x, screen.y, screen.w, screen.h);
  const gray = toGray(raw);

  // v3.4: Bradley adaptive thresholding umjesto Otsu na local-normalized slici.
  // Razlog: OMRON LCD ima cross-hatched pozadinu (segmenti su outline-only, ne solidi),
  // pa Otsu na local-normalized verziji ne razdvaja znamenke od pozadine — sve je
  // u jednom blobu intenziteta. Bradley pristup: piksel je "znamenka" ako je dovoljno
  // tamniji od svoje lokalne pozadine (mean unutar velikog prozora).
  //
  // Ensembleamo preko 5 varijanti `k` vrijednosti + dvije veličine close-radijusa.
  const blurR = Math.max(12, Math.round(Math.min(screen.w, screen.h) * 0.04));
  const bgMean = boxMean(gray, screen.w, screen.h, blurR);

  const variants = [
    { name: 'bradley-k6-c5',  k: 6,  close: 5 },
    { name: 'bradley-k9-c5',  k: 9,  close: 5 },
    { name: 'bradley-k12-c5', k: 12, close: 5 },
    { name: 'bradley-k9-c7',  k: 9,  close: 7 },
    { name: 'bradley-k14-c4', k: 14, close: 4 }
  ];
  const perVariant = [];
  for (const v of variants) {
    let bin = bradleyBinarize(gray, bgMean, screen.w, screen.h, v.k);
    bin = morphClose(bin, screen.w, screen.h, v.close);
    bin = removeSmallComponents(bin, screen.w, screen.h, 40);
    const reading = readRowsWithVoting(bin, screen.w, screen.h);
    perVariant.push({ ...v, reading });
  }
  const finalReading = ensembleReadings(perVariant);
  const bestVariant = chooseBestVariant(perVariant, finalReading);
  const overlay = drawDebugOverlay(raw, bestVariant.reading.debug.boxes, screen.w, screen.h);

  return {
    reading: finalReading,
    confidence: finalReading.confidence,
    debug: {
      previewDataUrl: overlay,
      processedDataUrl: binaryToDataUrl(bestVariant.reading.debug.binary, screen.w, screen.h, bestVariant.reading.debug.boxes),
      report: {
        screenBox: screen,
        rotation: { totalAngle: totalRotation, applied: totalRotation !== 0 },
        thresholds: perVariant.map(v => ({
          name: v.name,
          k: v.k, close: v.close,
          result: v.reading.values,
          confidence: Math.round(v.reading.confidence * 100) / 100
        })),
        final: finalReading,
        note: 'v3.12: edge-line rotation up to ±45° + LCD-square crop after rotation.'
      }
    }
  };
}

// ============================================================
//                  SCREEN AUTO-DETECTION (LCD-based, v3.3)
// ============================================================
//
// Strategija: LCD je tamnija ploha unutar svijetlog bijelog kućišta. Na grayscale
// slici, Otsu threshold razdvaja kućište (svijetlo) od svega ostalog (LCD + tamne
// stvari). Najveća povezana "tamna" regija koja zadovoljava razumne geometrijske
// uvjete = LCD. Vraćamo njezin bounding box kao zaslon.
//
// Ova metoda je puno robusnija od stare scoring-based pretrage, jer ne ovisi o
// fiksnim pretpostavljenim koordinatama OMRON-a — radi za bilo koju
// rotaciju/skaliranje/kut snimke dok god je LCD vidljiv u kadru.

// v3.12: Nakon rotacije, krop-aj sliku samo oko LCD-a (kvadratan blob u gornjoj
// polovici nakon poravnanja). Razlog: rotacija ravna sliku, ali screen-box detekcija
// može i dalje obuhvatiti "Intelli sense" labelu ili plastiku ispod LCD-a.
// Pošto je slika sad ravna, LCD je jasno kvadratan blob — algoritam:
//  1. Bradley adaptive + close → binary
//  2. Connected components, filtrirati za "kvadratan" (asp 0.7-1.4) i u gornjoj polovici
//  3. Najveći takav = LCD; vraćamo njegov bbox s malim padding-om
//  4. Ako ničega nema, vrati null (kasniji algoritam će proći cijelu sliku)
function findSquareLcdCrop(ctx, W, H) {
  const full = ctx.getImageData(0, 0, W, H);
  const gray = toGray(full);
  const NEAR_BLACK = 25;
  const masked = [];
  for (let i = 0; i < gray.length; i++) if (gray[i] > NEAR_BLACK) masked.push(gray[i]);
  if (masked.length < 1000) return null;
  const thr = otsuThresholdArr(masked);
  const bin = new Uint8Array(W * H);
  for (let i = 0; i < gray.length; i++) {
    bin[i] = (gray[i] < thr && gray[i] > NEAR_BLACK) ? 1 : 0;
  }
  const comps = connectedComponents(bin, W, H);
  const totalArea = W * H;
  let best = null, bestScore = -Infinity;
  for (const c of comps) {
    const bboxArea = c.w * c.h;
    const af = bboxArea / totalArea;
    if (af < 0.04 || af > 0.65) continue;
    const aspect = c.w / c.h;
    // KVADRAT (asp 0.7-1.4)
    if (aspect < 0.70 || aspect > 1.40) continue;
    const fill = c.area / bboxArea;
    // Pravi LCD ima rupe od znamenki, fill 0.30-0.65
    if (fill < 0.20 || fill > 0.75) continue;
    // GORNJA POLOVICA slike — y centar < 60% slike
    const yCenter = (c.y + c.h / 2) / H;
    if (yCenter > 0.65) continue;
    // Scoring
    const squareness = 1 - Math.abs(1 - aspect);
    const sizeScore = Math.min(1, af / 0.30);
    let fillBonus = 0;
    if (fill >= 0.30 && fill <= 0.65) fillBonus = 1.0;
    else fillBonus = 0.3;
    const upperBonus = (0.65 - yCenter) * 1.5;  // što gornji, bolji
    const score = sizeScore * 1.2 + squareness * 0.8 + fillBonus + upperBonus;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return null;
  // Pad — proširi crop za ~5% prema svim stranama, ali ne preko ruba slike
  const padX = Math.round(best.w * 0.05);
  const padY = Math.round(best.h * 0.05);
  const x = Math.max(0, best.x - padX);
  const y = Math.max(0, best.y - padY);
  const w = Math.min(W - x, best.w + 2 * padX);
  const h = Math.min(H - y, best.h + 2 * padY);
  return { x, y, w, h, score: bestScore, fill: best.area / (best.w * best.h), aspect: best.w / best.h };
}

function autoScreenSearch(ctx, W, H) {
  // Uzmi cijelu sliku u grayscale.
  const full = ctx.getImageData(0, 0, W, H);
  const gray = toGray(full);

  // v3.7: Otsu samo na NE-near-black pikselima (ignoriraj odijelu/pozadinu).
  const NEAR_BLACK = 25;
  const masked = [];
  for (let i = 0; i < gray.length; i++) if (gray[i] > NEAR_BLACK) masked.push(gray[i]);
  const thr = masked.length > 1000 ? otsuThresholdArr(masked) : otsuThreshold(gray, W, H);

  const bin = new Uint8Array(W * H);
  for (let i = 0; i < gray.length; i++) {
    bin[i] = (gray[i] < thr && gray[i] > NEAR_BLACK) ? 1 : 0;
  }

  const minArea = Math.round(W * H * 0.005);  // v3.7: 0.5% umjesto 1% — manji tlakomjeri u kadru
  const allComps = connectedComponents(bin, W, H);
  const totalArea = W * H;

  const candidates = [];
  for (const c of allComps) {
    if (c.area < minArea) continue;
    const bboxArea = c.w * c.h;
    const areaFrac = bboxArea / totalArea;
    if (areaFrac < 0.04 || areaFrac > 0.85) continue;  // v3.7: 4-85% (prije 6-80%)
    const aspect = c.w / c.h;
    if (aspect < 0.5 || aspect > 2.2) continue;  // v3.7: malo šire (prije 0.6-2.0)
    const fill = c.area / bboxArea;
    // v3.7: STROŽI fill — pravi OMRON LCD ima fill 0.35-0.65 (rupe od znamenki).
    // Solidne plastike, gumbi, tijelo telefona >> 0.7.
    if (fill > 0.75) continue;

    const touchL = c.x <= 2;
    const touchT = c.y <= 2;
    const touchR = c.x + c.w >= W - 2;
    const touchB = c.y + c.h >= H - 2;
    if (touchL && touchT && touchR && touchB) continue;

    const squareness = 1 - Math.abs(1 - aspect);
    const sizeScore = Math.min(1, areaFrac / 0.30);
    const edgePenalty = (touchL + touchT + touchR + touchB) * 0.15;

    // v3.7: BONUS za "rupkast" izgled — LCD ima fill blizu 0.4-0.5.
    // Najbolji bonus za fill između 0.35-0.55.
    let fillBonus = 0;
    if (fill >= 0.30 && fill <= 0.65) fillBonus = 0.8;
    else if (fill < 0.30) fillBonus = 0.3;

    const score = sizeScore * 1.0 + squareness * 0.6 + fillBonus - edgePenalty;
    candidates.push({ x: c.x, y: c.y, w: c.w, h: c.h, area: c.area, fill, aspect, score });
  }

  candidates.sort((a, b) => b.score - a.score);

  // v3.7: ispiši na konzolu top kandidate radi dijagnostike.
  if (typeof console !== 'undefined' && console.log && candidates.length) {
    console.log(`[LCD detect] thr=${thr}, ${candidates.length} candidates:`,
                candidates.slice(0, 3).map(c => ({
                  bbox: `${c.x},${c.y},${c.w}x${c.h}`,
                  fill: c.fill.toFixed(3),
                  aspect: c.aspect.toFixed(2),
                  score: c.score.toFixed(3)
                })));
  }

  if (candidates.length === 0) {
    console.warn('[LCD detect] No candidate — using fallback centered box');
    return {
      x: Math.round(W * 0.07),
      y: Math.round(H * 0.15),
      w: Math.round(W * 0.83),
      h: Math.round(H * 0.45),
      fallback: true
    };
  }

  const best = candidates[0];
  const pad = Math.round(Math.min(best.w, best.h) * 0.01);
  return {
    x: best.x + pad,
    y: best.y + pad,
    w: best.w - 2 * pad,
    h: best.h - 2 * pad,
    fill: best.fill,
    aspect: best.aspect,
    score: best.score
  };
}

// Otsu nad array-em vrijednosti (umjesto preko cijele slike s prostornim indeksiranjem).
function otsuThresholdArr(values) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  const total = values.length;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, varMax = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > varMax) { varMax = v; thr = t; }
  }
  return thr;
}

// v3.8: Stegni bbox po horizontalnoj/vertikalnoj density projekciji.
// Često se dogodi da LCD bbox zahvati "Intelli sense" labelu ispod LCD-a ili druge artefakte,
// pa ROI-i ispadnu pomaknuti. Ovdje računamo "row density" (broj crnih piksela po retku)
// unutar bbox-a i stežemo gornji/donji rub tamo gdje gustoća pada na ~10% prosjeka centra.
function trimBboxByDensity(ctx, W, H, screen) {
  const NEAR_BLACK = 25;
  const sx = Math.max(0, screen.x), sy = Math.max(0, screen.y);
  const sw = Math.min(W - sx, screen.w), sh = Math.min(H - sy, screen.h);
  if (sw <= 10 || sh <= 10) return screen;

  // v3.10: AGGRESSIVE TRIM
  // Cilj: spriječiti da bbox uključi "Intelli sense" labelu ispod LCD-a.
  // Pristup:
  //  1. Ako je bbox bitno viši od širokog (h > 1.1 × w), znamo da je "iscurio" prema dolje.
  //     Stegni h na 1.0 × w (OMRON LCD je gotovo kvadratan).
  //  2. Density-based trim koristeći SMOOTHED row density i traženje "rupe" (low-density zona).

  let trimmedScreen = { x: sx, y: sy, w: sw, h: sh };

  // STEP 1: Aspect-based hard cap
  if (sh > sw * 1.10) {
    const newH = Math.round(sw * 1.05);  // dopusti 5% margine
    console.log(`[Trim] aspect cap: h=${sh} → ${newH} (w=${sw})`);
    trimmedScreen.h = newH;
  }

  // STEP 2: Density-based fine trim
  const tx = trimmedScreen.x, ty = trimmedScreen.y;
  const tw = trimmedScreen.w, th = trimmedScreen.h;
  const crop = ctx.getImageData(tx, ty, tw, th);
  const data = crop.data;
  const masked = [];
  for (let i = 0; i < data.length; i += 4) {
    const gv = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
    if (gv > NEAR_BLACK) masked.push(gv);
  }
  if (masked.length < 500) return trimmedScreen;
  const thr = otsuThresholdArr(masked);

  const rowDensity = new Float32Array(th);
  for (let yy = 0; yy < th; yy++) {
    let cnt = 0;
    const base = yy * tw * 4;
    for (let xx = 0; xx < tw; xx++) {
      const i = base + xx * 4;
      const gv = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
      if (gv > NEAR_BLACK && gv < thr) cnt++;
    }
    rowDensity[yy] = cnt / tw;
  }

  // Smoothed density za stabilnost
  const smooth = new Float32Array(th);
  const ksize = Math.max(5, Math.floor(th * 0.02));
  for (let y = 0; y < th; y++) {
    let s = 0, n = 0;
    for (let k = -ksize; k <= ksize; k++) {
      const yy = y + k;
      if (yy >= 0 && yy < th) { s += rowDensity[yy]; n++; }
    }
    smooth[y] = s / n;
  }

  // Centralna gustoća
  const midStart = Math.floor(th * 0.25), midEnd = Math.floor(th * 0.75);
  let midSum = 0;
  for (let yy = midStart; yy < midEnd; yy++) midSum += smooth[yy];
  const midAvg = midSum / (midEnd - midStart);
  const trimThr = midAvg * 0.20;

  // Donji rub: od kraja prema sredini, prvi red s smooth >= trimThr
  let newBottom = th - 1;
  for (let yy = th - 1; yy > midEnd; yy--) {
    if (smooth[yy] >= trimThr) { newBottom = yy; break; }
  }
  let newTop = 0;
  for (let yy = 0; yy < midStart; yy++) {
    if (smooth[yy] >= trimThr) { newTop = yy; break; }
  }

  // Sad isto za stupce
  const colDensity = new Float32Array(tw);
  for (let xx = 0; xx < tw; xx++) {
    let cnt = 0;
    for (let yy = 0; yy < th; yy++) {
      const i = (yy * tw + xx) * 4;
      const gv = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
      if (gv > NEAR_BLACK && gv < thr) cnt++;
    }
    colDensity[xx] = cnt / th;
  }
  const colSmooth = new Float32Array(tw);
  const ksizeC = Math.max(5, Math.floor(tw * 0.02));
  for (let x = 0; x < tw; x++) {
    let s = 0, n = 0;
    for (let k = -ksizeC; k <= ksizeC; k++) {
      const xx = x + k;
      if (xx >= 0 && xx < tw) { s += colDensity[xx]; n++; }
    }
    colSmooth[x] = s / n;
  }
  const midColStart = Math.floor(tw * 0.25), midColEnd = Math.floor(tw * 0.75);
  let midColSum = 0;
  for (let xx = midColStart; xx < midColEnd; xx++) midColSum += colSmooth[xx];
  const midColAvg = midColSum / (midColEnd - midColStart);
  const trimColThr = midColAvg * 0.20;

  let newRight = tw - 1;
  for (let xx = tw - 1; xx > midColEnd; xx--) {
    if (colSmooth[xx] >= trimColThr) { newRight = xx; break; }
  }
  let newLeft = 0;
  for (let xx = 0; xx < midColStart; xx++) {
    if (colSmooth[xx] >= trimColThr) { newLeft = xx; break; }
  }

  const result = {
    x: tx + newLeft,
    y: ty + newTop,
    w: newRight - newLeft + 1,
    h: newBottom - newTop + 1,
    trimmed: true,
    origScreen: { x: screen.x, y: screen.y, w: screen.w, h: screen.h }
  };

  console.log(`[Trim] orig=${screen.x},${screen.y},${screen.w}x${screen.h} → after aspect-cap=${trimmedScreen.x},${trimmedScreen.y},${trimmedScreen.w}x${trimmedScreen.h} → final=${result.x},${result.y},${result.w}x${result.h}`);

  // Sanity: ne dopusti da bbox nestane (<30% originalne površine)
  if (result.w * result.h < screen.w * screen.h * 0.25) {
    console.warn('[Trim] trimmed too aggressively, reverting to orig');
    return screen;
  }
  return result;
}

// v3.6/3.7: Detekcija kuta rotacije LCD-a.
// 1) Lociramo LCD na trenutnoj slici (isti kriteriji kao autoScreenSearch).
// 2) Subsampliramo piksele svaki ~50-ti red/stupac (da bi 91 rotacija bila brza).
// 3) Za svaki kut u [-45, 45]°, izračunamo površinu axis-aligned bbox-a rotiranih piksela.
//    Kut s najmanjom površinom = kut nagiba LCD-a.
// v3.11: NOVA detekcija kuta — preko horizontalnih rubova umjesto LCD bbox-a.
// Ideja: tlakomjer ima puno paralelnih horizontalnih linija (gornji rub LCD-a,
// donji rub LCD-a, "Intelli sense" granica, START/STOP rub). Sve te linije
// dijele isti kut nagiba slike. Kut koji daje NAJVIŠE jakih horizontalnih
// linija u "projekciji u y-os" je pravi kut nagiba.
//
// Algoritam:
//   1. Vertical gradient (1D Sobel) → naglasi horizontalne rubove.
//   2. Threshold gradient na ~1.5×std → edge map.
//   3. Za svaki kut θ u [-15°, +15°]:
//      - Projeciraj edge piksele u rotiranu y-os: y' = -(x-cx)·sin(θ) + (y-cy)·cos(θ).
//      - Izgradi histogram po y'.
//      - Pronađi top-N peakova; ukupna snaga peakova = score(θ).
//   4. θ s najvećim score-om = pravi kut.
//
// Ova metoda ne ovisi o detekciji LCD-a kao komponente — radi i kada se LCD
// "spoji" s plastikom kućišta jer rubovi i dalje izgledaju isto.
function detectRotation(ctx, W, H) {
  // Downscale za brzinu — koristimo max ~600px na duljoj strani.
  const maxDim = 600;
  const scale = Math.min(1, maxDim / Math.max(W, H));
  const sW = Math.max(50, Math.round(W * scale));
  const sH = Math.max(50, Math.round(H * scale));

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = sW; tmpCanvas.height = sH;
  const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
  tmpCtx.drawImage(ctx.canvas, 0, 0, W, H, 0, 0, sW, sH);
  const img = tmpCtx.getImageData(0, 0, sW, sH);
  const gray = toGray(img);

  // Vertical gradient: g[y+1] - g[y-1], po redovima
  const grad = new Float32Array(sW * sH);
  for (let y = 1; y < sH - 1; y++) {
    for (let x = 0; x < sW; x++) {
      const above = gray[(y - 1) * sW + x];
      const below = gray[(y + 1) * sW + x];
      grad[y * sW + x] = below - above;
    }
  }
  // Std preko apsolutnih
  let absSum = 0, absSumSq = 0;
  for (let i = 0; i < grad.length; i++) {
    const a = Math.abs(grad[i]);
    absSum += a; absSumSq += a * a;
  }
  const mean = absSum / grad.length;
  const variance = absSumSq / grad.length - mean * mean;
  const std = Math.sqrt(Math.max(0, variance));
  const edgeThr = mean + std * 1.0;
  // Edge piksele zabilježi
  const edgeX = []; const edgeY = [];
  for (let y = 0; y < sH; y++) {
    for (let x = 0; x < sW; x++) {
      if (Math.abs(grad[y * sW + x]) > edgeThr) {
        edgeX.push(x); edgeY.push(y);
      }
    }
  }
  if (edgeX.length < 200) {
    console.log(`[Rotation] too few edge pixels (${edgeX.length}), skipping`);
    return { angle: 0, reason: 'too few edges' };
  }

  // Centriraj koordinate
  const cx = sW / 2, cy = sH / 2;
  const exC = new Float32Array(edgeX.length);
  const eyC = new Float32Array(edgeY.length);
  for (let i = 0; i < edgeX.length; i++) {
    exC[i] = edgeX[i] - cx;
    eyC[i] = edgeY[i] - cy;
  }

  // Funkcija za projekciju i scoring
  function projectAndScore(thetaDeg) {
    const rad = thetaDeg * Math.PI / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    const hist = new Int32Array(sH);
    for (let i = 0; i < exC.length; i++) {
      // Rotirani y: y' = -x·sin + y·cos
      const yp = -exC[i] * s + eyC[i] * c + cy;
      const yi = Math.round(yp);
      if (yi >= 0 && yi < sH) hist[yi]++;
    }
    // Score = zbroj top-10 peakova (lokalnih maksimuma) iznad 30% globalnog max
    let maxH = 0;
    for (let i = 0; i < sH; i++) if (hist[i] > maxH) maxH = hist[i];
    if (maxH === 0) return 0;
    const thr = maxH * 0.3;
    const peaks = [];
    for (let i = 2; i < sH - 2; i++) {
      if (hist[i] > thr && hist[i] >= hist[i-1] && hist[i] >= hist[i+1]) {
        peaks.push(hist[i]);
      }
    }
    peaks.sort((a, b) => b - a);
    let total = 0;
    for (let i = 0; i < Math.min(10, peaks.length); i++) total += peaks[i];
    return total;
  }

  // Grubi skenir s korakom 1° preko [-45, +45] (umjesto [-15, +15]).
  // Proširen raspon hvata izrazito nakošene slike (npr. dijagonalno snimanje).
  let bestTheta = 0, bestScore = 0;
  for (let theta = -45; theta <= 45; theta += 1) {
    const s = projectAndScore(theta);
    if (s > bestScore) { bestScore = s; bestTheta = theta; }
  }
  // Srednji refine s korakom 0.25° unutar ±1° od najboljeg
  for (let theta = bestTheta - 1; theta <= bestTheta + 1; theta += 0.25) {
    const s = projectAndScore(theta);
    if (s > bestScore) { bestScore = s; bestTheta = theta; }
  }

  // Fine-tune oko najboljeg s korakom 0.1°
  for (let theta = bestTheta - 0.5; theta <= bestTheta + 0.5; theta += 0.1) {
    const s = projectAndScore(theta);
    if (s > bestScore) { bestScore = s; bestTheta = theta; }
  }

  console.log(`[Rotation] edge-line detection: angle=${bestTheta.toFixed(2)}°, score=${bestScore}, edges=${edgeX.length}, working ${sW}x${sH}`);
  return { angle: bestTheta, score: bestScore, edges: edgeX.length };
}

// v3.6: Rotira cijeli canvas (kopira u novi canvas s većim dimenzijama da stane).
// angleDeg > 0 = rotacija u smjeru CW (na ekranu). Fill = crna (kasnije izbjegnuto maskiranjem).
function rotateCanvas(srcCanvas, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const newW = Math.ceil(sw * cos + sh * sin);
  const newH = Math.ceil(sw * sin + sh * cos);
  const dst = document.createElement('canvas');
  dst.width = newW; dst.height = newH;
  const dctx = dst.getContext('2d');
  dctx.fillStyle = '#000';
  dctx.fillRect(0, 0, newW, newH);
  dctx.translate(newW / 2, newH / 2);
  dctx.rotate(rad);
  dctx.drawImage(srcCanvas, -sw / 2, -sh / 2);
  return dst;
}

// scoreOmronScreen više nije potreban (zadržano radi unatrag-kompatibilnosti
// vanjskih custom skripti — interno se ne zove).
function scoreOmronScreen(bin, w, h) {
  return 0;
}

// ============================================================
//                  ROW READING + VOTING
// ============================================================

function readRowsWithVoting(bin, w, h) {
  // ROI po retku unutar PRAVOG LCD-a (nakon detekcije zaslona).
  // x-koordinate suženi da preskočimo lijeve labele ("SYS", "DIA", "PULSE")
  // i ikone (baterija, OK). Mjerene s prave OMRON fotografije.
  const rowDefs = {
    sys:   { x1: 0.22, x2: 0.85, y1: 0.18, y2: 0.48, min: 70, max: 260, preferLen: 3 },
    dia:   { x1: 0.28, x2: 0.85, y1: 0.46, y2: 0.74, min: 40, max: 180, preferLen: 2 },
    pulse: { x1: 0.30, x2: 0.78, y1: 0.74, y2: 0.99, min: 35, max: 220, preferLen: 2 }
  };
  const values = {}; const boxes = {}; const confs = [];
  for (const [field, def] of Object.entries(rowDefs)) {
    const x = Math.floor(w * def.x1);
    const y = Math.floor(h * def.y1);
    const rw = Math.ceil(w * (def.x2 - def.x1));
    const rh = Math.ceil(h * (def.y2 - def.y1));
    const row = cropBinary(bin, w, h, x, y, rw, rh);
    const parsed = parseDigitRow(row.data, row.width, row.height, def);
    values[field] = parsed.value;
    boxes[field] = parsed.boxes.map(b => ({ x: b.x + x, y: b.y + y, w: b.w, h: b.h }));
    confs.push(parsed.confidence);
  }
  // vrijeme (mali sat gore-desno)
  const top = cropBinary(bin, w, h, Math.floor(w * 0.40), 0, Math.ceil(w * 0.45), Math.ceil(h * 0.17));
  values.time = parseTime(top.data, top.width, top.height);
  return {
    values,
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.45,
    debug: { boxes, binary: bin }
  };
}

// ============================================================
//                  DIGIT ROW PARSING
// ============================================================

function parseDigitRow(bin, w, h, def) {
  // 1) Sve komponente.
  let rawComps = connectedComponents(bin, w, h)
    .filter(c => c.area >= 40 && c.h >= h * 0.25 && c.w >= 3)
    .sort((a, b) => a.x - b.x);

  if (!rawComps.length) return { value: null, confidence: 0.2, boxes: [] };

  // 2) Vertikalno mergeaj komponente iste znamenke koje su se razbile na gornji/donji dio.
  rawComps = mergeVerticallyStacked(rawComps);

  // 3) Horizontalno mergeaj komponente koje pripadaju istoj znamenci (npr. razlomljen segment).
  let comps = mergeNearbyComponents(rawComps, Math.max(4, Math.round(w * 0.015)));

  // 4) Filtar: izbaci komponente koje su preuske ALI nemaju adekvatnu visinu (šum, oznake "SYS").
  //    "1" smije biti uska, ali mora imati gotovo punu visinu (>= 0.55 * medianH).
  if (comps.length >= 2) {
    const sortedH = [...comps].map(c => c.h).sort((a, b) => a - b);
    const medianH = sortedH[Math.floor(sortedH.length / 2)];
    comps = comps.filter(c => c.h >= medianH * 0.55);
  }

  // 5) Filtar: komponenta ne smije pokrivati >40% širine reda (sigurno nije znamenka).
  comps = comps.filter(c => c.w < w * 0.42);

  if (!comps.length) return { value: null, confidence: 0.2, boxes: [] };

  // 6) Izaberi najbolji "klaster" od 2..3 znamenke s dosljednom visinom i smislenim razmacima.
  comps = pickBestDigits(comps, w, def.preferLen);

  // 7) Prepoznaj svaku znamenku.
  const digits = [];
  let conf = 0;
  // medianH/H finalnog seta — za detekciju "1".
  const heights = comps.map(c => c.h).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)] || h * 0.5;
  for (const c of comps) {
    // Vrlo uska komponenta visine bliske medianu => "1".
    if (c.w / c.h < 0.38 && c.h >= medH * 0.7) {
      digits.push('1');
      conf += 0.9;
      continue;
    }
    const dmap = cropBinary(bin, w, h, c.x, c.y, c.w, c.h);
    const rec = recognizeSevenSegmentPrecise(dmap.data, dmap.width, dmap.height);
    digits.push(rec.digit);
    conf += rec.confidence;
  }

  let txt = digits.join('');
  let val = Number(txt);
  if (!Number.isFinite(val) || val < def.min || val > def.max) {
    val = choosePlausibleFromBoxes(bin, w, h, comps, def, medH);
  }
  return {
    value: Number.isFinite(val) ? val : null,
    confidence: comps.length ? conf / comps.length : 0.2,
    boxes: comps
  };
}

function choosePlausibleFromBoxes(bin, w, h, comps, def, medH) {
  const vars = [];
  for (let take = 2; take <= 3; take++) {
    if (comps.length < take) continue;
    // probaj zadnja `take` i prva `take`
    for (const subset of [comps.slice(-take), comps.slice(0, take)]) {
      let txt = '';
      for (const c of subset) {
        if (c.w / c.h < 0.38 && c.h >= medH * 0.7) { txt += '1'; continue; }
        const dmap = cropBinary(bin, w, h, c.x, c.y, c.w, c.h);
        txt += recognizeSevenSegmentPrecise(dmap.data, dmap.width, dmap.height).digit;
      }
      vars.push(txt);
    }
  }
  const nums = vars.map(v => Number(v)).filter(n => Number.isFinite(n) && n >= def.min && n <= def.max);
  return nums.length ? nums[0] : null;
}

// Izabire 2..maxDigits komponenti iz reda. Preferira klaster s dosljednom visinom
// i s dosljednim razmacima — ono što izgleda kao prava sekvenca znamenki.
function pickBestDigits(comps, w, preferLen) {
  if (!comps.length) return [];
  if (comps.length <= preferLen) return comps;

  const targetMin = 2;
  const targetMax = Math.max(preferLen, 3);
  let best = comps.slice(0, preferLen);
  let bestScore = -Infinity;

  // Generiraj podskupove uzastopnih (po x) komponenti veličine [targetMin..targetMax].
  for (let size = targetMin; size <= targetMax; size++) {
    for (let i = 0; i + size <= comps.length; i++) {
      const subset = comps.slice(i, i + size);
      const heights = subset.map(c => c.h);
      const maxH = Math.max(...heights);
      const minH = Math.min(...heights);
      const heightConsistency = minH / maxH; // 1.0 = perfektno

      // Razmaci između desnog ruba i sljedećeg lijevog ruba:
      let gapStd = 0;
      if (subset.length >= 2) {
        const gaps = [];
        for (let k = 1; k < subset.length; k++) {
          gaps.push(subset[k].x - (subset[k - 1].x + subset[k - 1].w));
        }
        const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
        gapStd = Math.sqrt(variance) / Math.max(1, maxH); // normalizirano na visinu
      }

      // Bonus za preferiranu duljinu.
      const lenBonus = size === preferLen ? 0.6 : 0;

      // Ukupni score: prefiramo veliku visinu, dosljedne visine, male gap-std, preferiranu duljinu.
      const score = heightConsistency * 2.0 + (maxH / (w * 0.25)) * 0.5 - gapStd * 1.5 + lenBonus + size * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = subset;
      }
    }
  }
  return best;
}

// Mergea komponente koje su vertikalno složene (gornja + donja polovica iste znamenke).
function mergeVerticallyStacked(comps) {
  if (comps.length < 2) return comps;
  const used = new Array(comps.length).fill(false);
  const out = [];
  for (let i = 0; i < comps.length; i++) {
    if (used[i]) continue;
    let merged = { ...comps[i], indices: comps[i].indices ? [...comps[i].indices] : [] };
    for (let j = i + 1; j < comps.length; j++) {
      if (used[j]) continue;
      const a = merged, b = comps[j];
      // Horizontalni overlap?
      const hOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const minW = Math.min(a.w, b.w);
      // Vertikalni gap (mali, pozitivan ili lagani overlap)?
      const vGap = b.y - (a.y + a.h);
      if (hOverlap > minW * 0.55 && vGap < Math.max(a.h, b.h) * 0.35 && vGap > -Math.max(a.h, b.h) * 0.2) {
        const nx = Math.min(a.x, b.x);
        const ny = Math.min(a.y, b.y);
        const mx = Math.max(a.x + a.w, b.x + b.w);
        const my = Math.max(a.y + a.h, b.y + b.h);
        merged = { x: nx, y: ny, w: mx - nx, h: my - ny, area: a.area + b.area, indices: a.indices.concat(b.indices || []) };
        used[j] = true;
      }
    }
    used[i] = true;
    out.push(merged);
  }
  return out.sort((a, b) => a.x - b.x);
}

// ============================================================
//                  7-SEGMENT RECOGNITION
// ============================================================

function recognizeSevenSegmentPrecise(bin, width, height) {
  const ratio = width / height;

  // Posebna brza odluka za "1": vrlo uske komponente.
  if (ratio < 0.35) {
    return { digit: '1', confidence: 0.95 };
  }

  const segs = {
    a: rectRatio(bin, width, height, 0.18, 0.03, 0.64, 0.13),
    b: rectRatio(bin, width, height, 0.70, 0.12, 0.20, 0.31),
    c: rectRatio(bin, width, height, 0.70, 0.54, 0.20, 0.27),
    d: rectRatio(bin, width, height, 0.18, 0.83, 0.64, 0.13),
    e: rectRatio(bin, width, height, 0.08, 0.54, 0.18, 0.27),
    f: rectRatio(bin, width, height, 0.08, 0.12, 0.18, 0.31),
    g: rectRatio(bin, width, height, 0.18, 0.43, 0.64, 0.15)
  };
  const patterns = {
    '0': ['a', 'b', 'c', 'd', 'e', 'f'],
    '1': ['b', 'c'],
    '2': ['a', 'b', 'g', 'e', 'd'],
    '3': ['a', 'b', 'g', 'c', 'd'],
    '4': ['f', 'g', 'b', 'c'],
    '5': ['a', 'f', 'g', 'c', 'd'],
    '6': ['a', 'f', 'g', 'e', 'c', 'd'],
    '7': ['a', 'b', 'c'],
    '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    '9': ['a', 'b', 'c', 'd', 'f', 'g']
  };

  // v3.5: TEMPLATE-MATCHING scoring.
  // Za svaki segment uspoređujemo "očekivano stanje" (0 ili 1 po patternu) s
  // "opaženim stanjem" (linearno mapirano iz fill ratio):
  //   fill < 0.15        → observed = 0 (sigurno isključen)
  //   fill > 0.40        → observed = 1 (sigurno uključen)
  //   inače              → linearno
  // Score = −Σ (expected − observed)². Najmanja kvadratna pogreška pobjeđuje.
  // Razlog za promjenu: stari scoring je davao "8" patternu pun bonus za
  // svaki aktivni segment a pri tom nije kažnjavao "8" jer pattern "8" očekuje
  // sve segmente aktivne — pa je "8" sustavno pobjeđivao stvarni "3", "2", "4".
  const segObs = {};
  for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    const v = segs[s];
    if (v < 0.15) segObs[s] = 0;
    else if (v > 0.40) segObs[s] = 1;
    else segObs[s] = (v - 0.15) / 0.25;
  }

  let best = '?', bestScore = -999;
  for (const [digit, onSegs] of Object.entries(patterns)) {
    let score = 0;
    for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const expected = onSegs.includes(s) ? 1 : 0;
      const err = expected - segObs[s];
      score -= err * err;
    }
    // Heuristički bonusi.
    if (digit === '1' && ratio < 0.45) score += 0.5;
    if (digit === '7' && ratio < 0.65) score += 0.1;
    // razlikovanje 5/6 — 6 ima i 'e' segment
    if (digit === '5' && segs.e < 0.15) score += 0.1;
    if (digit === '6' && segs.e > 0.35) score += 0.1;
    // razlikovanje 0/8 — 8 ima 'g'
    if (digit === '0' && segs.g < 0.20) score += 0.1;
    if (digit === '8' && segs.g > 0.40) score += 0.1;

    if (score > bestScore) { bestScore = score; best = digit; }
  }
  // Confidence: u idealnom slučaju bestScore = 0, najgori realni je oko -2.0.
  const confidence = Math.max(0.15, Math.min(0.99, 1 + bestScore / 2));
  return { digit: best, confidence };
}

// ============================================================
//                  ENSEMBLE & VARIANT CHOICE
// ============================================================

function ensembleReadings(perVariant) {
  const out = { sys: null, dia: null, pulse: null, time: null, confidence: 0.25 };
  let confSum = 0;
  for (const f of ['sys', 'dia', 'pulse']) {
    const votes = new Map();
    for (const v of perVariant) {
      const val = v.reading.values[f];
      if (val == null) continue;
      votes.set(val, (votes.get(val) || 0) + v.reading.confidence);
    }
    if (votes.size) {
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      out[f] = Number(best[0]);
      confSum += Math.min(0.99, best[1] / Math.max(1, perVariant.length));
    }
  }
  const timeVotes = new Map();
  for (const v of perVariant) {
    const t = v.reading.values.time;
    if (t) timeVotes.set(t, (timeVotes.get(t) || 0) + 1);
  }
  if (timeVotes.size) out.time = [...timeVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  out.confidence = confSum / 3;
  return out;
}

function chooseBestVariant(perVariant, finalReading) {
  return perVariant.sort((a, b) => scoreVariantAgainstFinal(b, finalReading) - scoreVariantAgainstFinal(a, finalReading))[0];
}

function scoreVariantAgainstFinal(v, finalReading) {
  let s = v.reading.confidence;
  for (const f of ['sys', 'dia', 'pulse']) if (v.reading.values[f] === finalReading[f]) s += 0.4;
  return s;
}

// ============================================================
//                  TIME PARSING
// ============================================================

function parseTime(bin, w, h) {
  const comps = connectedComponents(bin, w, h)
    .filter(c => c.area >= 10 && c.h >= h * 0.20 && c.w >= 2)
    .sort((a, b) => a.x - b.x);
  const digits = comps.filter(c => c.w < w * 0.20).slice(-4);
  const vals = digits
    .map(c => recognizeSevenSegmentPrecise(cropBinary(bin, w, h, c.x, c.y, c.w, c.h).data, c.w, c.h).digit)
    .filter(d => /\d/.test(d));
  if (vals.length >= 3) {
    const hh = vals.length === 4 ? vals[0] + vals[1] : vals[0];
    const mm = vals.length === 4 ? vals[2] + vals[3] : vals[1] + vals[2];
    const H = Number(hh), M = Number(mm);
    if (H >= 0 && H <= 23 && M >= 0 && M <= 59) {
      return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
    }
  }
  return null;
}

// ============================================================
//                  IMAGE PROCESSING UTILS
// ============================================================

function toGray(imageData) {
  const d = imageData.data, g = new Uint8ClampedArray(imageData.width * imageData.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  return g;
}

function localNormalize(gray, w, h, r) {
  const integ = new Uint32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)];
      integ[y * (w + 1) + x] = integ[(y - 1) * (w + 1) + x] + row;
    }
  }
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - r), y2 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - r), x2 = Math.min(w - 1, x + r);
      const sum = sumRect(integ, w + 1, x1, y1, x2, y2);
      const cnt = (x2 - x1 + 1) * (y2 - y1 + 1);
      const mean = sum / cnt;
      let val = gray[y * w + x] - mean + 128;
      if (val < 0) val = 0; if (val > 255) val = 255;
      out[y * w + x] = val;
    }
  }
  return out;
}

function sumRect(integ, stride, x1, y1, x2, y2) {
  const A = integ[y1 * stride + x1];
  const B = integ[y1 * stride + (x2 + 1)];
  const C = integ[(y2 + 1) * stride + x1];
  const D = integ[(y2 + 1) * stride + (x2 + 1)];
  return D - B - C + A;
}

function otsuThreshold(gray, w, h) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = w * h;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, wF = 0, varMax = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > varMax) { varMax = v; thr = t; }
  }
  return thr;
}

function thresholdToBinary(gray, w, h, thr) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] < thr ? 1 : 0;
  return out;
}

// v3.4: Računa lokalni mean (box blur) preko integralne slike, O(w*h).
// Vraća Uint8Array istih dimenzija kao gray.
function boxMean(gray, w, h, r) {
  const stride = w + 1;
  const integ = new Uint32Array(stride * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)];
      integ[y * stride + x] = integ[(y - 1) * stride + x] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - r), y2 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - r), x2 = Math.min(w - 1, x + r);
      const sum = sumRect(integ, stride, x1, y1, x2, y2);
      const cnt = (x2 - x1 + 1) * (y2 - y1 + 1);
      out[y * w + x] = Math.round(sum / cnt);
    }
  }
  return out;
}

// v3.5: template-matching scoring.
// bin[i] = 1 ako je piksel tamniji od lokalnog mean-a za barem `k`.
// (mean - pixel > k  ⟺  pixel < mean - k).
function bradleyBinarize(gray, mean, w, h, k) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    out[i] = (mean[i] - gray[i]) > k ? 1 : 0;
  }
  return out;
}

// v3.4: Separabilan morfološki close — O(w*h*r) umjesto O(w*h*r²).
// Bitno za r=5..7 koji v3.4 koristi (kvadratna verzija bi bila ~25-50x sporija).
function morphClose(bin, w, h, r) {
  if (r <= 0) return bin;
  // dilation: horizontal sweep
  const tmp = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let on = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) {
        if (bin[row + xx]) { on = 1; break; }
      }
      tmp[row + x] = on;
    }
  }
  // dilation: vertical sweep
  const dil = new Uint8Array(bin.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let on = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) {
        if (tmp[yy * w + x]) { on = 1; break; }
      }
      dil[y * w + x] = on;
    }
  }
  // erosion: horizontal sweep
  const tmp2 = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let on = 1;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) {
        if (!dil[row + xx]) { on = 0; break; }
      }
      tmp2[row + x] = on;
    }
  }
  // erosion: vertical sweep
  const ero = new Uint8Array(bin.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let on = 1;
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) {
        if (!tmp2[yy * w + x]) { on = 0; break; }
      }
      ero[y * w + x] = on;
    }
  }
  return ero;
}

function removeSmallComponents(bin, w, h, minArea) {
  const out = new Uint8Array(bin.length);
  const comps = connectedComponents(bin, w, h);
  for (const c of comps) if (c.area >= minArea) for (const idx of c.indices) out[idx] = 1;
  return out;
}

function connectedComponents(bin, w, h) {
  const vis = new Uint8Array(bin.length);
  const comps = [];
  const qx = new Int32Array(bin.length);
  const qy = new Int32Array(bin.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x;
    if (!bin[idx] || vis[idx]) continue;
    let head = 0, tail = 0;
    qx[tail] = x; qy[tail] = y; tail++;
    vis[idx] = 1;
    let minX = x, maxX = x, minY = y, maxY = y, area = 0;
    const indices = [];
    while (head < tail) {
      const cx = qx[head], cy = qy[head]; head++;
      const cidx = cy * w + cx; indices.push(cidx); area++;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nidx = ny * w + nx;
        if (bin[nidx] && !vis[nidx]) { vis[nidx] = 1; qx[tail] = nx; qy[tail] = ny; tail++; }
      }
    }
    comps.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area, indices });
  }
  return comps;
}

function mergeNearbyComponents(comps, gap) {
  if (!comps.length) return [];
  const out = [Object.assign({}, comps[0])];
  for (let i = 1; i < comps.length; i++) {
    const p = out[out.length - 1], c = comps[i];
    const g = c.x - (p.x + p.w);
    const overlap = Math.min(p.y + p.h, c.y + c.h) - Math.max(p.y, c.y);
    if (g <= gap && overlap > Math.min(p.h, c.h) * 0.25) {
      const nx = Math.min(p.x, c.x), ny = Math.min(p.y, c.y);
      const mx = Math.max(p.x + p.w, c.x + c.w), my = Math.max(p.y + p.h, c.y + c.h);
      p.x = nx; p.y = ny; p.w = mx - nx; p.h = my - ny;
      p.area += c.area;
    } else {
      out.push(Object.assign({}, c));
    }
  }
  return out;
}

function cropBinary(bin, w, h, x, y, rw, rh) {
  const data = new Uint8Array(rw * rh);
  for (let yy = 0; yy < rh; yy++)
    for (let xx = 0; xx < rw; xx++)
      data[yy * rw + xx] = bin[(y + yy) * w + (x + xx)] || 0;
  return { data, width: rw, height: rh };
}

function densityInRect(bin, w, h, rx, ry, rw, rh) {
  const x1 = Math.floor(w * rx), y1 = Math.floor(h * ry);
  const x2 = Math.min(w, Math.ceil(w * (rx + rw))), y2 = Math.min(h, Math.ceil(h * (ry + rh)));
  let on = 0, total = 0;
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) { total++; if (bin[y * w + x]) on++; }
  return total ? on / total : 0;
}

function rectRatio(bin, w, h, rx, ry, rw, rh) {
  const x1 = Math.max(0, Math.floor(w * rx)), y1 = Math.max(0, Math.floor(h * ry));
  const x2 = Math.min(w, Math.ceil(w * (rx + rw))), y2 = Math.min(h, Math.ceil(h * (ry + rh)));
  let on = 0, total = 0;
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) { total++; if (bin[y * w + x]) on++; }
  return total ? on / total : 0;
}

// ============================================================
//                  DEBUG VISUALIZATION
// ============================================================

function drawDebugOverlay(rawImageData, boxes, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.putImageData(rawImageData, 0, 0);
  ctx.lineWidth = 3;
  const colors = { sys: '#ef4444', dia: '#22c55e', pulse: '#3b82f6' };
  if (!boxes || typeof boxes !== 'object') return c.toDataURL('image/png');
  for (const [f, arr] of Object.entries(boxes)) {
    if (!Array.isArray(arr)) continue;
    ctx.strokeStyle = colors[f] || '#f59e0b';
    ctx.fillStyle = colors[f] || '#f59e0b';
    ctx.font = 'bold 18px system-ui';
    for (const b of arr) {
      if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' || typeof b.w !== 'number' || typeof b.h !== 'number') continue;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillText(f.toUpperCase(), b.x, Math.max(18, b.y - 6));
    }
  }
  return c.toDataURL('image/png');
}

function binaryToDataUrl(bin, w, h, boxes) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < bin.length; i++) {
    const v = bin[i] ? 0 : 255, j = i * 4;
    img.data[j] = img.data[j + 1] = img.data[j + 2] = v;
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (boxes && typeof boxes === 'object') {
    ctx.lineWidth = 2;
    const colors = { sys: '#ef4444', dia: '#22c55e', pulse: '#3b82f6' };
    for (const [f, arr] of Object.entries(boxes)) {
      if (!Array.isArray(arr)) continue;
      ctx.strokeStyle = colors[f] || '#f59e0b';
      for (const b of arr) {
        if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' || typeof b.w !== 'number' || typeof b.h !== 'number') continue;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
    }
  }
  return c.toDataURL('image/png');
}

// ============================================================
//                  TEXT POST-PROCESSING (fallback OCR)
// ============================================================

function normalizeOCRText(text) {
  return text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/\s+/g, ' ').trim();
}

function extractReadingFromText(text) {
  const nums = [...text.matchAll(/\b\d{2,3}\b/g)].map(m => Number(m[0]));
  const sys = nums.find(n => n >= 80 && n <= 220) || null;
  const dia = nums.find(n => n >= 40 && n <= 140 && n !== sys) || null;
  const pulse = nums.find(n => n >= 35 && n <= 180 && n !== sys && n !== dia) || null;
  const tm = text.match(/\b(\d{1,2})[:.]?(\d{2})\b/);
  const time = tm
    ? `${String(Math.min(23, Number(tm[1]))).padStart(2, '0')}:${String(Math.min(59, Number(tm[2]))).padStart(2, '0')}`
    : null;
  return { sys, dia, pulse, time };
}

// ============================================================
//                  PERSISTENCE & UI
// ============================================================

function setDefaultTimestamp() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  timestampEl.value = now.toISOString().slice(0, 16);
}

function applyDetectedTime(time) {
  const current = timestampEl.value ? new Date(timestampEl.value) : new Date();
  const [hh, mm] = time.split(':').map(Number);
  current.setHours(hh, mm, 0, 0);
  current.setMinutes(current.getMinutes() - current.getTimezoneOffset());
  timestampEl.value = current.toISOString().slice(0, 16);
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function renderHistory() {
  const items = getHistory();
  historyBody.innerHTML = '';
  if (!items.length) {
    historyBody.innerHTML = '<tr><td colspan="6" class="muted">Još nema spremljenih mjerenja.</td></tr>';
    return;
  }
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${formatDateTime(item.timestamp)}</td><td>${item.sys}</td><td>${item.dia}</td><td>${item.pulse}</td><td>${escapeHtml(item.note || '')}</td><td><button class="small-btn danger" data-id="${item.id}">Obriši</button></td>`;
    historyBody.appendChild(tr);
  }
  historyBody.querySelectorAll('button[data-id]').forEach(btn => btn.addEventListener('click', () => removeHistoryItem(btn.dataset.id)));
}

function removeHistoryItem(id) {
  const items = getHistory().filter(x => x.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  renderHistory();
}

function formatDateTime(v) {
  return new Intl.DateTimeFormat('hr-HR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v));
}

function csvEscape(s) { return `"${String(s).replaceAll('"', '""')}"`; }

function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  const colors = {
    info: ['#f8fafc', '#dde6f0'],
    success: ['#ecfdf3', '#abefc6'],
    warning: ['#fffaeb', '#fedf89'],
    error: ['#fef3f2', '#fecdca']
  };
  const [bg, border] = colors[type] || colors.info;
  statusEl.style.background = bg;
  statusEl.style.borderColor = border;
}

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch (err) { console.warn('SW nije registriran', err); }
  }
}
