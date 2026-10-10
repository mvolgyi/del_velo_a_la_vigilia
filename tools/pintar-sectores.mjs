#!/usr/bin/env node
/**
 * Pinta los sectores de calle (tools/sectores.mjs) con calidad de mapa
 * publicado, sin mover la geometría. Es pintar-planos.mjs adaptado a
 * exteriores nocturnos:
 *
 *   1. Esquema vectorial del sector (assets/mapas/sectores/<id>.esquema.webp,
 *      4000 × 3000, 50 px/m). Si falta, se genera con tools/sectores.mjs.
 *   2. Repintado con el modelo (arte.config.json → modelo), exigiendo que no
 *      mueva nada: azoteas, fachadas, bordillos, aceras, farolas.
 *   3. Corrección de deriva por perfiles de bordes (escala y desplazamiento
 *      por eje, como pintar-planos) y QC: anisotropía ≤ 3 %, superposición de
 *      perfiles ≥ 0.35, correlación 2D de bordes ≥ 0.30 y saturación media
 *      ≤ 15 % (MAPS_SPEC §5).
 *
 * Estilo (MAPS_SPEC): noche fría y desaturada, lluvia reciente, cenital
 * estricto, azoteas vistas desde arriba. El sodio naranja de las farolas
 * aparece SOLO como un tono tenue sobre el asfalto alrededor del poste, nunca
 * como halo ni charco de luz: la luz real es un AmbientLight de Foundry. Sin
 * coches (los vehículos son tiles), sin gente, sin texto, sin grid.
 *
 * Un sector puede llevar `exterior` en content/sectores.json: texto para el
 * modelo que describe el lugar (playa, puerto, cementerio) cuando el prompt
 * base de manzana urbana no alcanza.
 *
 * Uso: node tools/pintar-sectores.mjs [--solo <id>] [--forzar] [--referencia <id>]
 * Env: DVV_CONSERVAR_CRUDO=1 guarda el crudo del modelo (<id>.crudo.png)
 *
 * Sin --forzar no repinta un mapa que ya existe: cada repintado es una tirada.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { construirSector, cargarSectores } from "./sectores.mjs";

const RAIZ = path.resolve(import.meta.dirname, "..");
const DIR = path.join(RAIZ, "assets/mapas/sectores");
const CONFIG = JSON.parse(fs.readFileSync(path.join(RAIZ, "tools/arte.config.json"), "utf8"));
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const LIMITE_ANISOTROPIA = 3;
const CALIDAD_MINIMA = 0.35;
const CORRELACION_MINIMA = 0.30;
const SATURACION_MAXIMA = 15;
const INTENTOS = 3;

const argv = process.argv.slice(2);
const opcion = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const solo = opcion("--solo");
const forzar = argv.includes("--forzar");
const refCli = opcion("--referencia");

function leerClave() {
  if (process.env.GOOGE_AI_STUDIO_API_KEY) return process.env.GOOGE_AI_STUDIO_API_KEY;
  const env = path.join(RAIZ, ".env");
  if (!fs.existsSync(env)) return null;
  for (const l of fs.readFileSync(env, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?GOOGE_AI_STUDIO_API_KEY\s*=\s*(.*)$/.exec(l);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

/* -------------------------------------------- */
/*  Prompt                                      */
/* -------------------------------------------- */

/** Qué hay en el esquema, para que el modelo sepa qué representa cada forma. */
function contenido(S, geo) {
  const l = [];
  if (S.edificios.length) l.push("- The light grey flat shapes with an ink outline and a lighter rim are the FLAT ROOFTOPS (azoteas) of apartment and office blocks, seen from directly above: render them as weathered flat roof terraces — waterproofing membrane, tiles or gravel, a low parapet along the rim, the small boxes are air-conditioning units, water tanks, stair housings and skylights. Party walls between neighbouring buildings are thin ink lines. Never show a building's side wall or facade face.");
  if (S.edificios.some(e => ["church", "chapel", "house", "cathedral"].includes(e.tags.building)))
    l.push("- The brownish-grey hatched roofs are old clay-tile roofs, desaturated and dark with rain.");
  if (S.calles.some(c => c.sup === "asfalto")) l.push("- The dark bands are WET ASPHALT roads with a pale stone kerb on each edge; the dark ovals on them are rain puddles and the rectangles are asphalt patches. Keep the dashed centre line where it is drawn; no other road markings, no zebra crossings unless drawn.");
  l.push("- The light grey squared areas are pavements and plazas of small square concrete paving tiles (Málaga sidewalk tiles), damp from recent rain.");
  if (S.calles.some(c => c.sup === "losa") || S.plazas.length) l.push("- The light rectangular slabs in running bond are a pedestrian street paved with large polished stone slabs, slick and reflective with rain.");
  if (S.calles.some(c => c.sup === "senda")) l.push("- The narrow pale bands are footpaths.");
  if (S.calles.some(c => c.sup === "carril-bici")) l.push("- The narrow dark green-grey band is a painted cycle lane (no symbols or lettering).");
  if (S.verde.length) l.push("- The dark green areas are lawns and gardens; the round lumpy shapes are TREE CANOPIES seen from above (keep each one where it is, same size; slim ones are cypresses). Brown-grey bare ground is earth or a cemetery path.");
  if (S.verde.some(v => v.tags.leisure === "pitch")) l.push("- The large flat dark grey-green rectangles with no outline and no rooftop details are OUTDOOR SPORTS COURTS AND PITCHES at ground level (tennis, basketball, futsal, football), NOT buildings: render them as wet hard-court or artificial-turf surfaces with faint boundary lines, a low fence line along their edge at most; no rooftop equipment, no parapet, no goals, nets or hoops, no numbers or lettering.");
  if (S.playa.length) l.push("- The pale beige area is a sandy beach at night, damp and dark near the water line.");
  if (S.mar || S.aguas.length) l.push("- The very dark blue-grey area is WATER (sea or harbour basin): dark, with faint ripples; no boats.");
  if (S.muelles.length || S.puertoSuelo.length) l.push("- The concrete slabs with joints are a harbour quay; you may add iron bollards and a kerb along the water edge.");
  if (S.vias.length) l.push("- The striped bands are railway tracks with sleepers and ballast.");
  if (geo.luces.length) l.push("- The tiny dark round posts with a short arm on the pavements are UNLIT street-lamp posts: keep them exactly where they are as small objects seen from above.");
  if (geo.puertas.length) l.push("- The short pale strips against a few facades are door thresholds (steps) at the street entrance of a building: keep them; do NOT paint a door.");
  return l.join("\n");
}

function prompt(S, geo, conReferencia, sec = {}) {
  const e = CONFIG.estilos.battlemap;
  // `exterior` (content/sectores.json): qué lugar es, cuando el plano no basta
  // para que el modelo lo reconozca (playa, puerto, cementerio).
  const lugar = sec.exterior ? `\n\nTHE PLACE: ${sec.exterior}` : "";
  const cabecera = conReferencia
    ? `You are given TWO images.

IMAGE 1 is a surveyor's top-down plan of a city block in Málaga (Spain) at night. IMAGE 2 is a finished street battlemap from the same product line, provided ONLY as a rendering reference.

Your task: repaint IMAGE 1 as a finished night-time street battlemap, keeping IMAGE 1's layout exactly, and matching IMAGE 2's rendering (ink, palette, wetness, level of detail). Do NOT copy IMAGE 2's content or layout.`
    : `You are given ONE image: a surveyor's top-down plan of a city block in Málaga (Spain) at night. Repaint this top-down schematic of a Málaga city block at night without moving anything: render it as a finished night-time street battlemap.`;

  return `${cabecera}

ABSOLUTELY PRESERVE, to the pixel: the outline of every building and rooftop, every kerb line, the width and course of every street and pavement, every tree, every lamp post, every door threshold, the image dimensions and the framing. Treat the input as a surveyor's drawing you are rendering, not as inspiration. Do not add, remove, merge or move buildings. Do not add walls, fences, railings, bollards, planters, benches or kiosks that are not drawn. Do not shift, crop, zoom, rotate or re-frame anything.

WHAT THE SHAPES IN THE PLAN REPRESENT:
${contenido(S, geo)}${lugar}

NIGHT AND RAIN: it is late at night after recent rain. Everything is cold, desaturated blue-grey; the asphalt is black and glossy with puddles reflecting a dark sky; pavements are damp and darker at the joints. The only warm colour allowed is a FAINT sodium-orange TINT on the wet asphalt and pavement in a soft patch around each lamp post — a gentle colour cast only, low saturation, never a bright pool of light, never a halo, glow, bloom, lens flare or light cone. The lamps themselves are not lit.

NO VEHICLES: absolutely no cars, vans, motorbikes, bicycles, scooters or boats — vehicles are added later as separate tiles. Parking spaces stay empty.

NO PEOPLE: no pedestrians, figures, silhouettes, animals or bodies.

STRICT TOP-DOWN: a perfectly vertical bird's-eye view. Rooftops are seen flat from above; never show the facade, side wall or perspective of any building, tree trunk or lamp post.

NO TEXT OR PSEUDO-TEXT anywhere: no shop signs, street names, house numbers, road lettering, graffiti tags, logos or symbols. No grid lines, no compass, no border, no frame, no vignette: full bleed to all four edges.

${e.sufijo.replace(/^\n+/, "")}`;
}

/* -------------------------------------------- */
/*  Modelo                                      */
/* -------------------------------------------- */

function referenciaEstilo(id) {
  const ref = refCli ?? CONFIG.referenciaSectores ?? "huelin-plaza";
  if (!ref || ref === id) return null;
  const f = path.join(DIR, `${ref}.webp`);
  if (!fs.existsSync(f)) return null;
  return execFileSync("magick", [f, "-gravity", "center", "-crop", "1600x1200+0+0", "+repage", "-resize", "1100x", "-quality", "92", "jpg:-"], { maxBuffer: 1 << 26 }).toString("base64");
}

async function repintar(S, geo, esquemaPng, clave, sec) {
  const refB64 = referenciaEstilo(geo.id);
  const b64 = execFileSync("magick", [esquemaPng, "-quality", "94", "jpg:-"], { maxBuffer: 1 << 28 }).toString("base64");
  const partes = [{ text: prompt(S, geo, Boolean(refB64), sec) }, { inline_data: { mime_type: "image/jpeg", data: b64 } }];
  if (refB64) partes.push({ inline_data: { mime_type: "image/jpeg", data: refB64 } });
  const res = await fetch(`${ENDPOINT}/${CONFIG.modelo}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": clave, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: partes }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3", imageSize: "4K" } }
    })
  });
  const datos = await res.json();
  if (datos.error) {
    const err = new Error(`${datos.error.status}: ${datos.error.message}`);
    err.fatal = ["RESOURCE_EXHAUSTED", "PERMISSION_DENIED", "UNAUTHENTICATED", "INVALID_ARGUMENT", "NOT_FOUND"].includes(datos.error.status);
    throw err;
  }
  const parte = datos.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!parte) throw new Error(`sin imagen (${datos.candidates?.[0]?.finishReason})`);
  return { buffer: Buffer.from(parte.inlineData.data, "base64"), conReferencia: Boolean(refB64) };
}

/* -------------------------------------------- */
/*  Corrección de deriva (como pintar-planos)   */
/* -------------------------------------------- */

function grises(ruta, ancho) {
  const args = [ruta, "-colorspace", "gray"];
  if (ancho) args.push("-resize", `${ancho}x`);
  args.push("-blur", "0x1.5");
  const [w, h] = execFileSync("magick", [...args, "-format", "%w %h", "info:"], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
  const raw = execFileSync("magick", [...args, "-depth", "8", "gray:-"], { maxBuffer: 1 << 28 });
  return { w, h, px: raw };
}

function perfil({ w, h, px }, eje) {
  const n = eje === "x" ? w : h;
  const p = new Float64Array(n);
  if (eje === "x") {
    for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) p[x] += Math.abs(px[y * w + x + 1] - px[y * w + x - 1]);
  } else {
    for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) p[y] += Math.abs(px[(y + 1) * w + x] - px[(y - 1) * w + x]);
  }
  const r = Math.max(4, Math.round(n / 60)), out = new Float64Array(n), pre = new Float64Array(n + 1);
  let acc = 0;
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + p[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r), b = Math.min(n, i + r + 1);
    out[i] = Math.max(0, p[i] - (pre[b] - pre[a]) / (b - a));
    acc += out[i];
  }
  for (let i = 0; i < n; i++) out[i] /= acc || 1;
  return out;
}

function puntaje(P, Q, a, b, paso = 1) {
  let s = 0;
  for (let x = 0; x < P.length; x += paso) {
    if (!P[x]) continue;
    const u = a * x + b, i = Math.floor(u);
    if (i < 0 || i >= Q.length - 1) continue;
    const f = u - i;
    s += P[x] * (Q[i] * (1 - f) + Q[i + 1] * f);
  }
  return s;
}

function ajustarEje(P, Q, a0, b0) {
  let mejor = { a: a0, b: b0, s: -1 };
  const rangoB = Q.length * 0.06;
  for (let a = a0 * 0.95; a <= a0 * 1.05; a += a0 * 0.002) {
    for (let b = b0 - rangoB; b <= b0 + rangoB; b += 1.5) {
      const s = puntaje(P, Q, a, b, 2);
      if (s > mejor.s) mejor = { a, b, s };
    }
  }
  const g = { ...mejor };
  for (let a = g.a - a0 * 0.003; a <= g.a + a0 * 0.003; a += a0 * 0.0002) {
    for (let b = g.b - 3; b <= g.b + 3; b += 0.25) {
      const s = puntaje(P, Q, a, b, 1);
      if (s > mejor.s) mejor = { a, b, s };
    }
  }
  return mejor;
}

/** Correlación normalizada de los mapas de bordes (QC 2D, a 1000 px de ancho). */
function correlacionBordes(a, b) {
  const borde = ({ w, h, px }) => {
    const e = new Float64Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      e[i] = Math.abs(px[i + 1] - px[i - 1]) + Math.abs(px[i + w] - px[i - w]);
    }
    return e;
  };
  const A = borde(a), B = borde(b);
  const media = v => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = media(A), mb = media(B);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < A.length; i++) { const x = A[i] - ma, y = B[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db || 1);
}

function corregir(crudoPath, W, H, esquemaPath, destino, qc = {}) {
  const calidadMinima = qc.calidadMinima ?? CALIDAD_MINIMA;
  const correlacionMinima = qc.correlacionMinima ?? CORRELACION_MINIMA;
  const ref = grises(esquemaPath, 2000);
  const crudo = grises(crudoPath, 2000);
  const k = 2000 / W;                      // perfiles a 2000 px de ancho
  const a0 = (crudo.w / ref.w + crudo.h / ref.h) / 2;
  const x = ajustarEje(perfil(ref, "x"), perfil(crudo, "x"), a0, 0);
  const y = ajustarEje(perfil(ref, "y"), perfil(crudo, "y"), a0, 0);
  const anisotropia = Math.abs(x.a / y.a - 1) * 100;
  if (anisotropia > LIMITE_ANISOTROPIA) throw new Error(`anisotropía ${anisotropia.toFixed(1)}% (máx ${LIMITE_ANISOTROPIA}%)`);
  const calidad = Math.min(
    x.s / puntaje(perfil(ref, "x"), perfil(ref, "x"), 1, 0),
    y.s / puntaje(perfil(ref, "y"), perfil(ref, "y"), 1, 0));
  if (calidad < calidadMinima) throw new Error(`la manzana no coincide (calidad ${calidad.toFixed(2)})`);

  // (a·X + b) en px del crudo reducido a 2000 → px del crudo original.
  const escCrudo = execFileSync("magick", [crudoPath, "-format", "%w", "info:"], { encoding: "utf8" }).trim() / 2000;
  const esquinas = [[0, 0], [W, 0], [0, H], [W, H]].map(([X, Y]) =>
    `${((x.a * X * k + x.b) * escCrudo).toFixed(2)},${((y.a * Y * k + y.b) * escCrudo).toFixed(2)} ${X},${Y}`).join(" ");
  execFileSync("magick", [crudoPath, "-virtual-pixel", "edge", "-define", `distort:viewport=${W}x${H}+0+0`,
    "-distort", "Affine", esquinas, "+repage", "-quality", "88", destino], { stdio: "pipe" });

  const corr = correlacionBordes(grises(esquemaPath, 1000), grises(destino, 1000));
  if (corr < correlacionMinima) { fs.rmSync(destino, { force: true }); throw new Error(`bordes desalineados (correlación ${corr.toFixed(2)})`); }
  const [sat, lum] = execFileSync("magick", [destino, "-colorspace", "HSL", "-format", "%[fx:mean.g*100] %[fx:mean.b*100]", "info:"], { encoding: "utf8" }).trim().split(" ").map(Number);
  if (sat > SATURACION_MAXIMA) { fs.rmSync(destino, { force: true }); throw new Error(`saturación ${sat.toFixed(1)}% (máx ${SATURACION_MAXIMA}%)`); }
  return { anisotropia, calidad, corr, sat, lum };
}

/* -------------------------------------------- */

if (import.meta.filename === process.argv[1]) await main();

async function main() {
  const clave = leerClave();
  if (!clave) { console.error("Falta GOOGE_AI_STUDIO_API_KEY en .env"); process.exit(1); }
  const sectores = cargarSectores().filter(s => !solo || s.id === solo);
  if (!sectores.length) { console.error(solo ? `No encontré el sector "${solo}".` : "No hay sectores."); process.exit(1); }
  fs.mkdirSync(DIR, { recursive: true });
  let fallos = 0;

  for (const sec of sectores) {
    process.stdout.write(`  ${sec.id.padEnd(24)} … `);
    const destino = path.join(DIR, `${sec.id}.webp`);
    if (fs.existsSync(destino) && !forzar) { console.log("ya existe (usá --forzar)"); continue; }
    // La geometría se recalcula (sin tocar la imagen si el esquema ya existe).
    const esquemaWebp = path.join(DIR, `${sec.id}.esquema.webp`);
    const { geo, S } = construirSector(sec, { imagen: !fs.existsSync(esquemaWebp) });
    const esquema = path.join(DIR, `${sec.id}.esquema.png`);
    const crudo = path.join(DIR, `${sec.id}.crudo.png`);
    try {
      execFileSync("magick", [esquemaWebp, esquema], { stdio: "pipe" });
      let ultimo = null, listo = false;
      for (let intento = 1; intento <= INTENTOS && !listo; intento++) {
        try {
          const { buffer, conReferencia } = await repintar(S, geo, esquema, clave, sec);
          fs.writeFileSync(crudo, buffer);
          const q = corregir(crudo, geo.ancho, geo.alto, esquema, destino, sec.qc ?? {});
          const kb = Math.round(fs.statSync(destino).size / 1024);
          console.log(`✓ ${String(kb).padStart(5)} KB  anisotropía ${q.anisotropia.toFixed(2)}% · calidad ${q.calidad.toFixed(2)} · ` +
            `bordes ${q.corr.toFixed(2)} · sat ${q.sat.toFixed(1)} · lum ${q.lum.toFixed(1)}${conReferencia ? " · con referencia" : ""}` +
            (intento > 1 ? `  (intento ${intento})` : ""));
          listo = true;
        } catch (err) {
          ultimo = err;
          if (err.fatal) break;
          if (intento < INTENTOS) process.stdout.write(`↻ (${err.message}) `);
        }
      }
      if (!listo) throw ultimo;
    } catch (err) {
      console.log(`✗ ${err.message}`);
      fallos++;
      if (err.fatal) { console.error("Error de la API sin reintento posible; corto acá."); break; }
    } finally {
      fs.rmSync(esquema, { force: true });
      if (!process.env.DVV_CONSERVAR_CRUDO) fs.rmSync(crudo, { force: true });
    }
  }
  process.exit(fallos ? 1 : 0);
}
