// Moteur de comparaison : texte attendu (Uthmani, Ḥafṣ) vs texte reconnu (modèle vocal).
// Module ES utilisable dans le navigateur et dans Node.

// ---------- Normalisation ----------
// Chaque mot est réduit à un "squelette" de consonnes pour absorber les différences
// d'orthographe entre le rasm uthmani et l'écriture courante (الصلوٰة / الصلاة, يٰأيها / يا أيها…).
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ࣓-ࣿ]/g;
const ALEFS = /[اأإآٱٲٳٵ]/g;

function base(word, smallLetters) {
  return word
    .replace(/وٰ/g, '')                 // وٰ (الصلوٰة) se lit comme un alif
    .replace(/ىٰ/g, 'ي')           // ىٰ
    .replace(/ۥ/g, smallLetters ? 'و' : '')          // ۥ petit waw
    .replace(/[ۦۧ]/g, smallLetters ? 'ي' : '')  // ۦ ۧ petit ya
    .replace(MARKS, '')
    .replace(ALEFS, '')
    .replace(/ى/g, 'ي')   // ى → ي
    .replace(/ة/g, 'ه')   // ة → ه
    .replace(/ؤ/g, 'و')   // ؤ → و
    .replace(/ئ/g, 'ي')   // ئ → ي
    .replace(/[^ب-ي]/g, ''); // hamza seule, chiffres, signes, ponctuation
}

// Squelette principal (sert aussi pour le texte entendu)
export function skeleton(word) { return base(word, true); }

// Variantes acceptées pour un mot attendu (petites lettres prononcées ou non écrites)
export function variants(word) {
  const a = base(word, true), b = base(word, false);
  return a === b ? [a] : [a, b];
}

export function tokenize(text) {
  return text.split(/\s+/).map(w => w.trim()).filter(w => skeleton(w).length > 0);
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Jugement d'un mot : 'ok' (correct), 'sub' (proche mais différent = erreur), 'far' (sans rapport).
// Strict sur la fin du mot, qui porte le iʿrāb (ـون / ـين…).
function judge1(e, h) {
  if (e === h) return 'ok';
  const d = lev(e, h);
  const L = Math.max(e.length, h.length);
  if (d === 1 && L >= 6) {
    let p = 0;
    while (p < e.length && p < h.length && e[p] === h[p]) p++;
    if (p < L - 2) return 'ok'; // petite variation d'orthographe au milieu du mot
  }
  if (d <= 2 && L >= 10) return 'ok';
  return 1 - d / L >= 0.5 ? 'sub' : 'far';
}
const RANK = { ok: 2, sub: 1, far: 0 };
export function judge(evars, h) {
  let best = 'far';
  for (const e of evars) {
    const j = judge1(e, h);
    if (RANK[j] > RANK[best]) best = j;
    if (best === 'ok') break;
  }
  return best;
}
const SCORE = { ok: 2, sub: 0, far: -1.2 };
const concat = (a, b) => a.flatMap(x => b.map(y => x + y));

const GAP_EXPECTED = -1.5; // mot attendu sauté au milieu d'un passage
const GAP_HEARD = -1;      // mot entendu en trop
const MIN_SCORE = 3.5;     // en dessous : segment considéré comme non reconnu

// ---------- Alignement local d'un segment ----------
// expected : tableau de variantes (tableaux de squelettes) pour tout le passage
// heard    : squelettes reconnus pour ce segment
// cursor   : index du prochain mot attendu
export function alignSegment(expected, heard, cursor) {
  if (!heard.length) return { applied: false, reason: 'vide' };
  const LOOKBACK = 14;
  const start = Math.max(0, cursor - LOOKBACK);
  const end = Math.min(expected.length, cursor + heard.length * 2 + 14);
  const E = expected.slice(start, end);
  const R = heard;
  const n = E.length, m = R.length;
  if (!n) return { applied: false, reason: 'fin' };

  const H = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const B = Array.from({ length: n + 1 }, () => new Int8Array(m + 1)); // 0 stop,1 diag,2 gapE,3 gapR,4 R2→E1,5 E2→R1
  const J = Array.from({ length: n }, (_, i) => R.map(h => judge(E[i], h)));
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let s = 0, b = 0;
      const d = H[i - 1][j - 1] + SCORE[J[i - 1][j - 1]];
      if (d > s) { s = d; b = 1; }
      const g1 = H[i - 1][j] + GAP_EXPECTED;
      if (g1 > s) { s = g1; b = 2; }
      const g2 = H[i][j - 1] + GAP_HEARD;
      if (g2 > s) { s = g2; b = 3; }
      if (j >= 2 && J[i - 1][j - 1] !== 'ok' && judge(E[i - 1], R[j - 2] + R[j - 1]) === 'ok') {
        const v = H[i - 1][j - 2] + 2.2; if (v > s) { s = v; b = 4; }
      }
      if (i >= 2 && J[i - 1][j - 1] !== 'ok' && judge(concat(E[i - 2], E[i - 1]), R[j - 1]) === 'ok') {
        const v = H[i - 2][j - 1] + 3.2; if (v > s) { s = v; b = 5; }
      }
      H[i][j] = s; B[i][j] = b;
      if (s > best || (s === best && s > 0 && i > bi)) { best = s; bi = i; bj = j; }
    }
  }
  if (best < MIN_SCORE) return { applied: false, reason: 'non reconnu', score: best };

  const ops = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0 && B[i][j] !== 0) {
    const b = B[i][j];
    if (b === 1) { ops.push({ e: start + i - 1, h: j - 1, kind: J[i - 1][j - 1] === 'ok' ? 'ok' : 'sub' }); i--; j--; }
    else if (b === 2) { ops.push({ e: start + i - 1, kind: 'miss' }); i--; }
    else if (b === 3) { ops.push({ h: j - 1, kind: 'extra' }); j--; }
    else if (b === 4) { ops.push({ e: start + i - 1, h: j - 2, kind: 'ok' }); i--; j -= 2; }
    else if (b === 5) {
      ops.push({ e: start + i - 1, h: j - 1, kind: 'ok' });
      ops.push({ e: start + i - 2, h: j - 1, kind: 'ok' });
      i -= 2; j--;
    }
  }
  ops.reverse();
  const isPair = o => o.kind === 'ok' || o.kind === 'sub';
  while (ops.length && !isPair(ops[0])) ops.shift();
  while (ops.length && !isPair(ops[ops.length - 1])) ops.pop();
  if (!ops.length) return { applied: false, reason: 'non reconnu', score: best };

  const firstE = ops[0].e;
  let lastE = ops[ops.length - 1].e;
  const lastH = Math.max(...ops.filter(o => o.h !== undefined).map(o => o.h));

  // Mots entendus après la fin de l'alignement : appariés aux mots attendus suivants (max 2)
  const trailing = [];
  for (let k = lastH + 1, e = lastE + 1; k < m && e < expected.length && trailing.length < 2; k++, e++) {
    trailing.push({ e, h: k, kind: 'sub' });
  }
  if (trailing.length) lastE = trailing[trailing.length - 1].e;

  // Saut en avant : mots entre le curseur et le début reconnu = oubliés
  const jumped = [];
  for (let e = cursor; e < firstE; e++) jumped.push({ e, kind: 'miss' });

  return {
    applied: true,
    score: best,
    ops: [...jumped, ...ops, ...trailing].filter(o => o.e !== undefined),
    newCursor: Math.max(cursor, lastE + 1),
    repeated: firstE < cursor,
  };
}
