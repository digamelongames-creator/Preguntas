// Informe de estudio de todos los usuarios de Mazos Oposición.
// Lo ejecuta GitHub Actions (.github/workflows/informe.yml) y guarda el resultado en la rama «informe».
// No copia contraseñas ni correos: los usuarios aparecen por el nombre que eligieron al registrarse.
"use strict";
const fs = require("fs");

const FB = (process.env.FIREBASE_URL || "https://curva-olvido-f89d1-default-rtdb.europe-west1.firebasedatabase.app").replace(/\/+$/, "") + "/mazosOposicion";
const AUTH = process.env.FIREBASE_SECRET ? "?auth=" + encodeURIComponent(process.env.FIREBASE_SECRET) : "";
const OUT = process.argv[2] || "salida";
const HTML = process.argv[3] || "index.html";

const ROOT = (process.env.FIREBASE_URL || "https://curva-olvido-f89d1-default-rtdb.europe-west1.firebasedatabase.app").replace(/\/+$/, "");
const get = async p => { const r = await fetch(FB + p + ".json" + AUTH); if (!r.ok) throw new Error(p + " HTTP " + r.status); return r.json(); };
const parseDoc = x => { try { return x && x.json ? JSON.parse(x.json) : null; } catch (e) { return null; } };

// Fechas igual que la app (hora de Madrid; TZ=Europe/Madrid en el workflow).
const BASE = new Date(2000, 0, 1).getTime();
const dayNum = ts => { const d = new Date(ts); return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - BASE) / 864e5); };
const dayTs = n => { const d = new Date(2000, 0, 1); d.setDate(d.getDate() + n); return d.getTime(); };
const dayStr = n => { const d = new Date(dayTs(n)); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const wday = n => new Date(dayTs(n)).getDay();
const laborable = n => wday(n) !== 0 && wday(n) !== 6;
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const fecha = n => { const d = new Date(dayTs(n)); return DIAS[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1); };
const pct = (a, b) => b ? Math.round(a * 100 / b) : null;
const P = v => v == null ? "—" : v + " %";
const hora = ts => ts ? new Date(ts).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }) : "nunca";

// Banco de preguntas: lo leo del propio index.html (mismo origen que la app).
// Las preguntas ya no están en index.html: se leen del banco de Firebase (oposinator/banco).
async function banco() {
  const h = fs.readFileSync(HTML, "utf8");
  const r = await fetch(ROOT + "/oposinator/banco/preguntas.json" + AUTH); const j = r.ok ? await r.json() : null; const BK = j ? JSON.parse(j) : { q: [], e: [] };
  const tag = id => (id === "qdata" ? BK.q : BK.e) || [];
  const nombres = {}; const m = h.match(/const NAMES=\{([\s\S]*?)\};/);
  if (m) for (const x of m[1].matchAll(/(\d+):"([^"]*)"/g)) nombres[x[1]] = x[2];
  const total = {}, texto = {};
  for (const q of tag("qdata")) { const n = parseInt(q.tema, 10); total[n] = (total[n] || 0) + 1; texto[q.id] = q.q; }
  for (const T of tag("edata")) { const n = +T.tema; if (!nombres[n] && T.nombre) nombres[n] = T.nombre;
    T.pags.forEach(pg => pg.qs.forEach((q, i) => { total[n] = (total[n] || 0) + 1; texto["e" + n + "p" + pg.p + "q" + i] = q.q; })); }
  return { total, texto, nombres };
}

function informeAdmin(B, srs, revlog, hoy) {
  const LOG = {}; for (const [ds, doc] of Object.entries(revlog || {})) { const v = parseDoc(doc); if (v && v.entries) LOG[ds] = v.entries; }
  const ST = {}; for (const [did, doc] of Object.entries(srs || {})) { const v = parseDoc(doc); ST[did] = (v && v.cards) || {}; }
  const num = did => parseInt(String(did).replace(/^t/, ""), 10);

  // Por día
  const dia = {};
  for (const [ds, es] of Object.entries(LOG)) { if (!es.length) continue;
    const r = { n: es.length, ok: 0, rep: 0, repOk: 0, nuevas: 0, min: 0 };
    for (const x of es) { if (x.e > 1) r.ok++; if (x.k === 1) { r.rep++; if (x.e > 1) r.repOk++; } if (x.k === 0) r.nuevas++; r.min += (x.ms || 0) / 60000; }
    r.min = Math.round(r.min); dia[ds] = r; }

  // Constancia: últimas 6 semanas (lunes a viernes)
  const semanas = [];
  const lunes = hoy - ((wday(hoy) + 6) % 7);
  for (let w = 0; w < 6; w++) { const l = lunes - 7 * w; let est = 0, lab = 0, n = 0, ok = 0, min = 0;
    for (let i = 0; i < 7; i++) { const d = l + i; if (d > hoy) continue; const r = dia[dayStr(d)];
      if (laborable(d)) lab++; if (r) { est++; n += r.n; ok += r.ok; min += r.min; } }
    semanas.push({ desde: dayStr(l), diasEstudiados: est, laborables: lab, respuestas: n, acierto: pct(ok, n), minutos: min }); }
  const sinEstudiar = []; for (let d = hoy - 1; d >= hoy - 28; d--) if (laborable(d) && !dia[dayStr(d)]) sinEstudiar.push(dayStr(d));
  let racha = 0; for (let d = hoy; d > hoy - 400; d--) { if (dia[dayStr(d)]) { racha++; continue; } if (d === hoy || !laborable(d)) continue; break; }

  // Por tema
  const temas = {}, fallos = {};
  const T = n => temas[n] || (temas[n] = { tema: n, nombre: B.nombres[n] || "Tema " + n, total: B.total[n] || 0, vistas: 0, atrasadas: 0, lapsos: 0, r30: 0, ok30: 0, rep30: 0, repOk30: 0, ultimo: null });
  for (const n of Object.keys(B.total)) T(+n);
  for (const [did, cards] of Object.entries(ST)) { const n = num(did); if (isNaN(n)) continue; const t = T(n);
    for (const s of Object.values(cards)) { if (!s || !s.ty || s.ty === "new") continue; t.vistas++; t.lapsos += s.lap || 0;
      if (s.ty === "review" ? s.due <= hoy : s.due < dayTs(hoy + 1)) t.atrasadas++; } }
  for (const [ds, es] of Object.entries(LOG)) { const d = strDay(ds);
    for (const x of es) { const n = num(x.d); if (isNaN(n)) continue; const t = T(n); if (!t.ultimo || x.t > t.ultimo) t.ultimo = x.t;
      if (x.e === 1) { const f = fallos[x.c] || (fallos[x.c] = { id: x.c, tema: n, fallos: 0, veces: 0 }); f.fallos++; }
      if (hoy - d < 30) { t.r30++; if (x.e > 1) t.ok30++; if (x.k === 1) { t.rep30++; if (x.e > 1) t.repOk30++; } } } }
  for (const es of Object.values(LOG)) for (const x of es) if (fallos[x.c]) fallos[x.c].veces++;
  const listaTemas = Object.values(temas).sort((a, b) => a.tema - b.tema).map(t => Object.assign(t, { acierto30: pct(t.ok30, t.r30), aciertoRepasos30: pct(t.repOk30, t.rep30), cobertura: pct(t.vistas, t.total) }));
  const masFalladas = Object.values(fallos).filter(f => f.fallos >= 2).sort((a, b) => b.fallos - a.fallos || a.veces - b.veces).slice(0, 20)
    .map(f => Object.assign(f, { pregunta: (B.texto[f.id] || "").slice(0, 110) }));

  const tot = listaTemas.reduce((a, t) => ({ total: a.total + t.total, vistas: a.vistas + t.vistas, atrasadas: a.atrasadas + t.atrasadas }), { total: 0, vistas: 0, atrasadas: 0 });
  const ult30 = Object.entries(dia).filter(([ds]) => hoy - strDay(ds) < 30).map(([, r]) => r);
  const s30 = ult30.reduce((a, r) => ({ n: a.n + r.n, ok: a.ok + r.ok, rep: a.rep + r.rep, repOk: a.repOk + r.repOk, min: a.min + r.min }), { n: 0, ok: 0, rep: 0, repOk: 0, min: 0 });
  const dias = Object.keys(dia).sort();
  return { primerDia: dias[0] || null, ultimoDia: dias[dias.length - 1] || null, diasEstudiados: dias.length, racha,
    totales: { preguntas: tot.total, vistas: tot.vistas, cobertura: pct(tot.vistas, tot.total), atrasadasHoy: tot.atrasadas },
    ult30: { dias: ult30.length, respuestas: s30.n, acierto: pct(s30.ok, s30.n), aciertoRepasos: pct(s30.repOk, s30.rep), minutos: s30.min },
    semanas, laborablesSinEstudiar28d: sinEstudiar.sort(), porDia: dia, temas: listaTemas, masFalladas };
}
function strDay(s) { const p = s.split("-").map(Number); return dayNum(new Date(p[0], p[1] - 1, p[2]).getTime()); }

function informeAmigo(u, acc, act, hoy, B) {
  const per = {}, devs = Object.values((act && act.dispositivos) || {});
  for (const [ds, ds_devs] of Object.entries((act && act.dias) || {})) { const r = { n: 0, ok: 0, min: 0, ent: 0, temas: {} };
    for (const v of Object.values(ds_devs || {})) { r.n += v.n || 0; r.ok += v.ok || 0; r.min += v.min || 0; r.ent += v.ent || 0;
      for (const [k, x] of Object.entries(v.temas || {})) { const q = r.temas[k] || (r.temas[k] = [0, 0]); q[0] += x[0]; q[1] += x[1]; } }
    per[ds] = r; }
  const suma = k => { let n = 0, ok = 0, min = 0, d = 0; for (let i = 0; i < k; i++) { const r = per[dayStr(hoy - i)]; if (r && r.n) { n += r.n; ok += r.ok; min += r.min; d++; } } return { dias: d, respuestas: n, acierto: pct(ok, n), minutos: min }; };
  let racha = 0; for (let d = hoy; d > hoy - 400; d--) { const r = per[dayStr(d)]; if (r && r.n) { racha++; continue; } if (d === hoy || !laborable(d)) continue; break; }
  const temas = {}; for (let i = 0; i < 30; i++) { const r = per[dayStr(hoy - i)]; if (!r) continue; for (const [k, x] of Object.entries(r.temas)) { const q = temas[k] || (temas[k] = [0, 0]); q[0] += x[0]; q[1] += x[1]; } }
  const asignados = acc.temas === "todos" ? "todos" : Array.isArray(acc.temas) ? acc.temas.length : acc.temas && typeof acc.temas === "object" ? Object.keys(acc.temas).length : 0;
  const hoyR = per[dayStr(hoy)] || { n: 0, ok: 0, min: 0 };
  return { usuario: u, activo: acc.activo !== false, temasAsignados: asignados, ultimoAcceso: act && act.ultimo ? hora(act.ultimo) : "nunca",
    hoy: { respuestas: hoyR.n, acierto: pct(hoyR.ok, hoyR.n), minutos: hoyR.min }, ult7: suma(7), ult30: suma(30), racha, dispositivos: devs.length,
    temas: Object.entries(temas).map(([k, v]) => ({ tema: +k || k, nombre: B.nombres[k] || "", respuestas: v[0], acierto: pct(v[1], v[0]) })).sort((a, b) => b.respuestas - a.respuestas) };
}

function markdown(R) {
  const L = [], A = R.admin;
  L.push("# Informe de estudio · Mazos Oposición", "", "Generado: " + R.generado + " (hora de Madrid)", "");
  if (A) {
    L.push("## Administrador (tu progreso)", "");
    L.push(`- Días con estudio: **${A.diasEstudiados}** (del ${A.primerDia} al ${A.ultimoDia}) · racha actual: **${A.racha}** días laborables`);
    L.push(`- Preguntas vistas: **${A.totales.vistas} de ${A.totales.preguntas}** (${P(A.totales.cobertura)}) · atrasadas hoy: **${A.totales.atrasadasHoy}**`);
    L.push(`- Últimos 30 días: ${A.ult30.dias} días, ${A.ult30.respuestas} respuestas, acierto ${P(A.ult30.acierto)} (en repasos ${P(A.ult30.aciertoRepasos)}), ${A.ult30.minutos} min`);
    L.push(`- Laborables sin estudiar (últimas 4 semanas): ${A.laborablesSinEstudiar28d.length ? A.laborablesSinEstudiar28d.map(d => fecha(strDay(d))).join(", ") : "ninguno"}`, "");
    L.push("### Semanas", "", "| Semana desde | Días (lab.) | Respuestas | Acierto | Minutos |", "|---|---|---|---|---|");
    for (const s of A.semanas) L.push(`| ${fecha(strDay(s.desde))} | ${s.diasEstudiados}/${s.laborables} | ${s.respuestas} | ${P(s.acierto)} | ${s.minutos} |`);
    L.push("", "### Días (últimos 30)", "", "| Día | Respuestas | Acierto | Acierto repasos | Nuevas | Minutos |", "|---|---|---|---|---|---|");
    for (const [ds, r] of Object.entries(A.porDia).sort((a, b) => b[0].localeCompare(a[0])).filter(([ds]) => R._hoy - strDay(ds) < 30))
      L.push(`| ${fecha(strDay(ds))} | ${r.n} | ${P(pct(r.ok, r.n))} | ${P(pct(r.repOk, r.rep))} | ${r.nuevas} | ${r.min} |`);
    L.push("", "### Temas", "", "| Tema | Vistas | Atrasadas | Resp. 30 d | Acierto 30 d | Acierto repasos 30 d | Fallos acumulados |", "|---|---|---|---|---|---|---|");
    for (const t of A.temas) L.push(`| T${t.tema} ${t.nombre} | ${t.vistas}/${t.total} | ${t.atrasadas} | ${t.r30} | ${P(t.acierto30)} | ${P(t.aciertoRepasos30)} | ${t.lapsos} |`);
    L.push("", "### Preguntas más falladas", "", "| Tema | Fallos / veces | Pregunta |", "|---|---|---|");
    for (const f of A.masFalladas) L.push(`| T${f.tema} | ${f.fallos}/${f.veces} | ${f.pregunta.replace(/\|/g, "/")} |`);
    L.push("");
  }
  L.push("## Amigos", "");
  if (!R.amigos.length) L.push("Sin usuarios.");
  else { L.push("| Usuario | Activo | Temas | Último acceso | Hoy | 7 días (días · resp. · acierto · min) | 30 días (días · resp. · acierto) | Racha | Disp. |", "|---|---|---|---|---|---|---|---|---|");
    for (const a of R.amigos) L.push(`| ${a.usuario} | ${a.activo ? "sí" : "no"} | ${a.temasAsignados} | ${a.ultimoAcceso} | ${a.hoy.respuestas} | ${a.ult7.dias} · ${a.ult7.respuestas} · ${P(a.ult7.acierto)} · ${a.ult7.minutos} | ${a.ult30.dias} · ${a.ult30.respuestas} · ${P(a.ult30.acierto)} | ${a.racha} | ${a.dispositivos}${a.dispositivos > 2 ? " ⚠️" : ""} |`);
    for (const a of R.amigos.filter(a => a.temas.length)) { L.push("", `### ${a.usuario} · temas (30 días)`, "", "| Tema | Respuestas | Acierto |", "|---|---|---|");
      for (const t of a.temas) L.push(`| T${t.tema} ${t.nombre} | ${t.respuestas} | ${P(t.acierto)} |`); } }
  return L.join("\n") + "\n";
}

(async () => {
  const B = await banco(), hoy = dayNum(Date.now());
  const [srs, revlog, accesos, actividad] = await Promise.all([get("/srs"), get("/revlog"), get("/cuentas/perfiles").catch(() => null), get("/cuentas/actividad").catch(() => null)]);
  const bloq = await get("/cuentas/bloqueados").catch(() => null) || {};
  const R = { generado: hora(Date.now()), _hoy: hoy, admin: null, amigos: [] };
  R.admin = informeAdmin(B, srs, revlog, hoy);
  for (const [u, p] of Object.entries(accesos || {}).sort((a, b) => String(a[1].nombre).localeCompare(String(b[1].nombre)))) {
    if (!p) continue;
    R.amigos.push(informeAmigo(p.nombre || u.slice(0, 6), { activo: bloq[u] !== true, temas: "todos" }, (actividad || {})[u], hoy, B));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const md = markdown(R); delete R._hoy;
  fs.writeFileSync(OUT + "/informe.md", md);
  fs.writeFileSync(OUT + "/informe.json", JSON.stringify(R, null, 1));
  console.log(md.slice(0, 3000));
})().catch(e => { console.error(e); process.exit(1); });
