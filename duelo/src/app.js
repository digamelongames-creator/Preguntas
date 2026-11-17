import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile
} from 'firebase/auth';
import { getDatabase, ref, onValue, set, update, push, runTransaction, serverTimestamp, increment, remove } from 'firebase/database';
import { App } from '@capacitor/app';
import { FIREBASE } from './firebase-config.js';
import * as E from './engine.js';

const $app = document.getElementById('app');
const DN = { 1: 'Fácil', 2: 'Media', 3: 'Difícil' };
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gems = n => '<i>' + '●'.repeat(n) + '</i>' + '○'.repeat(Math.max(0, 2 - n));
const pts = n => n + (n === 1 ? ' punto' : ' puntos');

// ---------- Firebase ----------
const configurado = !!FIREBASE.apiKey && !FIREBASE.apiKey.startsWith('PEGA');
let auth = null, db = null, offset = 0;
if (configurado) {
  const fb = initializeApp(FIREBASE);
  auth = initializeAuth(fb, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = getDatabase(fb);
  onValue(ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
}
const ahora = () => Date.now() + offset;

let yo = null;            // { uid, nombre }
let pantalla = 'login';   // login | lobby | juego
let nombreRegistro = '', ultimoEmail = '';
const L = { usuarios: {}, partidas: {}, subs: {}, unsubs: [], int: 0, error: '' };
let V = null;             // partida abierta
let ovHtml = null;

function toast(t) {
  const el = document.getElementById('toast');
  el.textContent = t; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}
function setOv(html) {
  if (html === ovHtml) return;
  ovHtml = html;
  let o = document.getElementById('ov');
  if (!o) { o = document.createElement('div'); o.id = 'ov'; o.className = 'ov'; document.body.appendChild(o); }
  o.innerHTML = html;
}
function cerrarOv() { ovHtml = null; document.getElementById('ov')?.remove(); }

const ERRORES = {
  'auth/invalid-credential': 'Email o contraseña incorrectos.',
  'auth/wrong-password': 'Email o contraseña incorrectos.',
  'auth/user-not-found': 'No hay ninguna cuenta con ese email.',
  'auth/email-already-in-use': 'Ese email ya tiene cuenta. Entra con él.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/invalid-email': 'El email no es válido.',
  'auth/network-request-failed': 'Sin conexión a internet.',
  'auth/too-many-requests': 'Demasiados intentos. Espera un poco.',
  'auth/operation-not-allowed': 'El acceso con email no está activado en Firebase.'
};
const errorTexto = e => ERRORES[e?.code] || ('Error: ' + (e?.code || e?.message || e));

// ---------- Inicio de sesión ----------
function pantallaLogin(modo = 'entrar', msg = '', okm = false) {
  pantalla = 'login'; cerrarOv();
  $app.innerHTML = `<div class="intro">
    <h1><small>OPOSICIÓN</small>Duelo de Preguntas</h1>
    ${configurado ? `<form class="panel" id="flogin" data-modo="${modo}">
      <div class="tabs"><button type="button" data-a="tab" data-m="entrar" class="${modo === 'entrar' ? 'on' : ''}">Entrar</button><button type="button" data-a="tab" data-m="registro" class="${modo === 'registro' ? 'on' : ''}">Crear cuenta</button></div>
      ${modo === 'registro' ? '<label>Nombre de jugador<input id="fnombre" maxlength="18" required autocomplete="nickname" value="${esc(nombreRegistro)}"></label>' : ''}
      <label>Email<input id="femail" type="email" required autocomplete="email" value="${esc(ultimoEmail)}"></label>
      <label>Contraseña<input id="fpass" type="password" minlength="6" required autocomplete="${modo === 'registro' ? 'new-password' : 'current-password'}"></label>
      ${msg ? `<div class="msg ${okm ? 'okm' : ''}">${esc(msg)}</div>` : ''}
      <button class="big" type="submit">${modo === 'registro' ? 'Crear cuenta' : 'Entrar'}</button>
      ${modo === 'entrar' ? '<button type="button" class="link" data-a="olvido">¿Has olvidado la contraseña?</button>' : ''}
    </form>` : `<div class="panel msg">Falta conectar Firebase. De momento solo puedes practicar contra la IA.</div>`}
    <button class="ghost" data-a="practica">🤖 Practicar sin cuenta</button>
    <button class="link" data-a="reglas">Cómo se juega</button>
  </div>`;
}

async function enviarLogin(form) {
  const modo = form.dataset.modo;
  const email = (ultimoEmail = form.querySelector('#femail').value.trim()), pass = form.querySelector('#fpass').value;
  const btn = form.querySelector('.big'); btn.disabled = true;
  try {
    if (modo === 'registro') {
      nombreRegistro = form.querySelector('#fnombre').value.trim().slice(0, 18);
      if (!nombreRegistro) { btn.disabled = false; return; }
      const c = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(c.user, { displayName: nombreRegistro });
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (e) { pantallaLogin(modo, errorTexto(e)); }
}

async function olvido() {
  const email = document.getElementById('femail')?.value.trim();
  if (!email) return pantallaLogin('entrar', 'Escribe tu email y vuelve a pulsar «¿Has olvidado la contraseña?».');
  try { await sendPasswordResetEmail(auth, email); pantallaLogin('entrar', 'Te hemos enviado un email para cambiar la contraseña.', true); }
  catch (e) { pantallaLogin('entrar', errorTexto(e)); }
}

if (configurado) {
  onAuthStateChanged(auth, u => {
    if (u) { yo = { uid: u.uid, nombre: u.displayName || u.email.split('@')[0] }; entrarLobby(); }
    else { yo = null; limpiarLobby(); if (pantalla !== 'juego') pantallaLogin(); }
  });
} else pantallaLogin();

// ---------- Sala ----------
function limpiarLobby() {
  L.unsubs.forEach(f => f()); L.unsubs = [];
  Object.values(L.subs).forEach(f => f()); L.subs = {};
  L.usuarios = {}; L.partidas = {}; clearInterval(L.int);
}
function visto() {
  if (yo && L.usuarios[yo.uid]?.nombre) update(ref(db, 'duelo/usuarios/' + yo.uid), { visto: serverTimestamp() }).catch(() => {});
}
function entrarLobby() {
  limpiarLobby();
  if (pantalla !== 'juego') pantalla = 'lobby';
  L.unsubs.push(onValue(ref(db, 'duelo/usuarios'), snap => {
    L.usuarios = snap.val() || {}; L.error = '';
    const mio = L.usuarios[yo.uid];
    if (!mio?.nombre) {
      set(ref(db, 'duelo/usuarios/' + yo.uid), { nombre: nombreRegistro || yo.nombre, v: 0, d: 0, p: 0, visto: serverTimestamp() })
        .catch(e => { L.error = e.message; pintarLobby(); });
    } else yo.nombre = mio.nombre;
    pintarLobby();
  }, e => { L.error = e.message; pintarLobby(); }));
  L.unsubs.push(onValue(ref(db, 'duelo/misPartidas/' + yo.uid), snap => {
    const ids = Object.keys(snap.val() || {});
    for (const id of Object.keys(L.subs)) if (!ids.includes(id)) { L.subs[id](); delete L.subs[id]; delete L.partidas[id]; }
    for (const id of ids) if (!L.subs[id]) {
      L.subs[id] = onValue(ref(db, 'duelo/partidas/' + id), ps => {
        const p = ps.val();
        if (p?.s) { E.norm(p.s); L.partidas[id] = p; } else delete L.partidas[id];
        pintarLobby();
      });
    }
    pintarLobby();
  }));
  L.int = setInterval(() => { visto(); pintarLobby(); }, 60000);
  setTimeout(visto, 1500);
  pintarLobby();
}

const asiento = p => (p.jugadores?.A === yo.uid ? 'A' : 'B');
function miTurno(p) {
  const s = p.s; if (!s || s.fase === 'fin' || p.estado !== 'activa') return false;
  const w = asiento(p);
  return s.fase === 'elegir' ? s.turno === w : E.otro(s.q.por) === w;
}

function pintarLobby() {
  if (pantalla !== 'lobby' || !yo) return;
  const me = L.usuarios[yo.uid] || {};
  const ps = Object.entries(L.partidas).map(([id, p]) => ({ id, ...p, w: asiento(p) }));
  const rival = p => p.jugadores[E.otro(p.w)], rivalNom = p => esc(p.nombres?.[E.otro(p.w)] || '?');
  const recibidos = ps.filter(p => p.estado === 'invitacion' && p.w === 'B');
  const enviados = ps.filter(p => p.estado === 'invitacion' && p.w === 'A');
  const activas = ps.filter(p => p.estado === 'activa' && p.s.fase !== 'fin').sort((a, b) => miTurno(b) - miTurno(a) || b.s.t - a.s.t);
  const terminadas = ps.filter(p => p.estado === 'rechazada' || p.s.fase === 'fin').sort((a, b) => (b.s.t || 0) - (a.s.t || 0)).slice(0, 8);
  const ocupados = new Set([...recibidos, ...enviados, ...activas].map(rival));
  const jugadores = Object.entries(L.usuarios).filter(([u, x]) => u !== yo.uid && x?.nombre)
    .map(([u, x]) => ({ u, ...x, on: ahora() - (x.visto || 0) < 150000 }))
    .sort((a, b) => b.on - a.on || a.nombre.localeCompare(b.nombre));
  const sec = (t, items, vacio = '') => (items.length || vacio) ? `<div class="sec"><h3>${t}</h3>${items.join('') || `<div class="vacio">${vacio}</div>`}</div>` : '';
  const resultado = p => {
    if (p.estado === 'rechazada') return '<span class="badge">Rechazado</span>';
    const g = p.s.ganador;
    return g === p.w ? '<span class="badge win">Victoria</span>' : g ? '<span class="badge lose">Derrota</span>' : '<span class="badge">Empate</span>';
  };
  $app.innerHTML = `
  <header class="top"><div class="av">🧑‍✈️</div><div class="yo"><span>Jugador</span><b>${esc(me.nombre || yo.nombre)}</b></div>
    <div class="rec">${me.v || 0}V · ${me.d || 0}D</div><button class="icon" data-a="menu">⋯</button></header>
  ${L.error ? `<div class="panel msg">No se puede leer la base de datos (${esc(L.error)}). Revisa las reglas de Firebase.</div>` : ''}
  <button class="big" data-a="practica">🤖 Practicar contra la IA</button>
  ${sec('Te han retado', recibidos.map(p => `<div class="row hot"><div class="rn"><b>${rivalNom(p)}</b><span>te reta a un duelo</span></div>
      <button class="sm ok" data-a="aceptar" data-id="${p.id}">Aceptar</button><button class="sm no" data-a="rechazar" data-id="${p.id}">✕</button></div>`))}
  ${sec('En juego', activas.map(p => `<button class="row ${miTurno(p) ? 'hot' : ''}" data-a="abrir" data-id="${p.id}"><div class="rn"><b>vs ${rivalNom(p)}</b>
      <span>Ronda ${p.s.ronda} · rondas ${p.s.rondas[p.w]}–${p.s.rondas[E.otro(p.w)]}</span></div>
      <span class="badge ${miTurno(p) ? 'hot' : ''}">${miTurno(p) ? 'Tu turno' : 'Su turno'}</span></button>`))}
  ${sec('Retos enviados', enviados.map(p => `<div class="row"><div class="rn"><b>${rivalNom(p)}</b><span>esperando a que acepte…</span></div>
      <button class="sm no" data-a="cancelar" data-id="${p.id}">Cancelar</button></div>`))}
  ${sec('Jugadores', jugadores.map(j => `<div class="row"><span class="dot ${j.on ? 'on' : ''}"></span><div class="rn"><b>${esc(j.nombre)}</b>
      <span>${j.on ? 'En línea · ' : ''}${j.v || 0}V · ${j.d || 0}D</span></div>
      <button class="sm ${ocupados.has(j.u) ? '' : 'ok'}" data-a="retar" data-uid="${j.u}" ${ocupados.has(j.u) ? 'disabled' : ''}>${ocupados.has(j.u) ? 'En curso' : 'Retar'}</button></div>`),
    'Aún no hay más jugadores. Pasa la APK a tus amigos para que creen su cuenta.')}
  ${sec('Terminadas', terminadas.map(p => `<div class="row"><button class="rn" data-a="${p.estado === 'rechazada' ? '' : 'abrir'}" data-id="${p.id}"><b>vs ${rivalNom(p)}</b>
      <span>${p.estado === 'rechazada' ? 'No aceptó el reto' : `Rondas ${p.s.rondas[p.w]}–${p.s.rondas[E.otro(p.w)]}${p.s.abandono ? ' · abandono' : ''}`}</span></button>
      ${resultado(p)}<button class="sm no" data-a="borrar" data-id="${p.id}">✕</button></div>`))}
  <div style="height:20px"></div>`;
}

async function retar(uid) {
  const r = L.usuarios[uid]; if (!r) return;
  const id = push(ref(db, 'duelo/partidas')).key;
  try {
    await update(ref(db), {
      [`duelo/partidas/${id}`]: { jugadores: { A: yo.uid, B: uid }, nombres: { A: yo.nombre, B: r.nombre }, estado: 'invitacion', creada: serverTimestamp(), s: E.nuevoEstado() },
      [`duelo/misPartidas/${yo.uid}/${id}`]: true,
      [`duelo/misPartidas/${uid}/${id}`]: true
    });
    toast('Reto enviado a ' + r.nombre);
  } catch (e) { toast('No se pudo enviar el reto'); }
}
async function cancelarReto(id) {
  const p = L.partidas[id]; if (!p) return;
  await update(ref(db), { [`duelo/partidas/${id}`]: null, [`duelo/misPartidas/${p.jugadores.A}/${id}`]: null, [`duelo/misPartidas/${p.jugadores.B}/${id}`]: null }).catch(() => toast('Error de conexión'));
}

function menuLobby() {
  setOv(`<div class="sheet"><div class="from">Sesión iniciada como ${esc(auth.currentUser?.email)}</div>
    <button class="ghost" data-a="reglas">Cómo se juega</button>
    <button class="ghost" data-a="salir">Cerrar sesión</button>
    <button class="big" data-a="cerrar">Volver</button></div>`);
}
function reglas() {
  setOv(`<div class="sheet"><div class="rules">
    <div>Cada jugador tiene un <b>mazo de cartas-pregunta</b>. En tu turno eliges qué pregunta le lanzas al rival, y él hace lo mismo contigo.</div>
    <div><b>Coste y puntos:</b> cada carta cuesta energía ⚡ según su dificultad. Tienes ${E.ENERGIA}⚡ por ronda.</div>
    <div class="legend"><span class="chip d1">Fácil ⚡1 · 1 pt</span><span class="chip d2">Media ⚡2 · 2 pts</span><span class="chip d3">Difícil ⚡3 · 3 pts</span></div>
    <div>Si quien responde <b>acierta</b>, gana los puntos de la carta. Si <b>falla</b>, se los lleva quien la lanzó.</div>
    <div><b>Como en Gwent:</b> 3 rondas y gana quien se lleve 2. Puedes <b>pasar</b> para guardar cartas para la siguiente ronda (+${E.ROBO} cartas nuevas).</div>
    <div>Tienes <b>${E.TIEMPO} s</b> para responder desde que ves la pregunta y un <b>comodín 50/50</b> por partida.</div>
  </div><button class="big" data-a="cerrar">Entendido</button></div>`);
}

// ---------- Partida ----------
function vistoGuardado(id) { try { return +localStorage.getItem('visto-' + id) || 0; } catch { return 0; } }
function guardarVisto(seq) { if (V?.modo === 'online') try { localStorage.setItem('visto-' + V.id, seq); } catch { } }

function abrirPractica() {
  pantalla = 'juego'; cerrarOv();
  V = { modo: 'ia', yo: 'A', nombres: { A: yo?.nombre || 'Tú', B: 'Rival IA' }, s: null, visto: 0, cola: [], sel: null };
  recibirEstado(E.nuevoEstado());
}
function abrirPartida(id) {
  const p = L.partidas[id]; if (!p) return;
  pantalla = 'juego'; cerrarOv();
  V = { modo: 'online', id, yo: asiento(p), nombres: p.nombres, s: null, visto: vistoGuardado(id), cola: [], sel: null, rival: p.jugadores[E.otro(asiento(p))] };
  $app.innerHTML = '<div class="mid"><div class="log">Cargando partida…</div></div>';
  V.unsub = onValue(ref(db, 'duelo/partidas/' + id), snap => {
    const pp = snap.val();
    if (!pp?.s || !V || V.id !== id) { if (V?.id === id) { toast('La partida ya no existe'); salirPartida(); } return; }
    V.nombres = pp.nombres;
    recibirEstado(E.norm(pp.s));
  });
}
function salirPartida() {
  V?.unsub?.(); clearTimeout(V?.iaT); V = null; cerrarOv();
  if (yo) { pantalla = 'lobby'; pintarLobby(); } else pantallaLogin();
}

function recibirEstado(s) {
  V.s = s;
  const evs = [s.ultima && { tipo: 'res', ...s.ultima }, s.rondaRes && { tipo: 'ronda', ...s.rondaRes }]
    .filter(e => e && e.seq > V.visto).sort((a, b) => a.seq - b.seq);
  for (const e of evs) V.cola.push(e);
  if (evs.length) V.visto = evs[evs.length - 1].seq;
  if (s.fase === 'fin' && V.modo === 'online') contarResultado();
  pintarJuego();
  iaPaso();
}

async function act(fn) {
  if (!V) return;
  if (V.modo === 'ia') { if (fn(V.s, ahora())) recibirEstado(V.s); return; }
  if (V.enviando) return;
  V.enviando = true;
  try {
    await runTransaction(ref(db, `duelo/partidas/${V.id}/s`), cur => {
      if (!cur) return cur;
      E.norm(cur);
      return fn(cur, ahora()) ? cur : undefined;
    });
  } catch (e) { toast('Error de conexión'); }
  if (V) V.enviando = false;
}

function contarResultado() {
  const w = V.yo, id = V.id, s = V.s;
  if (s.contado[w]) return;
  runTransaction(ref(db, `duelo/partidas/${id}/s/contado/${w}`), c => (c ? undefined : true)).then(r => {
    if (!r.committed) return;
    const upd = { p: increment(1) };
    if (s.ganador === w) upd.v = increment(1); else if (s.ganador) upd.d = increment(1);
    update(ref(db, 'duelo/usuarios/' + yo.uid), upd);
  }).catch(() => {});
}

function iaPaso() {
  if (V?.modo !== 'ia' || V.iaT || V.cola.length) return;
  const s = V.s, ia = 'B';
  if (s.fase === 'elegir' && s.turno === ia && !s.pasa[ia]) {
    V.iaT = setTimeout(() => { V.iaT = 0; const id = E.iaElige(s, ia); act((x, t) => (id == null ? E.pasar(x, ia, t) : E.lanzar(x, ia, id, t))); }, 1000);
  } else if (s.fase === 'responder' && s.q.por === V.yo) {
    V.iaT = setTimeout(() => { V.iaT = 0; E.verPregunta(s, ia, ahora()); act((x, t) => E.responder(x, ia, E.iaResponde(x), t)); }, 1900);
  }
}

const nom = w => esc(V.nombres?.[w] || (w === V.yo ? 'Tú' : 'Rival'));

function pintarJuego() {
  if (pantalla !== 'juego' || !V?.s) return;
  const s = V.s, w = V.yo, r = E.otro(w);
  if (s.fase === 'fin' && !V.cola.length) return pintarFin();
  const miT = s.fase === 'elegir' && s.turno === w && !s.pasa[w];
  if (!miT) V.sel = null;
  const sel = s.mano[w].includes(V.sel) ? V.sel : null;
  let estado;
  if (s.fase === 'responder') estado = s.q.por === w ? `Has lanzado una pregunta a ${nom(r)}.` : `${nom(r)} te ha lanzado una pregunta.`;
  else if (miT) estado = s.pasa[r] ? `${nom(r)} ha pasado. Sigue jugando o pasa tú.` : 'Tu turno: elige una carta para lanzar.';
  else if (s.pasa[w]) estado = `Has pasado. Juega ${nom(r)}…`;
  else estado = `Turno de ${nom(r)}…`;
  const cartas = s.mano[w].length ? s.mano[w].map(id => {
    const c = E.carta(id);
    return `<button class="card d${c.d} ${sel === id ? 'sel' : ''} ${c.d > s.energia[w] ? 'off' : ''}" data-a="carta" data-c="${id}">
      <div class="ctop"><span class="cost">⚡${c.d}</span><span class="lvl">${DN[c.d]}</span></div>
      <div class="ctag">${esc(c.t)}</div><div class="cq">${esc(c.q)}</div><div class="cpts">${pts(c.d)} en juego</div></button>`;
  }).join('') : '<div class="empty">No te quedan cartas</div>';
  const scroll = $app.querySelector('.hand')?.scrollLeft || 0;
  $app.innerHTML = `
  <div class="gtop"><button data-a="volver">← Salir</button><button data-a="abandonar">Abandonar</button></div>
  <div class="bar ${(s.fase === 'elegir' && s.turno === r && !s.pasa[r]) ? 'turn' : ''}">
    <div class="av">${V.modo === 'ia' ? '🤖' : '🕵️'}</div><div class="who"><b>${nom(r)}</b><div class="gems">${gems(s.rondas[r])}</div></div>
    <div class="stats"><span>⚡${s.energia[r]}</span>${s.pasa[r] ? '<span class="pass">PASA</span>' : ''}</div>
    <div class="pts">${s.puntos[r]}</div>
  </div>
  <div class="rivalhand">${s.mano[r].map(() => '<div class="back"></div>').join('')}</div>
  <div class="mid"><div class="rnd">RONDA ${s.ronda} / 3</div><div class="log">${estado}</div></div>
  <div class="bar ${miT ? 'turn' : ''}">
    <div class="av">🧑‍✈️</div><div class="who"><b>${nom(w)}</b><div class="gems">${gems(s.rondas[w])}</div></div>
    <div class="stats"><span>⚡${s.energia[w]}</span><span>🃏${s.mazo[w].length}</span>${s.pasa[w] ? '<span class="pass">PASAS</span>' : ''}</div>
    <div class="pts">${s.puntos[w]}</div>
  </div>
  <div class="hand">${cartas}</div>
  <div class="actions">
    <button class="bpass" data-a="pasar" ${miT ? '' : 'disabled'}>Pasar ronda</button>
    <button class="bgo" data-a="lanzar" ${miT && sel != null && E.carta(sel).d <= s.energia[w] ? '' : 'disabled'}>Lanzar carta</button>
  </div>`;
  const h = $app.querySelector('.hand'); if (h) h.scrollLeft = scroll;

  if (V.cola.length) mostrarEvento(V.cola[0]);
  else if (s.fase === 'responder') mostrarPregunta();
  else if (!V.confirmar) cerrarOv();
  if (V.confirmar) confirmarAbandono();
  tick();
}

function mostrarPregunta() {
  const s = V.s, q = s.q, c = E.carta(q.id), yoResp = E.otro(q.por) === V.yo;
  const clave = s.hist.length;
  if (yoResp && !q.limite && V.pidioVer !== clave) { V.pidioVer = clave; act((x, t) => E.verPregunta(x, V.yo, t)); }
  const respondido = V.respondido === clave;
  const opts = q.orden.map((o, i) => {
    const gone = q.quita.includes(i);
    return `<button class="opt ${gone ? 'gone' : ''} ${respondido && V.eleccion === i ? 'pick' : ''}" data-a="resp" data-i="${i}" ${(!yoResp || gone || respondido) ? 'disabled' : ''}>${esc(c.o[o])}</button>`;
  }).join('');
  const r = E.otro(V.yo);
  setOv(`<div class="sheet d${c.d}">
    <div class="qhead"><span class="chip">${DN[c.d]} · ⚡${c.d} · ${esc(c.t)}</span><span class="timer" id="tm"></span></div>
    <div class="from">${yoResp ? `${nom(r)} te lanza esta pregunta:` : `Le lanzas esta pregunta a ${nom(r)}:`}</div>
    <div class="tbar"><i id="tb"></i></div>
    <div class="qtext">${esc(c.q)}</div>
    <div class="opts">${opts}</div>
    ${yoResp ? `<button class="fifty" data-a="comodin" ${s.comodin[V.yo] && !q.quita.length && !respondido ? '' : 'disabled'}>Comodín 50/50 (${s.comodin[V.yo] ? 1 : 0})</button>`
      : `<div class="think">${q.limite ? `${nom(r)} está pensando` : `Esperando a que ${nom(r)} la abra`} <span class="dots"><i></i><i></i><i></i></span></div>`}
  </div>`);
}

function mostrarEvento(e) {
  if (e.tipo === 'ronda') {
    const w = V.yo, r = E.otro(w), ult = V.cola.length === 1 && V.s.fase === 'fin';
    const h = e.gan === w ? '¡Ronda para ti!' : e.gan ? `Ronda para ${nom(r)}` : 'Empate';
    return setOv(`<div class="sheet"><div class="sum">
      <div class="rnd">RONDA ${e.n}</div><h2>${h}</h2>
      <div class="vs"><span style="color:var(--gold)">${e[w]}</span><span class="sep">TÚ · ${nom(r).toUpperCase()}</span><span>${e[r]}</span></div>
      <div class="from">Rondas ganadas: tú ${e.rondas?.[w] ?? 0} · ${nom(r)} ${e.rondas?.[r] ?? 0}</div>
    </div><button class="big" data-a="cont">${ult ? 'Ver resultado' : 'Siguiente ronda'}</button></div>`);
  }
  const c = E.carta(e.id), soy = e.r === V.yo, d = c.d;
  const opts = e.orden.map((o, i) => {
    let cl = 'opt';
    if (e.quita.includes(i)) cl += ' gone';
    if (o === 0) cl += ' ok'; else if (i === e.elige) cl += ' bad';
    if (i === e.elige) cl += ' pick';
    return `<button class="${cl}" disabled>${esc(c.o[o])}</button>`;
  }).join('');
  const r = nom(E.otro(V.yo));
  let msg;
  if (soy) msg = e.ok ? `¡Correcto! +${pts(d)} para ti` : e.elige < 0 ? `Se acabó el tiempo. +${pts(d)} para ${r}` : `Fallo. +${pts(d)} para ${r}`;
  else msg = e.ok ? `${r} acierta: +${pts(d)} para ${r}` : e.elige < 0 ? `A ${r} se le acabó el tiempo. +${pts(d)} para ti` : `¡${r} falla! +${pts(d)} para ti`;
  const bueno = soy === e.ok;
  setOv(`<div class="sheet d${d}">
    <div class="qhead"><span class="chip">${DN[d]} · ⚡${d} · ${esc(c.t)}</span></div>
    <div class="from">${soy ? 'Tu respuesta:' : `Respuesta de ${r}:`}</div>
    <div class="qtext">${esc(c.q)}</div>
    <div class="opts">${opts}</div>
    <div class="res ${bueno ? 'good' : 'badr'}">${msg}<div class="src">Fuente: ${esc(c.f)}</div></div>
    <button class="big" data-a="cont">Continuar</button></div>`);
}

function confirmarAbandono() {
  setOv(`<div class="sheet"><div class="sum"><h2>¿Abandonar?</h2><div class="from">La partida terminará y ${nom(E.otro(V.yo))} se llevará la victoria.</div></div>
    <button class="big" data-a="abandonar-si">Sí, abandonar</button><button class="ghost" data-a="abandonar-no">Seguir jugando</button></div>`);
}

function pintarFin() {
  cerrarOv();
  const s = V.s, w = V.yo, r = E.otro(w);
  const titulo = s.ganador === w ? '¡VICTORIA!' : s.ganador ? 'DERROTA' : 'EMPATE';
  const sub = s.abandono ? (s.abandono === w ? 'Has abandonado la partida' : `${nom(r)} ha abandonado`) : `contra ${nom(r)}`;
  const mias = s.hist.filter(h => h.r === w), suyas = s.hist.filter(h => h.r === r);
  const fallos = mias.filter(h => !h.ok);
  $app.innerHTML = `<div class="end">
    <h1>${titulo}</h1><div class="sub">${sub}</div>
    <div class="grid">
      <div class="box"><b>${s.rondas[w]} – ${s.rondas[r]}</b><span>Rondas</span></div>
      <div class="box"><b>${s.total[w]} – ${s.total[r]}</b><span>Puntos totales</span></div>
      <div class="box"><b>${mias.filter(h => h.ok).length}/${mias.length}</b><span>Tus aciertos</span></div>
      <div class="box"><b>${suyas.filter(h => h.ok).length}/${suyas.length}</b><span>Aciertos de ${nom(r)}</span></div>
    </div>
    <div class="rev"><h3>${fallos.length ? 'Para repasar' : mias.length ? 'Sin fallos, ¡bien!' : ''}</h3>
      ${fallos.map(h => { const c = E.carta(h.id); return `<div class="ri">${esc(c.q)}<div class="a">✓ ${esc(c.o[0])}</div><div class="src">${esc(c.f)}</div></div>`; }).join('')}
    </div>
    <button class="big" data-a="revancha">${V.modo === 'ia' ? 'Otra partida' : 'Revancha'}</button>
    <button class="ghost" data-a="volver">Volver</button>
  </div>`;
}

// Cuenta atrás y tiempo agotado
function tick() {
  if (pantalla !== 'juego' || !V?.s) return;
  const s = V.s;
  if (s.fase !== 'responder' || !s.q || V.cola.length) return;
  const tm = document.getElementById('tm'), tb = document.getElementById('tb');
  if (!s.q.limite) { if (tm) tm.textContent = ''; if (tb) tb.style.width = '100%'; return; }
  const rest = Math.max(0, s.q.limite - ahora());
  if (tm) tm.textContent = Math.ceil(rest / 1000);
  if (tb) tb.style.width = (rest / (E.TIEMPO * 10)) + '%';
  const clave = s.hist.length, yoResp = E.otro(s.q.por) === V.yo;
  if (rest <= 0 && yoResp && V.agotado !== clave && V.respondido !== clave) {
    V.agotado = clave; V.respondido = clave;
    act((x, t) => E.responder(x, V.yo, -1, t));
  }
  if (!yoResp && V.modo === 'online' && ahora() > s.q.limite + 4500 && V.reclamado !== clave) {
    V.reclamado = clave;
    act((x, t) => E.responder(x, V.yo, -1, t));
  }
}
setInterval(tick, 250);

// ---------- Eventos ----------
document.addEventListener('submit', e => {
  if (e.target.id === 'flogin') { e.preventDefault(); enviarLogin(e.target); }
});
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, id = t.dataset.id;
  switch (a) {
    case 'tab': return pantallaLogin(t.dataset.m);
    case 'olvido': return olvido();
    case 'practica': return abrirPractica();
    case 'reglas': return reglas();
    case 'cerrar': return pantalla === 'juego' ? (ovHtml = null, pintarJuego()) : cerrarOv();
    case 'menu': return menuLobby();
    case 'salir': cerrarOv(); return signOut(auth);
    case 'retar': return retar(t.dataset.uid);
    case 'aceptar': return update(ref(db, `duelo/partidas/${id}`), { estado: 'activa' }).then(() => abrirPartida(id)).catch(() => toast('Error de conexión'));
    case 'rechazar': return update(ref(db, `duelo/partidas/${id}`), { estado: 'rechazada' }).catch(() => toast('Error de conexión'));
    case 'cancelar': return cancelarReto(id);
    case 'borrar': return remove(ref(db, `duelo/misPartidas/${yo.uid}/${id}`));
    case 'abrir': return abrirPartida(id);
    case 'volver': return salirPartida();
  }
  if (!V?.s) return;
  const s = V.s;
  switch (a) {
    case 'carta': {
      const c = +t.dataset.c;
      if (s.fase !== 'elegir' || s.turno !== V.yo || s.pasa[V.yo]) return;
      V.sel = V.sel === c ? null : c; return pintarJuego();
    }
    case 'lanzar': { const c = V.sel; V.sel = null; return act((x, tt) => E.lanzar(x, V.yo, c, tt)); }
    case 'pasar': return act((x, tt) => E.pasar(x, V.yo, tt));
    case 'resp': {
      const i = +t.dataset.i, clave = s.hist.length;
      if (V.respondido === clave) return;
      V.respondido = clave; V.eleccion = i; ovHtml = null; mostrarPregunta();
      return act((x, tt) => E.responder(x, V.yo, i, tt));
    }
    case 'comodin': return act(x => E.comodin(x, V.yo));
    case 'cont': { const e = V.cola.shift(); if (e) guardarVisto(e.seq); ovHtml = null; pintarJuego(); return iaPaso(); }
    case 'abandonar': if (s.fase === 'fin') return; V.confirmar = true; return confirmarAbandono();
    case 'abandonar-no': V.confirmar = false; ovHtml = null; return pintarJuego();
    case 'abandonar-si': V.confirmar = false; ovHtml = null; return act((x, tt) => E.abandonar(x, V.yo, tt));
    case 'revancha': {
      if (V.modo === 'ia') return abrirPractica();
      const rival = V.rival; salirPartida(); return retar(rival);
    }
  }
});

App.addListener('backButton', () => {
  if (document.getElementById('ov') && !(pantalla === 'juego' && V?.s && (V.cola.length || V.s.fase === 'responder'))) {
    if (V?.confirmar) { V.confirmar = false; ovHtml = null; return pintarJuego(); }
    return cerrarOv();
  }
  if (pantalla === 'juego') return salirPartida();
  App.exitApp();
}).catch(() => {});
