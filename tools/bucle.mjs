#!/usr/bin/env node
/**
 * Convierte una pista generada en un bucle sin corte.
 *
 * Lyria arranca con una intro suave y termina con un fundido (y a veces
 * segundos de silencio) aunque el prompt pida lo contrario. Para que Foundry
 * la repita sin que se note:
 *
 *   1. busca el tramo estable: del primer al último momento en que el nivel
 *      (ventanas de 2 s) está cerca de la mediana de la pista;
 *   2. estima el pulso por autocorrelación de la envolvente de ataques y
 *      corta un múltiplo de 4 pulsos (un compás), así el empalme cae a tiempo
 *      en la música con ritmo; en un ambiente sin pulso no molesta;
 *   3. funde los últimos FUNDIDO segundos sobre los primeros: la pista
 *      resultante termina exactamente donde empieza.
 *
 * Uso: node tools/bucle.mjs assets/music/<id>.mp3 [...]   (reescribe en el lugar)
 * generar-musica.mjs lo aplica solo a cada pista nueva salvo `"bucle": false`.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SR = 11025;          // muestreo del análisis (no del resultado)
const FUNDIDO = 4;         // segundos de cola fundidos sobre la cabeza
const MARGEN_DB = 4;       // cuánto por debajo de la mediana sigue siendo «estable»

function leerPcm(ruta) {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", ruta, "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"],
    { maxBuffer: 1 << 28 });
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
}

/** dB RMS de la ventana [ini, ini + largo) en muestras. */
function db(m, ini, largo) {
  let s = 0;
  const fin = Math.min(m.length, ini + largo);
  for (let i = ini; i < fin; i++) s += m[i] * m[i];
  return 10 * Math.log10(s / Math.max(1, fin - ini) / (32768 * 32768) + 1e-12);
}

/** Período del pulso (s) y fase del primer ataque fuerte (s). */
function pulso(m) {
  const hop = Math.round(SR / 100); // 10 ms
  const energia = [];
  for (let i = 0; i + hop <= m.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += m[j] * m[j];
    energia.push(Math.log(s / hop + 1));
  }
  const ataque = energia.map((e, i) => (i ? Math.max(0, e - energia[i - 1]) : 0));
  const media = ataque.reduce((a, b) => a + b, 0) / ataque.length;
  const o = ataque.map(a => a - media);
  let mejor = { lag: 50, r: -Infinity };
  for (let lag = 40; lag <= 120; lag++) { // 0,4–1,2 s
    let r = 0;
    for (let i = 0; i + lag < o.length; i++) r += o[i] * o[i + lag];
    r /= o.length - lag;
    if (r > mejor.r) mejor = { lag, r };
  }
  let fase = { p: 0, s: -Infinity };
  for (let p = 0; p < mejor.lag; p++) {
    let s = 0;
    for (let i = p; i < o.length; i += mejor.lag) s += o[i];
    if (s > fase.s) fase = { p, s };
  }
  return { periodo: mejor.lag / 100, fase: fase.p / 100 };
}

export function hacerBucle(ruta, { log = console.log } = {}) {
  const m = leerPcm(ruta);
  const dur = m.length / SR;
  const v = 2 * SR, paso = Math.round(SR / 2);
  const niveles = [];
  for (let i = 0; i + v <= m.length; i += paso) niveles.push({ t: i / SR, db: db(m, i, v) });
  const mediana = [...niveles].sort((a, b) => a.db - b.db)[niveles.length >> 1].db;
  const estable = niveles.filter(n => n.db >= mediana - MARGEN_DB);
  const ini0 = estable[0].t, fin0 = estable.at(-1).t + 2;

  const { periodo, fase } = pulso(m);
  const compas = 4 * periodo;
  const ini = fase + Math.ceil((ini0 - fase) / periodo) * periodo;
  const compases = Math.floor((fin0 - ini - FUNDIDO) / compas);
  if (compases < 4) throw new Error(`${path.basename(ruta)}: tramo estable demasiado corto (${(fin0 - ini0).toFixed(1)} s)`);
  const largo = compases * compas;
  const fin = ini + largo + FUNDIDO;

  const tmp = `${ruta}.bucle.mp3`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", ruta, "-filter_complex",
    `[0:a]atrim=${(ini + FUNDIDO).toFixed(3)}:${fin.toFixed(3)},asetpts=PTS-STARTPTS[a];` +
    `[0:a]atrim=${ini.toFixed(3)}:${(ini + FUNDIDO).toFixed(3)},asetpts=PTS-STARTPTS[b];` +
    `[a][b]acrossfade=d=${FUNDIDO}:c1=tri:c2=tri[out]`,
    "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", tmp]);
  fs.renameSync(tmp, ruta);
  log(`  bucle ${path.basename(ruta)}: ${dur.toFixed(1)} s → ${largo.toFixed(1)} s ` +
    `(desde ${ini.toFixed(1)} s, ${compases} compases de ${compas.toFixed(2)} s, fundido ${FUNDIDO} s)`);
  return { ini, largo };
}

if (import.meta.filename === process.argv[1]) {
  const rutas = process.argv.slice(2);
  if (!rutas.length) { console.error("Uso: node tools/bucle.mjs <archivo.mp3> [...]"); process.exit(1); }
  for (const r of rutas) hacerBucle(r);
}
