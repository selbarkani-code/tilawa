import { variants, skeleton, tokenize, alignSegment } from './align.js';

// ======================= Utilitaires =======================
const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

// ======================= État =======================
let QURAN = null;
const S = {
  sura: 1, from: 1, to: 7, mode: 'revision',
  words: [],     // { w, v, last }
  exp: [],       // variantes de squelette par mot
  status: [],    // pending | correct | error | missed | fixed | hint
  heard: [],     // ce qui a été entendu pour un mot en erreur
  cursor: 0,
  hints: 0,
  modelReady: false,
  listening: false,
  stopping: false,
  misses: 0,     // segments non reconnus d'affilée
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
try { navigator.storage?.persist?.(); } catch { /* ignore */ }

// ======================= Modèle vocal (worker) =======================
const worker = new Worker('./asr-worker.js', { type: 'module' });
const pendingReq = new Map();
let reqId = 0;

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progress') {
    const pct = m.total ? Math.min(100, Math.round((m.loaded / m.total) * 100)) : 0;
    setModel(`Téléchargement… ${pct} %`);
    $('#modelBar').classList.remove('hidden');
    $('#modelBar span').style.width = pct + '%';
  } else if (m.type === 'status') {
    setModel(m.text);
  } else if (m.type === 'ready') {
    S.modelReady = true;
    D.engine = `${m.device} ${m.dtype}`;
    store.set('modelDownloaded', true);
    setModel(m.device === 'webgpu' ? 'Prêt (accélération GPU)' : 'Prêt', 'ready');
    $('#modelBar').classList.add('hidden');
    $('#modelBtn').classList.add('hidden');
    $('#modelHint').textContent = 'Le modèle est sur ton iPhone. Tu peux réciter même sans connexion.';
    updateMic();
    if (!S.listening) setStatus('Touche le micro et commence à réciter');
  } else if (m.type === 'error') {
    D.err = m.message;
    setModel('Échec du chargement', 'error');
    $('#modelBtn').classList.remove('hidden');
    $('#modelBtn').disabled = false;
    $('#modelBtn').textContent = 'Réessayer';
    $('#modelHint').textContent = 'Vérifie ta connexion (le premier téléchargement en a besoin). Détail : ' + m.message;
  } else if (m.type === 'result') {
    const cb = pendingReq.get(m.id); pendingReq.delete(m.id); cb?.(m);
  }
};

function setModel(text, cls = '') {
  const el = $('#modelStatus'); el.textContent = text; el.className = 'model-status ' + cls;
}
function loadModel() {
  $('#modelBtn').disabled = true;
  setModel('Préparation…');
  worker.postMessage({ type: 'load' });
}
function transcribe(audio) {
  return new Promise((res) => {
    const id = ++reqId; pendingReq.set(id, res);
    worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  });
}

// ======================= Écran de choix =======================
async function init() {
  QURAN = await (await fetch('quran.json')).json();
  const sel = $('#sura');
  QURAN.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = i + 1;
    o.textContent = `${i + 1}. ${s.t} — ${s.n} (${s.v.length})`;
    sel.appendChild(o);
  });
  const last = store.get('last', null);
  if (last) Object.assign(S, { sura: last.sura, from: last.from, to: last.to, mode: last.mode });
  sel.value = S.sura;
  $('#from').value = S.from; $('#to').value = S.to;
  syncRange(false);
  setMode(S.mode);

  if (store.get('modelDownloaded', false)) loadModel(); // chargement depuis le cache, hors ligne
}

function syncRange(resetVerses) {
  S.sura = +$('#sura').value;
  const n = QURAN[S.sura - 1].v.length;
  const from = $('#from'), to = $('#to');
  from.max = n; to.max = n;
  if (resetVerses) { from.value = 1; to.value = Math.min(n, 10); }
  let f = Math.max(1, Math.min(n, +from.value || 1));
  let t = Math.max(f, Math.min(n, +to.value || n));
  from.value = f; to.value = t;
  S.from = f; S.to = t;
}
$('#sura').addEventListener('change', () => syncRange(true));
$('#from').addEventListener('change', () => syncRange(false));
$('#to').addEventListener('change', () => syncRange(false));
document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('.seg').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on); b.setAttribute('aria-checked', on);
  });
}
$('#modelBtn').addEventListener('click', loadModel);
$('#startBtn').addEventListener('click', () => {
  syncRange(false);
  store.set('last', { sura: S.sura, from: S.from, to: S.to, mode: S.mode });
  openPassage();
});
$('#backBtn').addEventListener('click', async () => {
  if (S.listening) await stopListening(true);
  show('setup');
});
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

// ======================= Passage =======================
function openPassage() {
  const s = QURAN[S.sura - 1];
  S.words = [];
  for (let v = S.from; v <= S.to; v++) {
    const toks = tokenize(s.v[v - 1]);
    toks.forEach((w, k) => S.words.push({ w, v, last: k === toks.length - 1 }));
  }
  S.exp = S.words.map((x) => variants(x.w));
  S.status = S.words.map(() => 'pending');
  S.heard = S.words.map(() => '');
  S.cursor = 0; S.hints = 0; S.misses = 0;

  $('#suraTitle').textContent = 'سورة ' + s.n;
  $('#suraMeta').textContent = `${s.t} · versets ${S.from}–${S.to} · ${S.mode === 'hifz' ? 'Ḥifẓ' : 'Révision'}`;
  $('#hintBtn').classList.toggle('hidden', S.mode !== 'hifz');
  $('#heardLine').textContent = '';
  setStatus('Touche le micro et commence à réciter');
  renderText();
  show('recite');
  $('#mushaf').scrollTop = 0;
  updateMic();
}

function renderText() {
  const box = $('#mushaf');
  box.classList.toggle('hifz', S.mode === 'hifz');
  box.innerHTML = '';
  if (S.from === 1 && S.sura !== 1 && S.sura !== 9) {
    const b = document.createElement('div');
    b.className = 'basmala'; b.textContent = BASMALA;
    box.appendChild(b);
  }
  const frag = document.createDocumentFragment();
  S.words.forEach((x, i) => {
    const sp = document.createElement('span');
    sp.className = 'w'; sp.dataset.i = i; sp.textContent = x.w;
    frag.appendChild(sp);
    frag.appendChild(document.createTextNode(' '));
    if (x.last) {
      const a = document.createElement('span');
      a.className = 'ayah'; a.dataset.v = x.v;
      a.textContent = '۝' + arNum(x.v);
      frag.appendChild(a);
      frag.appendChild(document.createTextNode(' '));
    }
  });
  box.appendChild(frag);
  S.words.forEach((_, i) => paint(i));
  paintAyahs();
  updateProgress();
}

function wordEl(i) { return $('#mushaf').querySelector(`.w[data-i="${i}"]`); }
function paint(i, animate = false) {
  const el = wordEl(i); if (!el) return;
  const st = S.status[i];
  const veiled = S.mode === 'hifz' && st === 'pending';
  el.className = 'w'
    + (st === 'correct' ? ' correct' : '')
    + (st === 'error' ? ' error' : '')
    + (st === 'missed' ? ' missed' : '')
    + (st === 'fixed' ? ' fixed' : '')
    + (st === 'hint' ? ' hint' : '')
    + (veiled ? ' veiled' : '')
    + (i === S.cursor ? ' cur' : '')
    + (animate && S.mode === 'hifz' ? ' pop' : '');
}
function paintAyahs() {
  if (S.mode !== 'hifz') return;
  $('#mushaf').querySelectorAll('.ayah').forEach((a) => {
    const v = +a.dataset.v;
    const lastIdx = S.words.findLastIndex((x) => x.v === v);
    a.classList.toggle('veiled', S.status[lastIdx] === 'pending');
  });
}
function moveCursor(n) {
  const old = S.cursor; S.cursor = Math.min(n, S.words.length);
  paint(old); paint(S.cursor);
  const el = wordEl(Math.min(S.cursor, S.words.length - 1));
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function updateProgress() {
  const done = S.status.filter((s) => s !== 'pending').length;
  $('#progressPill').textContent = Math.round((100 * done) / Math.max(1, S.words.length)) + ' %';
}

// ======================= Traitement d'un segment reconnu =======================
function handleTranscript(text) {
  const toks = tokenize(text);
  if (text) $('#heardLine').textContent = text;
  if (!toks.length) return;
  const before = S.cursor;
  const r = alignSegment(S.exp, toks.map(skeleton), S.cursor);
  if (!r.applied) {
    S.misses++;
    if (S.misses >= 2) setStatus('Je ne retrouve pas ce passage. Touche le mot où tu reprends.', true);
    return;
  }
  S.misses = 0;
  for (const o of r.ops) {
    const i = o.e, prev = S.status[i];
    if (o.kind === 'ok') {
      if (prev === 'error' || prev === 'missed') S.status[i] = 'fixed';
      else if (prev === 'pending') S.status[i] = 'correct';
    } else if (o.kind === 'sub') {
      if (i < before && (prev === 'correct' || prev === 'fixed')) continue; // répétition : on garde le bon
      S.status[i] = 'error';
      S.heard[i] = toks[o.h] || '';
    } else if (o.kind === 'miss') {
      if (prev === 'pending') S.status[i] = 'missed';
    }
    paint(i, prev === 'pending');
  }
  paintAyahs();
  moveCursor(r.newCursor);
  updateProgress();
  const errs = r.ops.filter((o) => o.kind !== 'ok').length;
  if (errs) setStatus(errs === 1 ? '1 erreur signalée' : `${errs} erreurs signalées`, true);
  else setStatus(S.listening ? 'J’écoute…' : '');
  if (S.cursor >= S.words.length && S.listening) {
    toast('Fin du passage');
    stopListening(false);
  }
}

// ======================= Micro, découpage par pauses =======================
let audioCtx = null, stream = null, node = null, src = null, sink = null, wakeLock = null;
const SR = 16000, FRAME = 320; // trames de 20 ms
const vad = {};
// Diagnostic (touche la ligne d'état pour l'afficher)
const D = { sent: 0, recv: 0, rate: 0, chunks: 0, zero: 0, rms: 0, thr: 0, ms: 0, raw: '', err: '', capture: '', engine: '' };
function diag() {
  const el = $('#diag'); if (!el || el.classList.contains('hidden')) return;
  const lvl = D.thr ? Math.min(10, Math.round((D.rms / D.thr) * 3)) : 0;
  el.textContent = [
    `Moteur : ${D.engine || 'non chargé'}`,
    `Micro : ${D.capture || '—'} · ${D.rate || '—'} Hz · blocs ${D.chunks} (muets ${D.zero})`,
    `Niveau : ${'▮'.repeat(lvl)}${'▯'.repeat(10 - lvl)}  (${D.rms.toFixed(4)} / seuil ${D.thr.toFixed(4)})`,
    `Segments envoyés : ${D.sent} · analysés : ${D.recv}${D.ms ? ' · ' + D.ms + ' ms' : ''}`,
    `Dernier texte : ${D.raw || '—'}`,
    D.err ? `Erreur : ${D.err}` : '',
  ].filter(Boolean).join('\n');
}
function resetVad() {
  Object.assign(vad, {
    pos: 0, frame: new Float32Array(FRAME), fi: 0,
    noise: null, calib: [], speaking: false, run: 0,
    pre: [], seg: [], speech: 0, silence: 0,
  });
}

function setStatus(text, warn = false) {
  const el = $('#statusLine'); el.textContent = text; el.classList.toggle('warn', warn);
}
function updateMic() {
  const b = $('#micBtn');
  b.classList.toggle('on', S.listening);
  b.disabled = !S.modelReady && !S.listening;
  b.setAttribute('aria-label', S.listening ? 'Arrêter l’écoute' : 'Commencer l’écoute');
  if (!S.modelReady && !S.listening && $('#recite').classList.contains('active')) {
    setStatus(store.get('modelDownloaded', false) ? 'Chargement du modèle vocal…' : 'Télécharge d’abord le modèle vocal (écran précédent)', true);
  }
}

$('#statusLine').addEventListener('click', () => { $('#diag').classList.toggle('hidden'); diag(); });
$('#micBtn').addEventListener('click', () => (S.listening ? stopListening(false) : startListening()));

async function startListening() {
  if (!S.modelReady) return;
  if (S.cursor >= S.words.length) { toast('Passage terminé. Utilise « Recommencer » dans le bilan.'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    toast('Accès au micro refusé. Autorise-le dans Réglages › Safari › Micro.', 4000);
    D.err = 'micro : ' + (err?.message || err); diag();
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try { await audioCtx.resume(); } catch { /* ignore */ }
  src = audioCtx.createMediaStreamSource(stream);
  sink = audioCtx.createGain(); sink.gain.value = 0;
  resetVad();
  D.rate = audioCtx.sampleRate; D.chunks = 0; D.zero = 0;
  try {
    await audioCtx.audioWorklet.addModule('./recorder-worklet.js');
    node = new AudioWorkletNode(audioCtx, 'recorder');
    node.port.onmessage = (e) => feed(e.data);
    D.capture = 'worklet';
  } catch {
    // Repli : ancienne API, toujours prise en charge par Safari
    node = audioCtx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => feed(new Float32Array(e.inputBuffer.getChannelData(0)));
    D.capture = 'script';
  }
  src.connect(node); node.connect(sink); sink.connect(audioCtx.destination);
  S.listening = true; S.stopping = false;
  // Surveillance : si aucun son n'arrive, on le dit au lieu de rester muet
  setTimeout(() => {
    if (!S.listening) return;
    if (D.chunks === 0) setStatus('Le micro ne transmet rien. Ferme l’app et rouvre-la.', true);
    else if (D.zero === D.chunks) setStatus('Le micro renvoie du silence. Vérifie qu’aucune autre app ne l’utilise.', true);
  }, 2500);
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  updateMic();
  setStatus('J’écoute…');
}

async function stopListening(silent) {
  if (!S.listening) return;
  S.listening = false;
  if (vad.speaking && vad.speech > 20) emit(vad.seg);
  vad.speaking = false;
  try { if (node?.port) node.port.onmessage = null; if (node) node.onaudioprocess = null; src?.disconnect(); node?.disconnect(); } catch { /* ignore */ }
  stream?.getTracks().forEach((t) => t.stop());
  try { await audioCtx?.close(); } catch { /* ignore */ }
  audioCtx = stream = node = src = sink = null;
  try { await wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
  $('#micRing').style.transform = 'scale(1)';
  updateMic();
  if (silent) { queue.length = 0; return; }
  S.stopping = true;
  if (!busy) finish();
  else setStatus('Analyse des derniers mots…');
}

// Rééchantillonnage vers 16 kHz (moyenne sur chaque pas)
function feed(chunk) {
  if (!audioCtx) return;
  D.chunks++;
  let any = false; for (let k = 0; k < chunk.length; k += 16) if (chunk[k] !== 0) { any = true; break; }
  if (!any) D.zero++;
  const step = audioCtx.sampleRate / SR;
  let p = vad.pos;
  while (p + step <= chunk.length) {
    const a = Math.max(0, Math.floor(p)), b = Math.max(a + 1, Math.floor(p + step));
    let sum = 0; for (let k = a; k < b; k++) sum += chunk[k];
    vad.frame[vad.fi++] = sum / (b - a);
    if (vad.fi === FRAME) { processFrame(vad.frame); vad.frame = new Float32Array(FRAME); vad.fi = 0; }
    p += step;
  }
  vad.pos = p - chunk.length;
}

// Détection des pauses : chaque arrêt de souffle (waqf) termine un segment
function processFrame(f) {
  let e = 0; for (let k = 0; k < f.length; k++) e += f[k] * f[k];
  const rms = Math.sqrt(e / f.length);
  // Bruit de fond : 10e centile des 3 dernières secondes
  vad.calib.push(rms); if (vad.calib.length > 150) vad.calib.shift();
  if (vad.calib.length % 10 === 0) {
    const sorted = [...vad.calib].sort((a, b) => a - b);
    vad.noise = sorted[Math.floor(sorted.length * 0.1)];
  }
  if (vad.noise === null) return;
  const thr = Math.max(vad.noise * 2.5, 0.0025);
  const isSpeech = rms > thr;
  D.rms = rms; D.thr = thr;
  if ((D.tick = (D.tick || 0) + 1) % 10 === 0) diag();
  $('#micRing').style.transform = `scale(${1 + Math.min(0.35, (rms / thr) * 0.08)})`;

  if (!vad.speaking) {
    vad.pre.push(f); if (vad.pre.length > 15) vad.pre.shift();
    vad.run = isSpeech ? vad.run + 1 : 0;
    if (vad.run >= 3) { vad.speaking = true; vad.seg = [...vad.pre]; vad.speech = vad.run; vad.silence = 0; }
    return;
  }
  vad.seg.push(f);
  if (isSpeech) { vad.speech++; vad.silence = 0; } else vad.silence++;
  if (vad.silence >= 35) {               // 0,7 s de silence
    emit(vad.seg.slice(0, vad.seg.length - 25));
    vad.speaking = false; vad.pre = []; vad.run = 0;
  } else if (vad.seg.length >= 1200) {   // 24 s sans pause : on coupe avec 1 s de recouvrement
    emit(vad.seg);
    vad.seg = vad.seg.slice(-50); vad.speech = 0;
  }
}

function emit(frames) {
  if (vad.speech < 20 || !frames.length) return; // moins de 0,4 s de voix : ignoré
  const out = new Float32Array(frames.length * FRAME);
  let peak = 0;
  frames.forEach((fr, k) => { out.set(fr, k * FRAME); });
  for (let k = 0; k < out.length; k++) peak = Math.max(peak, Math.abs(out[k]));
  if (peak > 0 && peak < 0.5) { const g = 0.8 / peak; for (let k = 0; k < out.length; k++) out[k] *= g; }
  vad.speech = 0;
  D.sent++; diag();
  enqueue(out);
}

const queue = [];
let busy = false;
function enqueue(audio) {
  queue.push(audio);
  if (!busy) pump();
}
async function pump() {
  busy = true;
  while (queue.length) {
    if (S.listening) setStatus('Analyse…');
    const res = await transcribe(queue.shift());
    D.recv++; D.ms = res.ms; D.raw = res.text || '(vide)';
    if (res.error) { D.err = res.error; setStatus('Erreur du modèle vocal (voir diagnostic)', true); }
    diag();
    handleTranscript(res.text || '');
  }
  busy = false;
  if (S.listening && !$('#statusLine').classList.contains('warn')) setStatus('J’écoute…');
  if (S.stopping) finish();
}

// ======================= Indice, fiche mot =======================
$('#hintBtn').addEventListener('click', () => {
  const i = S.cursor;
  if (i >= S.words.length) return;
  if (S.status[i] === 'pending') { S.status[i] = 'hint'; S.hints++; paint(i, true); paintAyahs(); }
});

let sheetIdx = -1;
$('#mushaf').addEventListener('click', (e) => {
  const el = e.target.closest('.w'); if (!el) return;
  openWordSheet(+el.dataset.i);
});
function openWordSheet(i) {
  sheetIdx = i;
  const st = S.status[i], w = S.words[i];
  const hidden = S.mode === 'hifz' && st === 'pending';
  $('#wsWord').textContent = hidden ? '•••' : w.w;
  const info = {
    pending: 'Pas encore récité.',
    correct: 'Mot correct.',
    hint: 'Révélé avec un indice.',
    fixed: 'Erreur corrigée en répétant.',
    missed: 'Mot oublié ou sauté.',
    error: '',
  }[st];
  const el = $('#wsInfo');
  el.innerHTML = '';
  if (st === 'error') {
    el.append('Entendu : ');
    const a = document.createElement('span'); a.className = 'ar'; a.dir = 'rtl'; a.textContent = S.heard[i] || '—';
    el.append(a);
  } else el.textContent = info;
  el.append(document.createElement('br'));
  const ref = document.createElement('small'); ref.textContent = `Verset ${w.v}`; el.append(ref);
  $('#wsReveal').classList.toggle('hidden', !hidden);
  $('#sheetBackdrop').classList.remove('hidden');
  $('#wordSheet').classList.remove('hidden');
}
function closeSheets() {
  $('#sheetBackdrop').classList.add('hidden');
  $('#wordSheet').classList.add('hidden');
  $('#summarySheet').classList.add('hidden');
}
$('#sheetBackdrop').addEventListener('click', closeSheets);
$('#wsReveal').addEventListener('click', () => {
  const i = sheetIdx;
  if (S.status[i] === 'pending') { S.status[i] = 'hint'; S.hints++; paint(i, true); paintAyahs(); }
  closeSheets();
});
$('#wsResume').addEventListener('click', () => {
  moveCursor(sheetIdx); S.misses = 0;
  setStatus(S.listening ? 'J’écoute… (reprise)' : 'Reprise à partir de ce mot');
  closeSheets();
});

// ======================= Bilan =======================
$('#finishBtn').addEventListener('click', async () => {
  if (S.listening) await stopListening(false); else finish();
});
function finish() {
  S.stopping = false;
  setStatus('Session terminée');
  const upto = Math.max(S.cursor, 1);
  const c = { correct: 0, error: 0, missed: 0, fixed: 0, hint: 0 };
  for (let i = 0; i < upto && i < S.words.length; i++) if (c[S.status[i]] !== undefined) c[S.status[i]]++;
  const done = c.correct + c.error + c.missed + c.fixed + c.hint;
  const score = done ? Math.round((100 * c.correct) / done) : 0;
  const stats = [
    ['score', score + ' %', 'Sans faute'], ['ok', c.correct, 'Corrects'], ['err', c.error, 'Erreurs'],
    ['miss', c.missed, 'Oublis'], ['fix', c.fixed, 'Corrigés'], ['hint', c.hint, 'Indices'],
  ];
  $('#sumStats').innerHTML = stats.map(([k, v, l]) => `<div class="stat ${k}"><b>${v}</b><span>${l}</span></div>`).join('');

  const list = $('#sumList'); list.innerHTML = '';
  const items = S.words.map((w, i) => ({ w, i, st: S.status[i] })).filter((x) => ['error', 'missed', 'fixed'].includes(x.st));
  if (!items.length) {
    list.innerHTML = `<div class="empty">${done ? 'Aucune erreur détectée. Bārak Allāhu fīk.' : 'Rien n’a encore été récité.'}</div>`;
  }
  for (const x of items) {
    const row = document.createElement('div'); row.className = 'sum-item';
    const label = { error: 'Erreur', missed: 'Oubli', fixed: 'Corrigé' }[x.st];
    row.innerHTML = `<span class="ref">v. ${x.w.v}</span><span class="what"></span><span class="tag ${x.st}">${label}</span>`;
    const what = row.querySelector('.what');
    const exp = document.createElement('span'); exp.className = 'ar'; exp.dir = 'rtl'; exp.textContent = x.w.w;
    what.append(exp);
    if (x.st === 'error' && S.heard[x.i]) {
      const h = document.createElement('span'); h.className = 'ar'; h.dir = 'rtl'; h.style.opacity = '.6';
      h.textContent = S.heard[x.i];
      what.append('  ←  ', h);
    }
    row.addEventListener('click', () => { closeSheets(); moveCursor(x.i); });
    list.appendChild(row);
  }
  $('#sheetBackdrop').classList.remove('hidden');
  $('#summarySheet').classList.remove('hidden');
}
$('#sumContinue').addEventListener('click', closeSheets);
$('#sumRestart').addEventListener('click', () => { closeSheets(); openPassage(); });

init();

// Accès de diagnostic (console)
window.__tilawa = { S, handleTranscript, finish };
