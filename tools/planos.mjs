/**
 * Motor de planos vectoriales — Del Velo a la Vigilia.
 *
 * Adaptado del de La Cruzada Escarlata a una ambientación MODERNA (Málaga,
 * hoy): clínica biotecnológica, departamento alquilado, convento desconsagrado
 * y cripta medieval.
 *
 * Un interior se define en pies (habitaciones, vanos, muebles) y de ese único
 * archivo salen las dos cosas que Foundry necesita:
 *
 *   1. El mapa (esquema SVG rasterizado; después se repinta con el modelo).
 *   2. Los MUROS, PUERTAS y VIDRIOS, en coordenadas exactas.
 *
 * Así lo que se ve y lo que bloquea el paso son la misma geometría.
 *
 * Reglas duras (MAPS_SPEC.md §2): las puertas NUNCA se dibujan (vano vacío con
 * umbral tenue; la hoja la pone Foundry), no hay texto, no hay grid pintado, no
 * hay luz pintada, y los muebles MÓVILES no se pintan: quedan como nota para el
 * Narrador y se colocan como tiles.
 *
 * Convención: el eje de un vano es el del MURO que perfora. "h" = muro
 * horizontal (corre en X a Y constante), "v" = muro vertical.
 *
 * Tipos de vano:
 *   abierto        hueco libre (arco, paso sin hoja)
 *   puerta         muro con door=1 (Foundry dibuja y abre la hoja)
 *   secreta        muro con door=2; en el mapa se ve como pared maciza
 *   puerta-vidrio  puerta (door=1) que deja pasar la vista y la luz cerrada
 *   vidrio         paño de vidrio fijo: bloquea el paso, no la visión
 *                  (Foundry: move 20, sight 0, light 0, sound 20 — insonorizado)
 *   arcada         se expande en huecos abiertos separados por pilares
 */

export const PX_POR_PIE = 30;          // casilla de 5 pies = 150 px
export const PIES_POR_CASILLA = 5;
export const GRID_PX = PX_POR_PIE * PIES_POR_CASILLA;

const px = pies => Math.round(pies * PX_POR_PIE);

/* -------------------------------------------- */
/*  Aleatoriedad determinista                   */
/* -------------------------------------------- */

/**
 * Las variaciones (valor de cada baldosa, manchas, rayones) tienen que ser
 * IGUALES en cada build: si cambian, cada build produce un mapa distinto y el
 * diff del repo es ruido puro.
 */
function azar(semilla) {
  let s = 2166136261;
  for (let i = 0; i < semilla.length; i++) s = Math.imul(s ^ semilla.charCodeAt(i), 16777619) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* -------------------------------------------- */
/*  Normalización                               */
/* -------------------------------------------- */

/**
 * Expande los atajos del plano (arcadas) a vanos simples. Puro e idempotente:
 * todos los consumidores (render, muros, prompt) ven la misma planta.
 */
export function normalizar(plano) {
  if (plano._normalizado) return plano;
  const vanos = [];
  for (const v of plano.vanos ?? []) {
    if (v.tipo !== "arcada") { vanos.push(v); continue; }
    const paso = v.paso ?? 5, pilar = v.pilar ?? 1;
    for (let t = 0; t < v.w - 1e-9; t += paso) {
      const ini = t + pilar / 2, fin = Math.min(t + paso, v.w) - pilar / 2;
      if (fin - ini < 0.5) continue;
      vanos.push({ ...v, tipo: "abierto", x: v.eje === "h" ? v.x + ini : v.x,
        y: v.eje === "v" ? v.y + ini : v.y, w: fin - ini, _arcada: true });
    }
  }
  return { ...plano, vanos, _normalizado: true };
}

/** Un mueble es móvil si su tipo lo es por defecto, salvo que el plano diga `fijo`. */
const MOVILES = new Set(["silla", "sofa", "mesa", "camilla", "tubos", "lampara", "carro", "palet"]);
export const esMovil = m => (m.fijo === undefined ? MOVILES.has(m.tipo) : !m.fijo);

/** Los muebles que NO se pintan: van como tiles, y el Narrador los tiene que conocer. */
export function mueblesMoviles(plano) {
  return (plano.muebles ?? []).filter(esMovil);
}

/* -------------------------------------------- */
/*  Geometría de muros                          */
/* -------------------------------------------- */

/**
 * Une intervalos solapados o contiguos.
 * Dos habitaciones vecinas comparten pared: sin esto saldrían dos muros
 * encimados y las puertas quedarían perforando sólo uno de los dos.
 */
function unir(intervalos) {
  const orden = [...intervalos].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [ini, fin] of orden) {
    const ult = out[out.length - 1];
    if (ult && ini <= ult[1] + 1e-9) ult[1] = Math.max(ult[1], fin);
    else out.push([ini, fin]);
  }
  return out;
}

/** Resta huecos de un intervalo. Un vano no «tapa» el muro: lo parte en dos. */
function restar(intervalos, huecos) {
  let actual = intervalos;
  for (const [hi, hf] of huecos) {
    const siguiente = [];
    for (const [ini, fin] of actual) {
      if (hf <= ini || hi >= fin) { siguiente.push([ini, fin]); continue; }
      if (hi > ini) siguiente.push([ini, hi]);
      if (hf < fin) siguiente.push([hf, fin]);
    }
    actual = siguiente;
  }
  return actual.filter(([a, b]) => b - a > 1e-9);
}

const SONIDO_PUERTA = {
  clinica: "metal", departamento: "woodBasic", convento: "woodHeavy", cripta: "stoneBasic"
};
const ESTADO_PUERTA = { cerrada: 0, abierta: 1, trabada: 2 };   // CONST.WALL_DOOR_STATES

const coordsVano = v => v.eje === "h"
  ? [px(v.x), px(v.y), px(v.x + v.w), px(v.y)]
  : [px(v.x), px(v.y), px(v.x), px(v.y + v.w)];

/**
 * Deriva los muros a partir de las habitaciones y los vanos.
 *
 * Agrupa todas las aristas por recta (orientación + coordenada fija), une los
 * tramos de esa recta, y recién entonces resta los vanos. Hacerlo en ese orden
 * es lo que permite que un vano caiga sobre la pared compartida por dos
 * habitaciones y perfore las dos de una vez.
 *
 * Cada muro sale con `_tipo` ("muro" | "puerta" | "secreta" | "puerta-vidrio" |
 * "vidrio") para el renderer; construir-contenido lo quita antes de escribir.
 */
export function derivarMuros(planoCrudo) {
  const plano = normalizar(planoCrudo);
  const rectas = new Map();
  const clave = (eje, fija) => `${eje}:${fija}`;

  const agregar = (eje, fija, ini, fin) => {
    const k = clave(eje, fija);
    if (!rectas.has(k)) rectas.set(k, []);
    rectas.get(k).push([Math.min(ini, fin), Math.max(ini, fin)]);
  };

  for (const h of plano.habitaciones) {
    if (h.sinMuros) continue;
    agregar("h", h.y,       h.x, h.x + h.w);
    agregar("h", h.y + h.h, h.x, h.x + h.w);
    agregar("v", h.x,       h.y, h.y + h.h);
    agregar("v", h.x + h.w, h.y, h.y + h.h);
  }

  const huecos = new Map();
  for (const v of plano.vanos ?? []) {
    const fija = v.eje === "h" ? v.y : v.x;
    const ini = v.eje === "h" ? v.x : v.y;
    const k = clave(v.eje, fija);
    if (!huecos.has(k)) huecos.set(k, []);
    huecos.get(k).push([ini, ini + v.w]);
  }

  const muros = [];
  for (const [k, tramos] of rectas) {
    const [eje, fijaStr] = k.split(":");
    const fija = Number(fijaStr);
    for (const [ini, fin] of restar(unir(tramos), huecos.get(k) ?? [])) {
      muros.push(eje === "h"
        ? { c: [px(ini), px(fija), px(fin), px(fija)], _tipo: "muro" }
        : { c: [px(fija), px(ini), px(fija), px(fin)], _tipo: "muro" });
    }
  }

  // Las puertas son muros con door=1: Foundry dibuja la hoja y la abre al
  // clickearla. Por eso el mapa NO trae ninguna puerta pintada.
  const sonidoBase = SONIDO_PUERTA[plano.paleta] ?? "woodBasic";
  for (const v of plano.vanos ?? []) {
    const c = coordsVano(v);
    const ds = ESTADO_PUERTA[v.estado] ?? 0;
    switch (v.tipo) {
      case "puerta":
        muros.push({ c, door: 1, ds, doorSound: v.sonido ?? sonidoBase, _tipo: "puerta" });
        break;
      case "secreta":
        muros.push({ c, door: 2, ds, doorSound: v.sonido ?? "stoneBasic", _tipo: "secreta" });
        break;
      case "puerta-vidrio":
        // Cerrada se ve a través: la vista y la luz pasan, el paso no.
        muros.push({ c, door: 1, ds, doorSound: v.sonido ?? "slidingModern",
          sight: 0, light: 0, sound: 10, _tipo: "puerta-vidrio" });
        break;
      case "vidrio":
        // Vidrio grueso insonorizado: se ve todo, no se oye nada, no se pasa.
        muros.push({ c, move: 20, sight: 0, light: 0, sound: v.sonoro ? 10 : 20, _tipo: "vidrio" });
        break;
      default: break;   // abierto: solo hueco
    }
  }

  return muros;
}

/* -------------------------------------------- */
/*  Paletas                                     */
/* -------------------------------------------- */

/**
 * Cada paleta es la expresión vectorial del contrato de estilo de
 * tools/arte.config.json para un tipo de lugar. Ninguna lleva musgo: la
 * clínica y el departamento se ensucian con mugre urbana, el convento y la
 * cripta con humedad y salitre.
 *
 * `tono` es el tono ambiente uniforme de la escena (el rojo de emergencia en la
 * clínica a oscuras): un lavado parejo, NUNCA un charco ni un halo. Las luces
 * de emergencia reales las pone Foundry (tools/iluminacion.mjs).
 */
const PALETAS = {
  clinica: {
    fondo: "asfalto", exterior: "#3e4246", exteriorDetalle: "#2b2f33",
    muroEstilo: "revoque", muro: "#5c646c", muroSombra: "#141a20", tinta: "#111519",
    umbral: "#8a98a3", vidrio: "#a9c2cf", marco: "#3c464f",
    tinte: "#7f95a8", tinteK: 0.14, suciedad: "mugre", mugre: "#363c42",
    tono: "#6b1a16", tonoK: 0.05
  },
  departamento: {
    fondo: "edificio", exterior: "#3f3b35", exteriorDetalle: "#2e2b27",
    muroEstilo: "revoque", muro: "#6f6656", muroSombra: "#1e1a15", tinta: "#17140f",
    umbral: "#9a8a68", vidrio: "#b4c3c4", marco: "#4a4237",
    tinte: "#c9b27a", tinteK: 0.12, suciedad: "mugre", mugre: "#4a3f2f",
    tono: null, tonoK: 0
  },
  convento: {
    fondo: "empedrado", exterior: "#7b776d", exteriorDetalle: "#5d5a52",
    muroEstilo: "silleria", muro: "#9c9584", muroSombra: "#25221d", tinta: "#1b1916",
    umbral: "#a08d6a", vidrio: "#b4c3c4", marco: "#4a4237",
    tinte: "#a89a80", tinteK: 0.06, suciedad: "humedad", mugre: "#4f5458",
    tono: null, tonoK: 0
  },
  cripta: {
    fondo: "roca", exterior: "#1d1e1d", exteriorDetalle: "#121312",
    muroEstilo: "silleria", muro: "#5d5b55", muroSombra: "#0d0e0e", tinta: "#0e0f0f",
    umbral: "#6d6658", vidrio: "#8fa3ab", marco: "#2c2f30",
    tinte: "#40505a", tinteK: 0.22, suciedad: "humedad", mugre: "#2a3338",
    tono: "#0b1418", tonoK: 0.12
  }
};

/**
 * Materiales de piso. `lado` en pies: las juntas caen en divisores de la
 * casilla de 5 pies, que es como el piso «lee» el grid sin dibujarlo.
 */
const PISOS = {
  linoleo:  { base: "#b4babd", junta: "#8c9397", var: 0.05, lado: 2.5, rayones: true },
  baldosa:  { base: "#c6c8c3", junta: "#8a8e8b", var: 0.07, lado: 1.25 },
  azulejo:  { base: "#cdd5d7", junta: "#93a0a3", var: 0.05, lado: 1 },
  terrazo:  { base: "#a7a397", junta: "#77746b", var: 0.07, lado: 2.5, motas: true, rayones: true },
  moqueta:  { base: "#5b646d", junta: "#49515a", var: 0.05, lado: 2.5, moqueta: true },
  tecnico:  { base: "#a2a8ac", junta: "#6b7276", var: 0.04, lado: 2.5, perforado: true },
  hormigon: { base: "#8b8c88", junta: "#636460", var: 0.04, lado: 10, hormigon: true },
  parquet:  { base: "#8b7657", junta: "#4f4232", veta: "#6e5c42", tabla: 0.6 },
  piedra:   { base: "#999488", junta: "#5c5952", var: 0.18, lado: 2.5, losa: true },
  iglesia:  { base: "#bcb5a6", alterno: "#6e6962", junta: "#4f4b45", var: 0.06, lado: 2.5, damero: true },
  "piedra-humeda": { base: "#74756f", junta: "#3d3f3d", var: 0.22, lado: 2.5, losa: true, irregular: true },
  tierra:   { base: "#6b5d49", junta: "#55493a", tierra: true },
  grava:    { base: "#8f8a7e", junta: "#6f6a60", grava: true }
};

/* -------------------------------------------- */
/*  Utilidades de dibujo                        */
/* -------------------------------------------- */

/** Un borde con temblor: la línea recta perfecta es lo que delata al vector. */
function bordeTembloroso(x, y, w, h, r, amp = 2.2) {
  const p = [];
  const paso = 26;
  const punto = (px_, py_) => `${(px_ + (r() - 0.5) * amp).toFixed(1)},${(py_ + (r() - 0.5) * amp).toFixed(1)}`;
  for (let t = 0; t <= w; t += paso) p.push(punto(x + Math.min(t, w), y));
  for (let t = 0; t <= h; t += paso) p.push(punto(x + w, y + Math.min(t, h)));
  for (let t = 0; t <= w; t += paso) p.push(punto(x + w - Math.min(t, w), y + h));
  for (let t = 0; t <= h; t += paso) p.push(punto(x, y + h - Math.min(t, h)));
  return `M${p.join("L")}Z`;
}

const mezclar = (hex, hacia, k) => {
  const c = n => parseInt(hex.slice(1 + n * 2, 3 + n * 2), 16);
  const d = n => parseInt(hacia.slice(1 + n * 2, 3 + n * 2), 16);
  return "#" + [0, 1, 2].map(n => Math.round(c(n) + (d(n) - c(n)) * k)
    .toString(16).padStart(2, "0")).join("");
};
const variar = (hex, v) => mezclar(hex, v > 0 ? "#ffffff" : "#000000", Math.abs(v));

/** El material del piso, teñido por la paleta del lugar. */
function material(nombre, p) {
  const m = PISOS[nombre] ?? PISOS.linoleo;
  const t = c => (c && p.tinte ? mezclar(c, p.tinte, p.tinteK) : c);
  return { ...m, base: t(m.base), junta: t(m.junta), alterno: t(m.alterno), veta: t(m.veta) };
}

/* -------------------------------------------- */
/*  Pisos                                       */
/* -------------------------------------------- */

/** Losetas regulares (linóleo, baldosa, terrazo, moqueta, piso técnico, iglesia). */
function pisoLosetas(h, m, p, r) {
  const out = [];
  const lado = m.lado;
  let fila = 0;
  for (let y = h.y; y < h.y + h.h - 0.01; y += lado, fila++) {
    let col = 0;
    for (let x = h.x; x < h.x + h.w - 0.01; x += lado, col++) {
      const w = Math.min(lado, h.x + h.w - x), alto = Math.min(lado, h.y + h.h - y);
      const v = (r() - 0.5) * 2 * m.var;
      let base = m.base;
      if (m.damero && (fila + col) % 2) base = m.alterno;
      const relleno = variar(base, v);
      const d = m.losa
        ? bordeTembloroso(px(x), px(y), px(w), px(alto), r, m.irregular ? 4 : 2.6)
        : `M${px(x)},${px(y)}h${px(w)}v${px(alto)}h${-px(w)}Z`;
      out.push(`<path d="${d}" fill="${relleno}" stroke="${m.junta}" stroke-width="${m.losa ? 2 : 1.3}" stroke-linejoin="round"/>`);
      if (m.moqueta) {        // moqueta en losetas a cuarto de vuelta
        const vert = (fila + col) % 2 === 0;
        for (let k = 1; k < 6; k++) {
          const t = k / 6;
          out.push(vert
            ? `<line x1="${px(x) + px(w) * t}" y1="${px(y) + 3}" x2="${px(x) + px(w) * t}" y2="${px(y + alto) - 3}" stroke="${m.junta}" stroke-width="1" opacity="0.35"/>`
            : `<line x1="${px(x) + 3}" y1="${px(y) + px(alto) * t}" x2="${px(x + w) - 3}" y2="${px(y) + px(alto) * t}" stroke="${m.junta}" stroke-width="1" opacity="0.35"/>`);
        }
      }
      if (m.perforado && r() < 0.5) {   // placa de piso técnico ventilada
        for (let a = 1; a < 5; a++) for (let b = 1; b < 5; b++) {
          out.push(`<circle cx="${px(x) + px(w) * a / 5}" cy="${px(y) + px(alto) * b / 5}" r="1.6" fill="${m.junta}" opacity="0.7"/>`);
        }
      }
      if (m.motas) {
        for (let k = 0; k < 10; k++) {
          out.push(`<circle cx="${(px(x) + r() * px(w)).toFixed(1)}" cy="${(px(y) + r() * px(alto)).toFixed(1)}" r="${(0.8 + r() * 1.6).toFixed(1)}" fill="${r() < 0.5 ? m.junta : variar(m.base, 0.25)}" opacity="0.7"/>`);
        }
      }
      if (m.losa && r() < 0.1) {        // grieta
        const cx = px(x) + px(w) * 0.3, cy = px(y) + px(alto) * 0.4;
        out.push(`<path d="M${cx},${cy}l${px(w) * 0.4},${px(alto) * 0.25}" stroke="${m.junta}" stroke-width="1.6" fill="none" opacity="0.8"/>`);
      }
    }
  }
  if (m.rayones) {                       // marcas de ruedas y suelas
    for (let i = 0; i < Math.round(h.w * h.h * 0.04); i++) {
      const x = px(h.x + r() * h.w), y = px(h.y + r() * h.h);
      out.push(`<path d="M${x},${y}q${8 + r() * 14},${(r() - 0.5) * 10} ${16 + r() * 30},${(r() - 0.5) * 6}" ` +
        `stroke="${p.tinta}" stroke-width="1.2" fill="none" opacity="0.18"/>`);
    }
  }
  return out;
}

/** Hormigón: losa con juntas de dilatación anchas, manchas de aceite y de agua. */
function pisoHormigon(h, m, p, r) {
  const out = [`<rect x="${px(h.x)}" y="${px(h.y)}" width="${px(h.w)}" height="${px(h.h)}" fill="${m.base}"/>`];
  for (let i = 0; i < Math.round(h.w * h.h * 0.03); i++) {
    out.push(`<ellipse cx="${px(h.x + r() * h.w)}" cy="${px(h.y + r() * h.h)}" rx="${10 + r() * 40}" ry="${8 + r() * 26}" ` +
      `fill="${r() < 0.6 ? m.junta : variar(m.base, 0.12)}" opacity="${(0.12 + r() * 0.2).toFixed(2)}"/>`);
  }
  for (let x = h.x + m.lado; x < h.x + h.w - 0.01; x += m.lado) {
    out.push(`<line x1="${px(x)}" y1="${px(h.y)}" x2="${px(x)}" y2="${px(h.y + h.h)}" stroke="${m.junta}" stroke-width="2.2" opacity="0.8"/>`);
  }
  for (let y = h.y + m.lado; y < h.y + h.h - 0.01; y += m.lado) {
    out.push(`<line x1="${px(h.x)}" y1="${px(y)}" x2="${px(h.x + h.w)}" y2="${px(y)}" stroke="${m.junta}" stroke-width="2.2" opacity="0.8"/>`);
  }
  for (let i = 0; i < Math.round(h.w * h.h * 0.006); i++) {   // manchas de aceite
    out.push(`<ellipse cx="${px(h.x + 1 + r() * (h.w - 2))}" cy="${px(h.y + 1 + r() * (h.h - 2))}" rx="${12 + r() * 22}" ry="${9 + r() * 14}" fill="${p.tinta}" opacity="0.22"/>`);
  }
  return out;
}

/** Parquet gastado: tablitas angostas de largo variable, con veta. */
function pisoParquet(h, m, p, r) {
  const out = [];
  const ancho = m.tabla;
  for (let y = h.y; y < h.y + h.h - 0.01; y += ancho) {
    const alto = Math.min(ancho, h.y + h.h - y);
    let x = h.x - r() * 2;
    while (x < h.x + h.w - 0.01) {
      const ini = Math.max(x, h.x);
      const largo = Math.min(2 + r() * 3, h.x + h.w - ini);
      const v = (r() - 0.5) * 0.18;
      out.push(`<rect x="${px(ini)}" y="${px(y)}" width="${px(largo)}" height="${px(alto)}" ` +
        `fill="${variar(m.base, v)}" stroke="${m.junta}" stroke-width="1.2"/>`);
      if (r() < 0.5) {
        out.push(`<path d="M${px(ini) + 4},${px(y) + px(alto) / 2}q${px(largo) / 2},${(r() - 0.5) * 4} ${px(largo) - 8},0" ` +
          `stroke="${m.veta}" stroke-width="1" fill="none" opacity="0.6"/>`);
      }
      x = ini + largo;
    }
  }
  // Desgaste en el tránsito: zonas más claras y opacas.
  for (let i = 0; i < Math.round(h.w * h.h * 0.02); i++) {
    out.push(`<ellipse cx="${px(h.x + r() * h.w)}" cy="${px(h.y + r() * h.h)}" rx="${20 + r() * 40}" ry="${14 + r() * 24}" fill="${variar(m.base, 0.25)}" opacity="0.18"/>`);
  }
  return out;
}

/** Tierra o grava: suelo natural, sin retícula. */
function pisoNatural(h, m, p, r) {
  const out = [`<rect x="${px(h.x)}" y="${px(h.y)}" width="${px(h.w)}" height="${px(h.h)}" fill="${m.base}"/>`];
  const n = Math.round(h.w * h.h * (m.grava ? 2.2 : 0.5));
  for (let i = 0; i < n; i++) {
    const x = px(h.x + r() * h.w), y = px(h.y + r() * h.h);
    if (m.grava) {
      out.push(`<ellipse cx="${x}" cy="${y}" rx="${(1.5 + r() * 3).toFixed(1)}" ry="${(1.2 + r() * 2.2).toFixed(1)}" ` +
        `fill="${variar(m.base, (r() - 0.5) * 0.4)}" stroke="${m.junta}" stroke-width="0.8" opacity="0.9"/>`);
    } else {
      out.push(`<ellipse cx="${x}" cy="${y}" rx="${8 + r() * 26}" ry="${6 + r() * 16}" ` +
        `fill="${m.junta}" opacity="${(0.18 + r() * 0.25).toFixed(2)}"/>`);
    }
  }
  return out;
}

function piso(h, p, r) {
  const m = material(h.piso ?? "linoleo", p);
  if (m.tierra || m.grava) return pisoNatural(h, m, p, r);
  if (m.hormigon) return pisoHormigon(h, m, p, r);
  if (m.tabla) return pisoParquet(h, m, p, r);
  return pisoLosetas(h, m, p, r);
}

/* -------------------------------------------- */
/*  Exterior                                    */
/* -------------------------------------------- */

function exterior(plano, p, r, W, H) {
  const o = [`<rect width="${W}" height="${H}" fill="${p.exterior}"/>`];
  const area = plano.ancho * plano.alto;
  const fondo = plano.fondo ?? p.fondo;
  if (fondo === "asfalto") {
    for (let i = 0; i < Math.round(area * 1.4); i++) {         // árido
      o.push(`<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" r="${(0.8 + r() * 1.6).toFixed(1)}" fill="${r() < 0.5 ? p.exteriorDetalle : variar(p.exterior, 0.2)}" opacity="0.7"/>`);
    }
    for (let i = 0; i < Math.round(area * 0.02); i++) {        // charcos (calle mojada)
      o.push(`<ellipse cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" rx="${30 + r() * 80}" ry="${18 + r() * 40}" fill="#24292f" opacity="${(0.35 + r() * 0.25).toFixed(2)}"/>`);
    }
    for (let i = 0; i < Math.round(area * 0.01); i++) {        // grietas
      const x = r() * W, y = r() * H;
      o.push(`<path d="M${x.toFixed(0)},${y.toFixed(0)}l${(r() - 0.5) * 60},${(r() - 0.5) * 60}l${(r() - 0.5) * 40},${(r() - 0.5) * 40}" stroke="${p.tinta}" stroke-width="1.4" fill="none" opacity="0.5"/>`);
    }
  } else if (fondo === "edificio") {
    // El edificio vecino: macizo, rayado como corte de arquitectura.
    o.push(`<defs><pattern id="rayado" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<line x1="0" y1="0" x2="0" y2="18" stroke="${p.exteriorDetalle}" stroke-width="5"/></pattern></defs>`);
    o.push(`<rect width="${W}" height="${H}" fill="url(#rayado)" opacity="0.7"/>`);
  } else if (fondo === "empedrado") {
    const lado = 0.8;
    for (let y = 0; y < plano.alto; y += lado) {
      const desf = (Math.round(y / lado) % 2) * lado / 2;
      for (let x = -desf; x < plano.ancho; x += lado) {
        o.push(`<ellipse cx="${px(x + lado / 2)}" cy="${px(y + lado / 2)}" rx="${(px(lado) / 2 - 1.5).toFixed(1)}" ry="${(px(lado) / 2 - 2).toFixed(1)}" ` +
          `fill="${variar(p.exterior, (r() - 0.5) * 0.3)}" stroke="${p.exteriorDetalle}" stroke-width="1.4"/>`);
      }
    }
  } else if (fondo === "solar") {
    for (let i = 0; i < Math.round(area * 0.6); i++) {
      o.push(`<ellipse cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" rx="${6 + r() * 30}" ry="${5 + r() * 18}" fill="${r() < 0.6 ? p.exteriorDetalle : "#57503f"}" opacity="${(0.25 + r() * 0.3).toFixed(2)}"/>`);
    }
    for (let i = 0; i < Math.round(area * 0.3); i++) {
      o.push(`<ellipse cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" rx="${3 + r() * 5}" ry="${2 + r() * 4}" fill="#7d776a" stroke="${p.tinta}" stroke-width="1" opacity="0.7"/>`);
    }
  } else {   // roca
    for (let i = 0; i < Math.round(area * 0.08); i++) {
      o.push(`<ellipse cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" rx="${30 + r() * 70}" ry="${20 + r() * 50}" fill="${r() < 0.5 ? p.exteriorDetalle : variar(p.exterior, 0.08)}" opacity="0.6"/>`);
    }
    for (let i = 0; i < Math.round(area * 0.03); i++) {
      const x = r() * W, y = r() * H;
      o.push(`<path d="M${x.toFixed(0)},${y.toFixed(0)}l${(r() - 0.5) * 80},${(r() - 0.5) * 80}" stroke="#000000" stroke-width="2" opacity="0.5"/>`);
    }
  }
  return o;
}

/* -------------------------------------------- */
/*  Suciedad y detritos                         */
/* -------------------------------------------- */

/**
 * Lo que hace que un interior no se lea como diagrama. Moderno: mugre gris
 * contra los zócalos. Convento y cripta: humedad oscura y salitre blanco.
 * Nada de musgo.
 */
function suciedad(plano, p, r) {
  const out = [];
  const humedo = p.suciedad === "humedad";
  for (const h of plano.habitaciones) {
    if (h.sinMuros) continue;
    const bordes = [
      [h.x, h.y, h.w, 0], [h.x, h.y + h.h, h.w, 0],
      [h.x, h.y, 0, h.h], [h.x + h.w, h.y, 0, h.h]
    ];
    for (const [bx, by, bw, bh] of bordes) {
      const largo = bw || bh;
      const cuantos = Math.max(1, Math.round(largo / (humedo ? 6 : 9)));
      for (let i = 0; i < cuantos; i++) {
        if (r() > (humedo ? 0.7 : 0.5)) continue;
        const t = r() * largo;
        const cx = px(bx + (bw ? t : 0)), cy = px(by + (bh ? t : 0));
        const rx = (humedo ? 16 : 10) + r() * (humedo ? 50 : 30), ry = 8 + r() * (humedo ? 26 : 12);
        out.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" ` +
          `fill="${p.mugre}" opacity="${(humedo ? 0.3 : 0.16).toFixed(2)}"/>`);
        if (humedo && r() < 0.35) {            // salitre
          out.push(`<ellipse cx="${cx + (r() - 0.5) * 20}" cy="${cy + (r() - 0.5) * 20}" rx="${(6 + r() * 14).toFixed(0)}" ry="${(4 + r() * 8).toFixed(0)}" ` +
            `fill="#d9d6cc" opacity="0.16"/>`);
        }
      }
    }
  }
  return out;
}

function detritos(plano, p, r) {
  const out = [];
  const humedo = p.suciedad === "humedad";
  for (const h of plano.habitaciones) {
    const dens = h.limpio ? 0.03 : (humedo ? 0.16 : 0.07);
    for (let i = 0; i < Math.round(h.w * h.h * dens); i++) {
      const x = px(h.x + 0.4 + r() * (h.w - 0.8)), y = px(h.y + 0.4 + r() * (h.h - 0.8));
      const d = r();
      if (humedo) {
        if (d < 0.45) o(`<circle cx="${x}" cy="${y}" r="${(1.4 + r() * 2.4).toFixed(1)}" fill="${p.tinta}" opacity="0.32"/>`);
        else if (d < 0.75) o(`<ellipse cx="${x}" cy="${y}" rx="${(3 + r() * 4).toFixed(1)}" ry="${(2 + r() * 3).toFixed(1)}" fill="#8a867c" stroke="${p.tinta}" stroke-width="1" opacity="0.7"/>`);
        else o(`<ellipse cx="${x}" cy="${y}" rx="${(10 + r() * 24).toFixed(0)}" ry="${(6 + r() * 14).toFixed(0)}" fill="${p.mugre}" opacity="0.22"/>`);
      } else {
        if (d < 0.35) o(`<circle cx="${x}" cy="${y}" r="${(1 + r() * 1.6).toFixed(1)}" fill="${p.tinta}" opacity="0.25"/>`);
        else if (d < 0.6) {         // papel, envoltorio, colilla
          const w = 4 + r() * 7, hh = 3 + r() * 5;
          o(`<rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" transform="rotate(${(r() * 90).toFixed(0)} ${x} ${y})" fill="#d8d6cf" stroke="${p.tinta}" stroke-width="0.8" opacity="0.55"/>`);
        } else o(`<ellipse cx="${x}" cy="${y}" rx="${(6 + r() * 16).toFixed(0)}" ry="${(4 + r() * 9).toFixed(0)}" fill="${p.mugre}" opacity="0.13"/>`);
      }
    }
  }
  return out;
  function o(s) { out.push(s); }
}

/* -------------------------------------------- */
/*  Muebles                                     */
/* -------------------------------------------- */

/**
 * Sólo los FIJOS llegan acá (camillas médicas ancladas, racks, mostradores,
 * altar, relicario…). Los móviles van como tiles: ver mueblesMoviles().
 *
 * Convención de cabecera: `m.cabecera` = "n" | "s" | "e" | "o" (lado donde va
 * la almohada / el monitor). Por defecto, el lado corto de la izquierda o de
 * arriba.
 */
function mueble(m, p, r) {
  const x = px(m.x), y = px(m.y), w = px(m.w), h = px(m.h);
  const tinta = `stroke="${p.tinta}" stroke-width="2.6" stroke-linejoin="round"`;
  const fina = `stroke="${p.tinta}" stroke-width="1.5"`;
  const caja = (cx, cy, cw, ch, fill, rx = 3, extra = tinta) =>
    `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="${rx}" fill="${fill}" ${extra}/>`;
  const horizontal = w >= h;
  const cab = m.cabecera ?? (horizontal ? "o" : "n");

  /** Rectángulo de la cabecera de una cama/camilla, de profundidad `prof` px. */
  const cabecera = (prof, margen = 5) => {
    switch (cab) {
      case "e": return [x + w - prof - margen, y + margen, prof, h - margen * 2];
      case "s": return [x + margen, y + h - prof - margen, w - margen * 2, prof];
      case "n": return [x + margen, y + margen, w - margen * 2, prof];
      default:  return [x + margen, y + margen, prof, h - margen * 2];
    }
  };

  switch (m.tipo) {
    case "camilla-medica":
    case "camilla": {
      const piezas = [caja(x, y, w, h, "#8f989e", 4)];
      piezas.push(caja(x + 5, y + 5, w - 10, h - 10, "#b9c9c6", 3, fina));           // sábana
      const [ax, ay, aw, ah] = cabecera(px(1.3), 8);
      piezas.push(caja(ax, ay, aw, ah, "#e3e6e1", 6, fina));                          // almohada
      // Barandas laterales
      if (horizontal) {
        piezas.push(`<line x1="${x + w * 0.3}" y1="${y + 2}" x2="${x + w * 0.75}" y2="${y + 2}" stroke="${p.tinta}" stroke-width="3"/>`);
        piezas.push(`<line x1="${x + w * 0.3}" y1="${y + h - 2}" x2="${x + w * 0.75}" y2="${y + h - 2}" stroke="${p.tinta}" stroke-width="3"/>`);
      } else {
        piezas.push(`<line x1="${x + 2}" y1="${y + h * 0.3}" x2="${x + 2}" y2="${y + h * 0.75}" stroke="${p.tinta}" stroke-width="3"/>`);
        piezas.push(`<line x1="${x + w - 2}" y1="${y + h * 0.3}" x2="${x + w - 2}" y2="${y + h * 0.75}" stroke="${p.tinta}" stroke-width="3"/>`);
      }
      // Pliegue de la sábana: lo que la hace leer como tela
      piezas.push(horizontal
        ? `<path d="M${x + w * 0.45},${y + 7}q6,${h / 2 - 7} 0,${h - 14}" stroke="#8fa19e" stroke-width="2" fill="none"/>`
        : `<path d="M${x + 7},${y + h * 0.45}q${w / 2 - 7},6 ${w - 14},0" stroke="#8fa19e" stroke-width="2" fill="none"/>`);
      return piezas.join("");
    }
    case "rack": {
      const piezas = [caja(x, y, w, h, "#2c3136", 2)];
      const n = Math.max(3, Math.round((horizontal ? w : h) / 14));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        piezas.push(horizontal
          ? `<line x1="${x + w * t}" y1="${y + 3}" x2="${x + w * t}" y2="${y + h - 3}" stroke="#4a5158" stroke-width="1.6"/>`
          : `<line x1="${x + 3}" y1="${y + h * t}" x2="${x + w - 3}" y2="${y + h * t}" stroke="#4a5158" stroke-width="1.6"/>`);
      }
      piezas.push(caja(x + 4, y + 4, w - 8, h - 8, "none", 1, `stroke="#5a636b" stroke-width="1.4"`));
      return piezas.join("");
    }
    case "escritorio": {
      const piezas = [caja(x, y, w, h, "#9aa1a6", 2)];
      piezas.push(caja(x + 4, y + 4, w - 8, h - 8, "#b2b8bb", 1, fina));
      // Monitor (pantalla apagada) y teclado, contra el borde de atrás
      const mw = Math.min(px(1.8), w * 0.4), mh = 7;
      const mx = x + w / 2 - mw / 2, my = (m.frente === "n") ? y + h - mh - 6 : y + 6;
      piezas.push(caja(mx, my, mw, mh, "#22272b", 1, fina));
      const ky = (m.frente === "n") ? my - 14 : my + mh + 6;
      piezas.push(caja(mx + mw * 0.15, ky, mw * 0.7, 6, "#5a6166", 1, `stroke="${p.tinta}" stroke-width="1"`));
      return piezas.join("");
    }
    case "silla":
      return caja(x, y, w, h, "#3d454c", 6) + caja(x + 3, y + 3, w - 6, h * 0.25, "#2b3237", 3, fina);
    case "cama": {
      const piezas = [caja(x, y, w, h, "#6c5a45", 3)];
      piezas.push(caja(x + 5, y + 5, w - 10, h - 10, "#c9c2ae", 3, fina));
      const [ax, ay, aw, ah] = cabecera(px(1.2), 8);
      piezas.push(caja(ax, ay, aw, ah, "#e1dccd", 6, fina));
      // Frazada a medio abrir
      piezas.push(horizontal
        ? caja(x + w * 0.45, y + 5, w * 0.55 - 5, h - 10, "#6d6f5a", 3, fina)
        : caja(x + 5, y + h * 0.45, w - 10, h * 0.55 - 5, "#6d6f5a", 3, fina));
      return piezas.join("");
    }
    case "sofa":
      return caja(x, y, w, h, "#5c5244", 6) + caja(x + 8, y + 10, w - 16, h - 14, "#706452", 4, fina);
    case "heladera": {
      const piezas = [caja(x, y, w, h, "#d4d6d1", 3)];
      piezas.push(caja(x + 4, y + 4, w - 8, h - 8, "#e2e3df", 2, fina));
      piezas.push(`<line x1="${x + 4}" y1="${y + h * 0.4}" x2="${x + w - 4}" y2="${y + h * 0.4}" stroke="${p.tinta}" stroke-width="1.5"/>`);
      return piezas.join("");
    }
    case "mesa":
      return caja(x, y, w, h, "#8a7556", 3) + caja(x + 5, y + 5, w - 10, h - 10, "#9b8665", 2, fina);
    case "estante": {
      const piezas = [caja(x, y, w, h, "#7b8288", 2)];
      // Lo que hay en los estantes: cajas, frascos, carpetas, de valores varios
      const largo = horizontal ? w : h;
      let t = 4;
      while (t < largo - 6) {
        const l = Math.min(6 + r() * 14, largo - 4 - t);
        const c = ["#a59a86", "#5f6870", "#c0c4bd", "#6e5f4a", "#8e9a9b"][Math.floor(r() * 5)];
        piezas.push(horizontal
          ? caja(x + t, y + 4, l, h - 8, c, 1, `stroke="${p.tinta}" stroke-width="1"`)
          : caja(x + 4, y + t, w - 8, l, c, 1, `stroke="${p.tinta}" stroke-width="1"`));
        t += l + 2;
      }
      return piezas.join("");
    }
    case "casillero": {    // lockers del vestuario
      const piezas = [caja(x, y, w, h, "#7c8890", 2)];
      const n = Math.max(2, Math.round((horizontal ? w : h) / 30));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        piezas.push(horizontal
          ? `<line x1="${x + w * t}" y1="${y + 2}" x2="${x + w * t}" y2="${y + h - 2}" stroke="${p.tinta}" stroke-width="1.6"/>`
          : `<line x1="${x + 2}" y1="${y + h * t}" x2="${x + w - 2}" y2="${y + h * t}" stroke="${p.tinta}" stroke-width="1.6"/>`);
      }
      return piezas.join("");
    }
    case "corcho": {
      // Panel de corcho contra la pared: fotos, recortes y el hilo rojo. Sin
      // texto: las fotos son rectángulos de valor, no imágenes legibles.
      const piezas = [caja(x, y, w, h, "#8f6f49", 1)];
      const pins = [];
      const n = Math.round((horizontal ? w : h) / 9);
      for (let i = 0; i < n; i++) {
        const fx = horizontal ? x + 3 + r() * (w - 12) : x + 2 + r() * (w - 8);
        const fy = horizontal ? y + 2 + r() * (h - 8) : y + 3 + r() * (h - 12);
        const c = ["#d8d4c8", "#bfb8a6", "#9aa3a8", "#e4e0d2"][Math.floor(r() * 4)];
        piezas.push(caja(fx, fy, horizontal ? 7 : Math.min(7, w - 4), horizontal ? Math.min(7, h - 4) : 7, c, 0, `stroke="${p.tinta}" stroke-width="0.8"`));
        pins.push([fx + 3, fy + 3]);
      }
      for (let i = 0; i + 1 < pins.length; i += 2) {
        const [a, b] = [pins[i], pins[(i + 3) % pins.length]];
        piezas.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#9e2a22" stroke-width="1.1" opacity="0.9"/>`);
      }
      return piezas.join("");
    }
    case "mostrador": {
      const piezas = [caja(x, y, w, h, "#4f585f", 3)];
      piezas.push(caja(x + 5, y + 5, w - 10, h - 10, "#c7ccce", 2, fina));
      // Pantalla apagada y bandeja
      piezas.push(caja(x + w * 0.35, y + h * 0.3, Math.min(px(1.6), w * 0.3), Math.min(8, h * 0.3), "#22272b", 1, fina));
      return piezas.join("");
    }
    case "lector":   // lector de tarjetas: una cajita junto al marco
      return caja(x, y, Math.max(w, 9), Math.max(h, 9), "#2a2f33", 1, fina) +
        `<rect x="${x + 3}" y="${y + 3}" width="3" height="3" fill="#6b1d1a"/>`;
    case "relicario": {
      const piezas = [caja(x, y, w, h, "#4a4741", 4)];
      piezas.push(caja(x + 7, y + 7, w - 14, h - 14, "#5d5a52", 3, `stroke="#8a7a4e" stroke-width="2.4"`));  // latón
      piezas.push(caja(x + 14, y + 14, w - 28, h - 28, "#3b3934", 2, fina));
      // Cruz grabada en la tapa
      const cx = x + w / 2, cy = y + h / 2;
      piezas.push(horizontal
        ? `<path d="M${x + w * 0.25},${cy}H${x + w * 0.75}M${x + w * 0.38},${cy - h * 0.18}V${cy + h * 0.18}" stroke="#8a7a4e" stroke-width="2.2" fill="none"/>`
        : `<path d="M${cx},${y + h * 0.25}V${y + h * 0.75}M${cx - w * 0.18},${y + h * 0.38}H${cx + w * 0.18}" stroke="#8a7a4e" stroke-width="2.2" fill="none"/>`);
      return piezas.join("");
    }
    case "nicho":
      return caja(x, y, w, h, "#24221f", 1) + caja(x + 4, y + 4, w - 8, h - 8, "#1a1917", 1, `stroke="none"`);
    case "altar":
      return caja(x, y, w, h, "#a39d90", 2) + caja(x + 6, y + 6, w - 12, h - 12, "#928c80", 1, fina);
    case "columna":
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#9a958a" ${tinta}/>` +
        `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 3.2}" ry="${h / 3.2}" fill="#8b8579"/>`;
    case "banco": {
      const piezas = [caja(x, y, w, h, "#6d5a42", 2)];
      const n = Math.max(2, Math.round((horizontal ? h : w) / 10));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        piezas.push(horizontal
          ? `<line x1="${x + 3}" y1="${y + h * t}" x2="${x + w - 3}" y2="${y + h * t}" stroke="#4a3c2b" stroke-width="1.4"/>`
          : `<line x1="${x + w * t}" y1="${y + 3}" x2="${x + w * t}" y2="${y + h - 3}" stroke="#4a3c2b" stroke-width="1.4"/>`);
      }
      piezas.push(horizontal
        ? caja(x, y, 6, h, "#5a4935", 1, fina) + caja(x + w - 6, y, 6, h, "#5a4935", 1, fina)
        : caja(x, y, w, 6, "#5a4935", 1, fina) + caja(x, y + h - 6, w, 6, "#5a4935", 1, fina));
      return piezas.join("");
    }
    case "pila":
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#9a958a" ${tinta}/>` +
        `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 3}" ry="${h / 3}" fill="#59646a"/>`;
    case "tubos": {
      // Vías: se dibujan sólo si el plano las declara fijas.
      const piezas = [];
      for (let i = 0; i < 3; i++) {
        piezas.push(`<path d="M${x},${y + h * (0.3 + i * 0.2)}C${x + w * 0.3},${y + h * (0.1 + r() * 0.8)} ${x + w * 0.7},${y + h * (0.1 + r() * 0.8)} ${x + w},${y + h / 2}" stroke="#b9b49f" stroke-width="2.4" fill="none" opacity="0.85"/>`);
      }
      return piezas.join("");
    }
    case "escalera": {
      // Peldaños que se oscurecen hacia donde baja (`hacia`), sin perspectiva.
      const hacia = m.hacia ?? (horizontal ? "e" : "s");
      const pasos = Math.max(4, Math.round((hacia === "e" || hacia === "o" ? w : h) / 15));
      const piezas = [caja(x, y, w, h, "#8b8579", 1)];
      for (let i = 0; i < pasos; i++) {
        const t = i / pasos;
        const fondo = (hacia === "s" || hacia === "e") ? (i + 1) / pasos : (pasos - i) / pasos;
        const fill = mezclar("#9a958a", "#1a1a1a", fondo * 0.75);
        piezas.push((hacia === "e" || hacia === "o")
          ? caja(x + w * t, y, w / pasos, h, fill, 0, fina)
          : caja(x, y + h * t, w, h / pasos, fill, 0, fina));
      }
      return piezas.join("");
    }
    case "trampilla":
      // Igual que una puerta: no se dibuja la hoja, sólo el marco en el piso.
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${p.tinta}" stroke-width="2" stroke-dasharray="8 6" opacity="0.6"/>`;
    case "inodoro":
      return caja(x, y, w, h * 0.35, "#d7dbd8", 2) +
        `<ellipse cx="${x + w / 2}" cy="${y + h * 0.65}" rx="${w / 2 - 1}" ry="${h * 0.33}" fill="#e2e5e2" ${tinta}/>`;
    case "lavabo":
      return caja(x, y, w, h, "#d7dbd8", 4) + `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 3}" ry="${h / 3}" fill="#b9c1c1" ${fina}/>`;
    case "ducha":
      return caja(x, y, w, h, "#c3ccce", 2) + `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="4" fill="#59646a"/>` +
        `<line x1="${x + 6}" y1="${y + 6}" x2="${x + w - 6}" y2="${y + h - 6}" stroke="#93a0a3" stroke-width="1.2"/>`;
    case "mesada": {       // mesada de cocina: bacha y anafe
      const piezas = [caja(x, y, w, h, "#b9b4a6", 2)];
      const L = horizontal ? w : h, A = horizontal ? h : w;
      const bacha = horizontal ? [x + L * 0.15, y + 5, L * 0.22, A - 10] : [x + 5, y + h * 0.15, A - 10, L * 0.22];
      if (m.bacha !== false) piezas.push(caja(...bacha, "#8e979a", 3, fina));
      for (let i = 0; i < (m.anafe === false ? 0 : 4); i++) {
        const a = 0.6 + (i % 2) * 0.17, b = 0.3 + Math.floor(i / 2) * 0.4;
        piezas.push(horizontal
          ? `<circle cx="${x + L * a}" cy="${y + A * b}" r="${Math.min(A * 0.17, 9)}" fill="#3a3d3f" ${fina}/>`
          : `<circle cx="${x + A * b}" cy="${y + L * a}" r="${Math.min(A * 0.17, 9)}" fill="#3a3d3f" ${fina}/>`);
      }
      return piezas.join("");
    }
    case "contenedor":
      return caja(x, y, w, h, "#4d5a4e", 2) + caja(x + 5, y + 5, w - 10, h - 10, "#56655a", 1, fina);
    case "maquina": {      // caldera / tablero eléctrico
      const piezas = [caja(x, y, w, h, "#6a6f70", 3)];
      piezas.push(`<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 3}" fill="#565b5c" ${fina}/>`);
      piezas.push(`<line x1="${x + w / 2}" y1="${y + 4}" x2="${x + w / 2}" y2="${y + h - 4}" stroke="${p.tinta}" stroke-width="1.2" opacity="0.6"/>`);
      return piezas.join("");
    }
    default:
      return caja(x, y, w, h, "#7f7a70", 3);
  }
}

/** Sombra proyectada abajo-derecha. Se dibujan todas antes que los objetos. */
function sombraMueble(m, p) {
  if (["trampilla", "nicho", "lector", "escalera"].includes(m.tipo)) return "";
  const x = px(m.x), y = px(m.y), w = px(m.w), h = px(m.h);
  const alto = ["rack", "estante", "casillero", "heladera", "maquina", "columna"].includes(m.tipo) ? 9 : 5;
  if (m.tipo === "columna" || m.tipo === "pila") {
    return `<ellipse cx="${x + w / 2 + alto}" cy="${y + h / 2 + alto}" rx="${w / 2}" ry="${h / 2}" fill="${p.muroSombra}" opacity="0.45"/>`;
  }
  return `<rect x="${x + alto}" y="${y + alto + 1}" width="${w}" height="${h}" rx="4" fill="${p.muroSombra}" opacity="0.42"/>`;
}

/* -------------------------------------------- */
/*  Render                                      */
/* -------------------------------------------- */

export function renderSvg(planoCrudo) {
  const plano = normalizar(planoCrudo);
  const p = PALETAS[plano.paleta] ?? PALETAS.clinica;
  const r = azar(plano.id);
  const W = px(plano.ancho), H = px(plano.alto);
  const o = [];

  o.push(`<defs>
    <filter id="grano" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
  </defs>`);

  o.push(...exterior(plano, p, r, W, H));

  for (const h of plano.habitaciones) o.push(...piso(h, p, r));
  o.push(...suciedad(plano, p, r));

  // Sombra interior contra los muros: oclusión ambiental, no luz.
  for (const h of plano.habitaciones) {
    if (h.sinMuros) continue;
    o.push(`<rect x="${px(h.x)}" y="${px(h.y)}" width="${px(h.w)}" height="${px(h.h)}" ` +
      `fill="none" stroke="${p.muroSombra}" stroke-width="18" opacity="0.2"/>`);
  }

  o.push(...detritos(plano, p, r));

  const fijos = (plano.muebles ?? []).filter(m => !esMovil(m));
  for (const m of fijos) o.push(sombraMueble(m, p));
  for (const m of fijos) o.push(mueble(m, p, r));

  // Muros: los mismos tramos que se le entregan a Foundry, así que lo que se ve
  // y lo que bloquea el paso son literalmente la misma geometría. Se dibujan
  // macizos los muros y las puertas secretas; las puertas normales y las de
  // vidrio dejan el vano, y los paños de vidrio se dibujan aparte.
  const g = Math.round(0.9 * PX_POR_PIE);
  const todos = derivarMuros(plano);
  const muros = todos.filter(m => m._tipo === "muro" || m._tipo === "secreta");

  for (const m of muros) {
    const [x1, y1, x2, y2] = m.c;
    o.push(`<line x1="${x1 + 6}" y1="${y1 + 7}" x2="${x2 + 6}" y2="${y2 + 7}" stroke="${p.muroSombra}" stroke-width="${g}" stroke-linecap="square" opacity="0.5"/>`);
  }

  for (const m of muros) {
    const [x1, y1, x2, y2] = m.c;
    const horizontal = y1 === y2;
    const largo = horizontal ? x2 - x1 : y2 - y1;
    if (p.muroEstilo === "revoque") {
      // Tabique revocado: una banda continua con canto de tinta, como corte
      // de arquitectura moderno. Los extremos se extienden medio espesor para
      // que las esquinas cierren.
      const bx = horizontal ? x1 - g / 2 : x1 - g / 2;
      const by = horizontal ? y1 - g / 2 : y1 - g / 2;
      const bw = horizontal ? largo + g : g;
      const bh = horizontal ? g : largo + g;
      o.push(`<path d="${bordeTembloroso(bx, by, bw, bh, r, 1.2)}" fill="${variar(p.muro, (r() - 0.5) * 0.08)}" ` +
        `stroke="${p.tinta}" stroke-width="2.6" stroke-linejoin="round"/>`);
      o.push(horizontal
        ? `<line x1="${bx + 3}" y1="${by + 5}" x2="${bx + bw - 3}" y2="${by + 5}" stroke="${variar(p.muro, 0.18)}" stroke-width="2" opacity="0.6"/>`
        : `<line x1="${bx + 5}" y1="${by + 3}" x2="${bx + 5}" y2="${by + bh - 3}" stroke="${variar(p.muro, 0.18)}" stroke-width="2" opacity="0.6"/>`);
    } else {
      // Sillería: bloque por bloque, cada uno con su tinta y su valor.
      let t = -g / 2;
      while (t < largo + g / 2 - 1) {
        const bloque = Math.min(38 + r() * 34, largo + g / 2 - t);
        const relleno = variar(p.muro, (r() - 0.5) * 0.26);
        const bx = horizontal ? x1 + t : x1 - g / 2;
        const by = horizontal ? y1 - g / 2 : y1 + t;
        const bw = horizontal ? bloque : g;
        const bh = horizontal ? g : bloque;
        o.push(`<path d="${bordeTembloroso(bx, by, bw, bh, r, 2.4)}" fill="${relleno}" ` +
          `stroke="${p.tinta}" stroke-width="2.6" stroke-linejoin="round"/>`);
        if (r() < 0.3) {
          o.push(`<path d="M${bx + bw * 0.25},${by + bh * 0.3}l${bw * 0.3},${bh * 0.25}" ` +
            `stroke="${p.muroSombra}" stroke-width="1.5" fill="none" opacity="0.7"/>`);
        }
        t += bloque;
      }
    }
  }

  // Paños de vidrio: perfil metálico fino con montantes cada 5 pies. Es
  // estructura (no una puerta): bloquea el paso, se ve a través.
  for (const m of todos.filter(m => m._tipo === "vidrio")) {
    const [x1, y1, x2, y2] = m.c;
    const horizontal = y1 === y2;
    const gv = Math.round(g * 0.42);
    const bx = horizontal ? x1 : x1 - gv / 2, by = horizontal ? y1 - gv / 2 : y1;
    const bw = horizontal ? x2 - x1 : gv, bh = horizontal ? gv : y2 - y1;
    o.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${p.vidrio}" opacity="0.85" stroke="${p.marco}" stroke-width="2"/>`);
    o.push(horizontal
      ? `<line x1="${bx}" y1="${y1}" x2="${bx + bw}" y2="${y1}" stroke="${mezclar(p.vidrio, "#ffffff", 0.4)}" stroke-width="1.4"/>`
      : `<line x1="${x1}" y1="${by}" x2="${x1}" y2="${by + bh}" stroke="${mezclar(p.vidrio, "#ffffff", 0.4)}" stroke-width="1.4"/>`);
    const largo = horizontal ? bw : bh;
    for (let t = 0; t <= largo + 0.5; t += GRID_PX) {
      const mx = horizontal ? bx + Math.min(t, largo) : x1, my = horizontal ? y1 : by + Math.min(t, largo);
      o.push(`<rect x="${mx - 5}" y="${my - 5}" width="10" height="10" fill="${p.marco}" stroke="${p.tinta}" stroke-width="1.4"/>`);
    }
  }

  // Umbral: marca discreta en el piso. La hoja de la puerta la dibuja Foundry.
  for (const v of plano.vanos ?? []) {
    if (v.tipo !== "puerta" && v.tipo !== "puerta-vidrio") continue;
    const [x1, y1, x2, y2] = coordsVano(v);
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${p.umbral}" stroke-width="${Math.round(g * 0.5)}" opacity="0.5"/>`);
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${p.tinta}" stroke-width="2" opacity="0.5" stroke-dasharray="7 9"/>`);
  }

  // Tono ambiente uniforme (p. ej. el rojo de emergencia): lavado parejo, sin
  // gradiente ni foco. La fuente de luz la pone Foundry.
  if (p.tono && p.tonoK) o.push(`<rect width="${W}" height="${H}" fill="${p.tono}" opacity="${p.tonoK}"/>`);

  // Grano, para que no se lea como vector limpio. Sin viñeta: a sangre.
  o.push(`<rect width="${W}" height="${H}" filter="url(#grano)" opacity="0.05"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${o.join("")}</svg>`;
}

/* -------------------------------------------- */
/*  Regiones de transición                      */
/* -------------------------------------------- */

/**
 * Las regiones de escalera/pasaje. El comportamiento `teleportToken` es nativo
 * de v14: parado sobre la región, el token aparece en la región gemela de la
 * otra escena. Es la transición limpia entre plantas o edificios, en vez de
 * dibujar dos lugares en la misma imagen.
 */
export function derivarRegiones(plano, idEstable, uuidDeRegion) {
  return (plano.regiones ?? []).map(rg => {
    const rid = idEstable(`region:${plano.id}:${rg.id}`);
    const [planoDestino, regionDestino] = rg.destino.split(":");
    return {
      _id: rid,
      name: rg.nombre,
      color: rg.color ?? "#b23030",
      shapes: [{
        type: "rectangle",
        x: px(rg.x), y: px(rg.y),
        width: px(rg.w), height: px(rg.h),
        rotation: 0, hole: false
      }],
      elevation: { bottom: null, top: null },
      behaviors: [{
        _id: idEstable(`comportamiento:${plano.id}:${rg.id}`),
        name: rg.nombre,
        type: "teleportToken",
        system: {
          destinations: [uuidDeRegion(planoDestino, regionDestino)],
          placement: "center",
          snap: true,
          choice: false
        },
        disabled: false,
        flags: {}
      }],
      visibility: 2,
      locked: false,
      flags: {}
    };
  });
}
