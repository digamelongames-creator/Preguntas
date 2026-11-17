// Motor del duelo. Funciones puras sobre un estado `s` que se guarda tal cual en Firebase.
// Los asientos son 'A' (quien reta / tú en práctica) y 'B'. Las acciones devuelven false si no son válidas.
import { PREGUNTAS } from './preguntas.js';

export const ENERGIA = 6, MANO_INICIAL = 6, ROBO = 2, TIEMPO = 25;
export const otro = w => (w === 'A' ? 'B' : 'A');
export const carta = id => PREGUNTAS[id];

export function barajar(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Firebase borra los arrays vacíos y los null: los restauramos al leer.
export function norm(s) {
  s.mano = s.mano || {}; s.mazo = s.mazo || {};
  for (const w of ['A', 'B']) { s.mano[w] = s.mano[w] || []; s.mazo[w] = s.mazo[w] || []; }
  s.hist = s.hist || [];
  s.pasa = Object.assign({ A: false, B: false }, s.pasa);
  s.comodin = Object.assign({ A: true, B: true }, s.comodin);
  s.contado = Object.assign({ A: false, B: false }, s.contado);
  if (s.q) s.q.quita = s.q.quita || [];
  if (s.ultima) s.ultima.quita = s.ultima.quita || [];
  return s;
}

function robar(s, w, n) { for (let i = 0; i < n && s.mazo[w].length; i++) s.mano[w].push(s.mazo[w].shift()); }

export function nuevoEstado() {
  const ids = barajar(PREGUNTAS.map((_, i) => i));
  const mitad = Math.floor(ids.length / 2);
  const s = norm({
    ronda: 1, rondas: { A: 0, B: 0 }, total: { A: 0, B: 0 }, puntos: { A: 0, B: 0 },
    energia: { A: ENERGIA, B: ENERGIA }, mazo: { A: ids.slice(0, mitad), B: ids.slice(mitad) },
    turno: 'A', fase: 'elegir', seq: 0, ganador: '', t: Date.now()
  });
  robar(s, 'A', MANO_INICIAL); robar(s, 'B', MANO_INICIAL);
  return avanzar(s);
}

export const puedeJugar = (s, w) => s.mano[w].some(id => carta(id).d <= s.energia[w]);

function finRonda(s) {
  const { A, B } = s.puntos;
  s.total.A += A; s.total.B += B;
  const gan = A > B ? 'A' : B > A ? 'B' : '';
  if (gan) s.rondas[gan]++;
  s.rondaRes = { n: s.ronda, A, B, gan, rondas: { ...s.rondas }, seq: ++s.seq };
  if (s.rondas.A === 2 || s.rondas.B === 2 || s.ronda === 3) {
    s.fase = 'fin';
    if (s.rondas.A !== s.rondas.B) s.ganador = s.rondas.A > s.rondas.B ? 'A' : 'B';
    else s.ganador = s.total.A > s.total.B ? 'A' : s.total.B > s.total.A ? 'B' : '';
    return;
  }
  s.ronda++;
  robar(s, 'A', ROBO); robar(s, 'B', ROBO);
  s.puntos = { A: 0, B: 0 }; s.energia = { A: ENERGIA, B: ENERGIA }; s.pasa = { A: false, B: false };
  s.turno = s.ronda % 2 === 1 ? 'A' : 'B';
}

// Resuelve pases automáticos (sin cartas pagables) y fin de ronda hasta que alguien tenga que decidir.
export function avanzar(s) {
  for (let k = 0; k < 30; k++) {
    if (s.fase === 'fin') return s;
    if (s.pasa.A && s.pasa.B) { finRonda(s); continue; }
    if (s.pasa[s.turno]) s.turno = otro(s.turno);
    if (!puedeJugar(s, s.turno)) { s.pasa[s.turno] = true; continue; }
    return s;
  }
  return s;
}

export function lanzar(s, w, id, ahora) {
  if (s.fase !== 'elegir' || s.turno !== w || s.pasa[w]) return false;
  const i = s.mano[w].indexOf(id);
  if (i < 0 || carta(id).d > s.energia[w]) return false;
  s.mano[w].splice(i, 1);
  s.energia[w] -= carta(id).d;
  // orden: posiciones de las opciones; el valor 0 es la correcta. limite se fija cuando el rival la ve.
  s.q = { id, por: w, orden: barajar([0, 1, 2, 3]), quita: [], limite: 0 };
  s.fase = 'responder'; s.t = ahora;
  return true;
}

// El que responde abre la pregunta: empieza a contar su tiempo.
export function verPregunta(s, w, ahora) {
  if (s.fase !== 'responder' || otro(s.q.por) !== w || s.q.limite) return false;
  s.q.limite = ahora + TIEMPO * 1000;
  return true;
}

export function responder(s, w, idx, ahora) {
  if (s.fase !== 'responder') return false;
  const q = s.q, resp = otro(q.por);
  if (w !== resp) {
    // El rival solo puede cerrar la pregunta por tiempo agotado (si el otro se fue).
    if (idx !== -1 || !q.limite || ahora < q.limite + 4000) return false;
  }
  const d = carta(q.id).d;
  const ok = idx >= 0 && q.orden[idx] === 0;
  s.puntos[ok ? resp : q.por] += d;
  s.hist.push({ id: q.id, r: resp, ok });
  s.ultima = { id: q.id, por: q.por, r: resp, elige: idx, orden: q.orden, quita: q.quita, ok, seq: ++s.seq };
  s.q = null; s.fase = 'elegir'; s.turno = resp; s.t = ahora;
  return avanzar(s), true;
}

export function comodin(s, w) {
  if (s.fase !== 'responder' || otro(s.q.por) !== w || !s.comodin[w] || s.q.quita.length) return false;
  s.comodin[w] = false;
  s.q.quita = barajar([0, 1, 2, 3].filter(i => s.q.orden[i] !== 0)).slice(0, 2);
  return true;
}

export function pasar(s, w, ahora) {
  if (s.fase !== 'elegir' || s.turno !== w || s.pasa[w]) return false;
  s.pasa[w] = true; s.turno = otro(w); s.t = ahora;
  return avanzar(s), true;
}

export function abandonar(s, w, ahora) {
  if (s.fase === 'fin') return false;
  s.fase = 'fin'; s.ganador = otro(w); s.abandono = w; s.q = null; s.t = ahora;
  return true;
}

// IA de práctica
const ACIERTO_IA = { 1: 0.8, 2: 0.6, 3: 0.4 };
export function iaElige(s, w) {
  const yo = s.puntos[w], el = s.puntos[otro(w)];
  if (s.pasa[otro(w)] && yo > el) return null;
  if (!s.pasa[otro(w)] && s.ronda < 3 && yo - el >= 3 && Math.random() < 0.5) return null;
  const ops = s.mano[w].filter(id => carta(id).d <= s.energia[w]);
  if (Math.random() < 0.6) {
    const m = Math.max(...ops.map(id => carta(id).d));
    return barajar(ops.filter(id => carta(id).d === m))[0];
  }
  return barajar(ops)[0];
}
export function iaResponde(s) {
  const q = s.q;
  if (Math.random() < ACIERTO_IA[carta(q.id).d]) return q.orden.indexOf(0);
  return barajar([0, 1, 2, 3].filter(i => q.orden[i] !== 0 && !q.quita.includes(i)))[0];
}
