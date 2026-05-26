// Tlakomjer OCR v3.7 — Robust LCD detection + lower rotation threshold
// Sve nadogradnje od v3.1:
//   v3.2 — detekcija "1", median-visina, vertikalni merge, pickBestDigits.
//   v3.3 — LCD se detektira kao najveća tamna komponenta (kvadrat unutar kućišta).
//   v3.4 — Bradley adaptive threshold + separabilan close (fix cross-hatched pozadine).
//   v3.5 — template-matching scoring (LSQ) — fix sustavnog "8" bias-a.
//   v3.6 — auto-rotacija slike (min-area rotated rect) + live kamera (getUserMedia).
//   v3.7 — LCD detekcija svjesna fill-ratio-a (preferira "rupkaste" komponente kao OMRON LCD),
//          rotacijski prag spušten na 0.8°, console.log dijagnostika.

const imageInput        = document.getElementById('imageInput');
const preview           = document.getElementById('preview');
const processedPreview  = document.getElementById('processedPreview');
const workCanvas        = document.getElementById('workCanvas');
const preciseBtn        = document.getElementById('preciseBtn');
const ocrBtn            = document.getElementById('ocrBtn');
const demoBtn           = document.getElementById('demoBtn');
const cameraBtn         = document.getElementById('cameraBtn');
const cameraModal       = document.getElementById('cameraModal');
const cameraVideo       = document.getElementById('cameraVideo');
const cameraSnapBtn     = document.getElementById('cameraSnapBtn');
const cameraCancelBtn   = document.getElementById('cameraCancelBtn');
const statusEl          = document.getElementById('status');
const diagTextEl        = document.getElementById('diagText');
const sysEl             = document.getElementById('sys');
const diaEl             = document.getElementById('dia');
const pulseEl           = document.getElementById('pulse');
const timestampEl       = document.getElementById('timestamp');
const noteEl            = document.getElementById('note');
const readingForm       = document.getElementById('readingForm');
const historyBody       = document.getElementById('historyBody');
const exportBtn         = document.getElementById('exportBtn');
const clearBtn          = document.getElementById('clearBtn');

const STORAGE_KEY = 'tlakomjer-ocr-history-v3-7-robust-detect';
let currentImageBitmap = null;
let lastAnalysis = null;

setDefaultTimestamp();
renderHistory();
registerSW();

imageInput.addEventListener('change', async e => {
  const f = e.target.files?.[0];
  if (f) await loadImageFile(f);
});

demoBtn.addEventListener('click', async () => {
  const res = await fetch('./assets/omron-demo.jpg');
  const blob = await res.blob();
  await loadImageFile(new File([blob], 'omron-demo.jpg', { type: blob.type || 'image/jpeg' }));
});

// ============================================================
//                    LIVE KAMERA (getUserMedia)
// ============================================================
let cameraStream = null;

cameraBtn.addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    return alert('Tvoj browser ne podržava live kameru. Koristi datoteku iznad.');
  }
  try {
    setStatus('Otvaram kameru…', 'info');
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },  // stražnja kamera ako postoji
        width:  { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    cameraModal.hidden = false;
    setStatus('Kamera otvorena. Uokviri tlakomjer i stisni Uslikaj.', 'info');
  } catch (err) {
    console.error(err);
    alert('Ne mogu otvoriti kameru: ' + (err.message || err));
    setStatus('Kamera odbijena ili nedostupna.', 'error');
  }
});

cameraCancelBtn.addEventListener('click', () => closeCamera());

cameraSnapBtn.addEventListener('click', async () => {
  if (!cameraStream || !cameraVideo.videoWidth) return;
  // Snimi current frame u offscreen canvas (NIKAD ne ide na disk).
  const vw = cameraVideo.videoWidth, vh = cameraVideo.videoHeight;
  const snap = document.createElement('canvas');
  snap.width = vw; snap.height = vh;
  snap.getContext('2d').drawImage(cameraVideo, 0, 0, vw, vh);
  // Konvertiraj u ImageBitmap direktno iz canvasa (bez Blob/Filea).
  closeCamera();
  try {
    const bmp = await createImageBitmap(snap);
    // Mali "preview" prikaz — koristimo data URL iz canvasa.
    preview.src = snap.toDataURL('image/jpeg', 0.9);
    preview.hidden = false;
    processedPreview.hidden = true;
    currentImageBitmap = bmp;
    lastAnalysis = null;
    setStatus('Slika snimljena. Klikni "Precizni OMRON parser".', 'success');
  } catch (err) {
    console.error(err);
    setStatus('Greška pri uzimanju frame-a: ' + err.message, 'error');
  }
});

function closeCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraModal.hidden = true;
}

// Zatvori kameru ako korisnik napusti tab.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cameraStream) closeCamera();
});

preciseBtn.addEventListener('click', async () => {
  if (!currentImageBitmap) return alert('Prvo učitaj fotografiju.');
  try {
    setStatus('Pokrećem precizni OMRON parser…', 'info');
    const analysis = analyzeOmronPrecise(currentImageBitmap);
    lastAnalysis = analysis;
    processedPreview.src = analysis.debug.previewDataUrl;
    processedPreview.hidden = false;
    if (analysis.reading.sys)   sysEl.value   = analysis.reading.sys;
    if (analysis.reading.dia)   diaEl.value   = analysis.reading.dia;
    if (analysis.reading.pulse) pulseEl.value = analysis.reading.pulse;
    if (analysis.reading.time) applyDetectedTime(analysis.reading.time);
    diagTextEl.textContent = JSON.stringify(analysis.debug.report, null, 2);
    const found = [analysis.reading.sys, analysis.reading.dia, analysis.reading.pulse].filter(Boolean).length;
    setStatus(
      found >= 2
        ? `Parser gotov. Pronađeno ${found}/3 polja. Pouzdanost ${Math.round(analysis.confidence * 100)}%.`
        : 'Parser nije dovoljno siguran. Pokušaj fallback OCR.',
      found >= 2 ? 'success' : 'warning'
    );
  } catch (err) {
    console.error(err);
    diagTextEl.textContent = String(err?.stack || err);
    setStatus('Greška u preciznom parseru. Otvori Dijagnostika za detalje.', 'error');
  }
});

ocrBtn.addEventListener('click', async () => {
  if (!currentImageBitmap) return alert('Prvo učitaj fotografiju.');
  const analysis = analyzeOmronPrecise(currentImageBitmap);
  processedPreview.src = analysis.debug.processedDataUrl;
  processedPreview.hidden = false;
  try {
    setStatus('Pokrećem fallback OCR…', 'info');
    const { data } = await Tesseract.recognize(analysis.debug.processedDataUrl, 'eng', {
      logger: m => { if (m.status) setStatus(`${m.status}${m.progress ? ' ' + Math.round(m.progress * 100) + '%' : ''}`, 'info'); },
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      tessedit_char_whitelist: '0123456789:'
    });
    const t = normalizeOCRText(data.text || '');
    const fallback = extractReadingFromText(t);
    const merged = {
      sys:   analysis.reading.sys   || fallback.sys,
      dia:   analysis.reading.dia   || fallback.dia,
      pulse: analysis.reading.pulse || fallback.pulse,
      time:  analysis.reading.time  || fallback.time
    };
    if (merged.sys)   sysEl.value   = merged.sys;
    if (merged.dia)   diaEl.value   = merged.dia;
    if (merged.pulse) pulseEl.value = merged.pulse;
    if (merged.time) applyDetectedTime(merged.time);
    diagTextEl.textContent = JSON.stringify({ ...analysis.debug.report, fallbackOCR: t }, null, 2);
    setStatus('Fallback OCR gotov. Provjeri vrijednosti.', 'success');
  } catch (err) {
    console.error(err);
    diagTextEl.textContent = String(err?.stack || err);
    setStatus('Greška u fallback OCR-u.', 'error');
  }
});

readingForm.addEventListener('submit', e => {
  e.preventDefault();
  const entry = {
    id: crypto.randomUUID(),
    sys: Number(sysEl.value),
    dia: Number(diaEl.value),
    pulse: Number(pulseEl.value),
    timestamp: timestampEl.value,
    note: noteEl.value.trim(),
    createdAt: new Date().toISOString(),
    source: lastAnalysis ? 'omron-precise-3.7' : 'manual'
  };
  if (!entry.sys || !entry.dia || !entry.pulse || !entry.timestamp) return alert('Ispuni SYS, DIA, puls i datum/vrijeme.');
  const items = getHistory();
  items.unshift(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  renderHistory();
  noteEl.value = '';
  setDefaultTimestamp();
  setStatus('Mjerenje spremljeno.', 'success');
});

exportBtn.addEventListener('click', () => {
  const items = getHistory();
  if (!items.length) return alert('Nema spremljenih mjerenja.');
  const header = ['datum_vrijeme', 'sys', 'dia', 'puls', 'napomena', 'izvor'];
  const rows = items.map(x => [x.timestamp, x.sys, x.dia, x.pulse, csvEscape(x.note || ''), csvEscape(x.source || '')]);
  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'tlakomjer_povijest.csv'; a.click();
  URL.revokeObjectURL(url);
});

clearBtn.addEventListener('click', () => {
  if (!confirm('Obrisati cijelu povijest mjerenja?')) return;
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
  setStatus('Povijest obrisana.', 'success');
});

async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  preview.src = url; preview.hidden = false;
  processedPreview.hidden = true;
  currentImageBitmap = await createImageBitmap(file);
  lastAnalysis = null;
  setStatus('Fotografija učitana. Klikni "Precizni OMRON parser".', 'success');
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

  // v3.6/3.7: Auto-rotacija prije svega.
  // Pronađemo LCD na originalnoj slici, izračunamo kut iz njegovih piksela
  // (min-area rotated rectangle), pa rotiramo cijelu sliku za negativni kut.
  // Ako je kut < 0.8°, preskačemo (skupo, a slika je već ravna).
  const rotInfo = detectRotation(ctx, W, H);
  let usedW = W, usedH = H;
  if (Math.abs(rotInfo.angle) >= 0.8) {
    // Rotiraj cijelu sliku za -angle (ispravi nagib)
    const rotated = rotateCanvas(workCanvas, -rotInfo.angle);
    usedW = rotated.width; usedH = rotated.height;
    workCanvas.width = usedW; workCanvas.height = usedH;
    const ctx2 = workCanvas.getContext('2d', { willReadFrequently: true });
    ctx2.clearRect(0, 0, usedW, usedH);
    ctx2.drawImage(rotated, 0, 0);
  }
  // Sada radimo na (eventualno rotiranom) workCanvas-u
  const ctxFinal = workCanvas.getContext('2d', { willReadFrequently: true });
  const screen = autoScreenSearch(ctxFinal, usedW, usedH);
  const raw = ctxFinal.getImageData(screen.x, screen.y, screen.w, screen.h);
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
        rotation: { angle: rotInfo.angle, applied: Math.abs(rotInfo.angle) >= 1.5, ...rotInfo },
        thresholds: perVariant.map(v => ({
          name: v.name,
          k: v.k, close: v.close,
          result: v.reading.values,
          confidence: Math.round(v.reading.confidence * 100) / 100
        })),
        final: finalReading,
        note: 'v3.7: robust LCD detection (fill-aware) + lower rotation threshold (0.8°).'
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

// v3.6/3.7: Detekcija kuta rotacije LCD-a.
// 1) Lociramo LCD na trenutnoj slici (isti kriteriji kao autoScreenSearch).
// 2) Subsampliramo piksele svaki ~50-ti red/stupac (da bi 91 rotacija bila brza).
// 3) Za svaki kut u [-45, 45]°, izračunamo površinu axis-aligned bbox-a rotiranih piksela.
//    Kut s najmanjom površinom = kut nagiba LCD-a.
function detectRotation(ctx, W, H) {
  const full = ctx.getImageData(0, 0, W, H);
  const gray = toGray(full);
  const NEAR_BLACK = 25;
  const masked = [];
  for (let i = 0; i < gray.length; i++) if (gray[i] > NEAR_BLACK) masked.push(gray[i]);
  if (masked.length < 1000) return { angle: 0, reason: 'too few non-black pixels' };
  const thr = otsuThresholdArr(masked);
  const bin = new Uint8Array(W * H);
  for (let i = 0; i < gray.length; i++) {
    bin[i] = (gray[i] < thr && gray[i] > NEAR_BLACK) ? 1 : 0;
  }
  const comps = connectedComponents(bin, W, H);
  const totalArea = W * H;
  // v3.7: isti kriteriji kao u autoScreenSearch (smanjeni prag fill-a).
  let best = null, bestScore = -Infinity;
  for (const c of comps) {
    const bboxArea = c.w * c.h;
    const af = bboxArea / totalArea;
    if (af < 0.04 || af > 0.85) continue;
    const asp = c.w / c.h;
    if (asp < 0.5 || asp > 2.2) continue;
    const fill = c.area / bboxArea;
    if (fill > 0.75) continue;
    // Scoring isti kao u autoScreenSearch.
    const squareness = 1 - Math.abs(1 - asp);
    const sizeScore = Math.min(1, af / 0.30);
    let fillBonus = 0;
    if (fill >= 0.30 && fill <= 0.65) fillBonus = 0.8;
    else if (fill < 0.30) fillBonus = 0.3;
    const score = sizeScore + squareness * 0.6 + fillBonus;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return { angle: 0, reason: 'no LCD candidate' };

  // Subsample piksele komponente za brzu min-area rect.
  const stride = Math.max(1, Math.floor(Math.sqrt(best.area / 2000)));
  const pts = [];
  for (let i = 0; i < best.indices.length; i += stride) {
    const idx = best.indices[i];
    pts.push([idx % W, Math.floor(idx / W)]);
  }
  if (pts.length < 50) return { angle: 0, reason: 'not enough sample pts' };

  let bestAngle = 0, bestArea = Infinity;
  for (let a = -45; a <= 45; a++) {
    const rad = a * Math.PI / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of pts) {
      const rx = px * c - py * s;
      const ry = px * s + py * c;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) { bestArea = area; bestAngle = a; }
  }

  // Fine-tune.
  for (let aa = bestAngle - 1; aa <= bestAngle + 1; aa += 0.25) {
    const rad = aa * Math.PI / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of pts) {
      const rx = px * c - py * s;
      const ry = px * s + py * c;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) { bestArea = area; bestAngle = aa; }
  }

  if (typeof console !== 'undefined' && console.log) {
    console.log(`[Rotation] detected angle=${bestAngle.toFixed(2)}°, LCD bbox=${best.x},${best.y},${best.w}x${best.h}, fill=${(best.area/(best.w*best.h)).toFixed(3)}`);
  }

  return { angle: bestAngle, sampleCount: pts.length, lcdBbox: { x: best.x, y: best.y, w: best.w, h: best.h } };
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
