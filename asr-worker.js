// Worker : modèle vocal spécialisé Coran (whisper-base fine-tuné par Tarteel, export ONNX),
// exécuté entièrement sur l'appareil. Rien n'est envoyé sur un serveur.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
env.useBrowserCache = true; // les fichiers du modèle restent en cache → fonctionnement hors ligne

const MODELS = ['iqbalaesthetic/Basira', 'aaqibhabib/whisper-base-ar-quran-onnx'];
let asr = null;
let info = null;
let useLang = true;
let loading = null;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'load') {
    loading ??= load();
    await loading;
  } else if (m.type === 'transcribe') {
    try {
      if (!asr) { loading ??= load(); await loading; }
      const t0 = performance.now();
      const out = await run(m.audio);
      self.postMessage({ type: 'result', id: m.id, text: (out?.text || '').trim(), ms: Math.round(performance.now() - t0) });
    } catch (err) {
      self.postMessage({ type: 'result', id: m.id, text: '', error: String(err?.message || err) });
    }
  }
};

async function load() {
  if (asr) { self.postMessage({ type: 'ready', ...info }); return; }
  let webgpu = false, f16 = false;
  try {
    if (self.navigator?.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) { webgpu = true; f16 = adapter.features.has('shader-f16'); }
    }
  } catch { /* pas de WebGPU */ }

  const attempts = [];
  if (webgpu) attempts.push({ device: 'webgpu', dtype: f16 ? 'fp16' : 'q4' });
  attempts.push({ device: 'wasm', dtype: 'q8' });

  const files = {};
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) {
      files[p.file] = [p.loaded, p.total];
      let l = 0, t = 0;
      for (const [a, b] of Object.values(files)) { l += a; t += b; }
      self.postMessage({ type: 'progress', loaded: l, total: t });
    }
  };

  let lastErr = null;
  for (const model of MODELS) {
    for (const opt of attempts) {
      try {
        self.postMessage({ type: 'status', text: opt.device === 'webgpu' ? 'Préparation (GPU)…' : 'Préparation…' });
        asr = await pipeline('automatic-speech-recognition', model, { ...opt, progress_callback });
        self.postMessage({ type: 'status', text: 'Initialisation…' });
        await run(new Float32Array(16000)); // préchauffage
        info = { model, device: opt.device, dtype: opt.dtype };
        self.postMessage({ type: 'ready', ...info });
        return;
      } catch (err) {
        lastErr = err;
        try { await asr?.dispose?.(); } catch {}
        asr = null;
        for (const k of Object.keys(files)) delete files[k];
      }
    }
  }
  loading = null;
  self.postMessage({ type: 'error', message: String(lastErr?.message || lastErr) });
}

async function run(audio) {
  const base = { return_timestamps: false };
  if (useLang) {
    try { return await asr(audio, { ...base, language: 'arabic', task: 'transcribe' }); }
    catch { useLang = false; }
  }
  return asr(audio, base);
}
