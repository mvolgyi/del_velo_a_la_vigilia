#!/usr/bin/env node
/**
 * content/ → packs-src/ (+ customEdges en module.json y lang/caminos-*.json)
 *
 * Toda la prosa y los datos del módulo viven en content/ como fuente única:
 *
 *   content/caminos.json   los tres caminos (poderes, reservas, mejoras)
 *   content/estados.json   estados (ítems condition) con sus modificadores
 *   content/arsenal.json   armas, equipo y sets por Credo
 *   content/pnjs.json      PNJs (actores spc)
 *   content/pjs.json       plantillas de cazador (actores hunter)
 *   content/reglas/*.md    journals de reglas
 *   content/cronica/*.md   journals de la crónica
 *   content/planos/*.json  planos de las escenas (mapa + muros + puertas + regiones + luces)
 *   content/escenas.json   escenas sueltas sin plano (opcional; mapas en assets/mapas)
 *
 * De ahí salen los documentos de compendio, con ids estables para que
 * reconstruir no rompa los @UUID ni duplique nada al reimportar.
 *
 * Marcadores propios sobre Markdown (crónica y reglas):
 *   @tirada{attributes.composure+attributes.resolve|2|Compostura + Resolución}  → botón de tirada
 *   ⚑{fe|+1|motivo}                                                             → botón que mueve una baliza
 *   @npc{marcos} / @npc{marcos|el vampiro}                                      → @UUID al actor del compendio
 *   @item{molotov|Molotov}                                                      → @UUID al ítem del Arsenal
 *   :::leer ... :::                                                             → recuadro de leer en voz alta
 *
 * Uso: node tools/construir-contenido.mjs [--verbose]
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { marked } from "marked";
import {
  RAIZ, MODULO, STATS, idEstable, slug, enlace, uuid,
  limpiarGenerados, escribirDoc, Carpetas, leerJson, archivosMd, separarFrontmatter
} from "./util.mjs";
import { cargarPlanos } from "./construir-planos.mjs";
import { derivarMuros, derivarRegiones, mueblesMoviles, GRID_PX, PX_POR_PIE } from "./planos.mjs";
import { lucesDePlano } from "./iluminacion.mjs";

const verbose = process.argv.includes("--verbose");
const avisos = [];
const log = (...a) => verbose && console.log(...a);

marked.use({ gfm: true });
const md2html = md => marked.parse(md, { async: false });

const existe = rel => fs.existsSync(path.join(RAIZ, rel));
const PACKS = ["reservas", "mejoras", "estados", "rasgos", "arsenal", "reglas", "cronica", "personajes", "escenas", "macros", "aventura"];
for (const p of PACKS) limpiarGenerados(path.join(RAIZ, "packs-src", p));

const ICONO_ITEM = "systems/wod5e/assets/icons/items/item-default.svg";
const flags = (origen, extra = {}) => ({ [MODULO]: { origen, ...extra } });

/* ========================================================================== */
/*  Los tres caminos                                                          */
/* ========================================================================== */

const CAMINOS = leerJson("content/caminos.json").caminos;
const edgeId = (camino, poder) => `dvv-${camino.prefijo}-${poder.id}`;
const poderesDe = camino => [camino.pasiva, ...camino.poderes].filter(Boolean);

/** Todos los ids de Facultad de un camino, para expandir selectores `dvv-<prefijo>`. */
const edgesDeCamino = Object.fromEntries(
  CAMINOS.map(c => [`dvv-${c.prefijo}`, poderesDe(c).map(p => `edges.${edgeId(c, p)}`)])
);

const ETIQUETA_CAMINO = { imbuido: "Imbuido", iluminado: "Iluminado", modificado: "Modificado", gen2: "Gen II" };

/** Ids estables de cada documento generado, para enlazar desde los journals. */
const ID = {
  reserva: (eid, i) => idEstable(`reserva:${eid}:${i}`),
  mejora: (eid, mid) => idEstable(`mejora:${eid}:${mid}`),
  estado: id => idEstable(`estado:${id}`),
  rasgo: id => idEstable(`rasgo:${id}`),
  arma: id => idEstable(`arma:${id}`),
  equipo: id => idEstable(`equipo:${id}`),
  actor: id => idEstable(`actor:${id}`),
  journal: id => idEstable(`journal:${id}`),
  pagina: (jid, i) => idEstable(`pagina:${jid}:${i}`),
  escena: id => idEstable(`escena:${id}`),
  macro: id => idEstable(`macro:${id}`)
};

function descripcionPoder(camino, poder) {
  const partes = [];
  if (poder.nombreOriginal || poder.emula) {
    partes.push(`<p><em>${poder.nombreOriginal || ""}${poder.emula ? ` · emula ${poder.emula}` : ""}</em></p>`);
  }
  partes.push(poder.intro || "");
  partes.push(`<p><strong>Sistema.</strong></p>${poder.sistema || ""}`);
  if (poder.precioPropio) partes.push(`<p><strong>El precio propio.</strong></p>${poder.precioPropio}`);
  if (poder.marca) partes.push(`<p><strong>La marca:</strong> ${poder.marca}</p>`);
  if (camino.activacion && !poder.gratis) {
    partes.push(`<p><em>Activación — ${camino.activacion.nombre}: incluí los dados de Desesperación de la Célula en la tirada.</em></p>`);
  }
  if (camino.id === "gen2") {
    partes.push("<p><em>Activación — exigir la carne: incluí los dados de Desesperación. Ocupa 2 Modificaciones contra el límite de Resistencia.</em></p>");
  }
  return partes.join("\n");
}

function construirCaminos() {
  const carpReservas = new Carpetas("reservas", "Item");
  const carpMejoras = new Carpetas("mejoras", "Item");
  const customEdges = [];
  const langEs = {};
  const langEn = {};
  let nReservas = 0, nMejoras = 0;

  for (const camino of CAMINOS) {
    const etiqueta = ETIQUETA_CAMINO[camino.id] ?? camino.nombre;
    for (const poder of poderesDe(camino)) {
      const eid = edgeId(camino, poder);
      customEdges.push({ id: eid, label: `DVV.Edges.${eid}` });
      langEs[eid] = `[${etiqueta}] ${poder.nombre}`;
      langEn[eid] = `[${etiqueta}] ${poder.nombre}${poder.nombreOriginal && !poder.nombreOriginal.startsWith("≈") ? ` (${poder.nombreOriginal})` : ""}`;

      // Reservas: una por tirada del poder.
      poder.reservas.forEach((reserva, i) => {
        const dif = reserva.dificultad > 0 ? ` (dif. ${reserva.dificultad})` : "";
        const dicepool = Object.fromEntries(reserva.dados.map((p, j) => [`d${j + 1}`, { path: p }]));
        const nota = reserva.nota ? `<p><em>${reserva.nota}.</em></p>` : "";
        escribirDoc("reservas", {
          _id: ID.reserva(eid, i),
          _key: `!items!${ID.reserva(eid, i)}`,
          name: `${poder.nombre} — ${reserva.nombre}${dif}`,
          type: "edgepool",
          img: ICONO_ITEM,
          folder: carpReservas.id(camino.nombre),
          sort: (camino.poderes.indexOf(poder) + 1) * 100 + i,
          system: {
            description: descripcionPoder(camino, poder) + nota,
            macroid: "",
            bonuses: [],
            dataItemId: "",
            source: { book: "Del Velo a la Vigilia", page: camino.nombre },
            edge: eid,
            dicepool
          },
          effects: [],
          ownership: { default: 0 },
          flags: flags("reserva", { poder: eid, camino: camino.id, dificultad: reserva.dificultad ?? 0, indice: i }),
          _stats: STATS
        });
        nReservas++;
      });

      // Mejoras: una por Beneficio.
      for (const mejora of poder.mejoras ?? []) {
        const sufijo = mejora.gasto && camino.gasto?.nombre ? ` (${camino.gasto.nombre})` : "";
        const mid = ID.mejora(eid, mejora.id);
        escribirDoc("mejoras", {
          _id: mid,
          _key: `!items!${mid}`,
          name: `${mejora.nombre}${sufijo}`,
          type: "perk",
          img: ICONO_ITEM,
          folder: carpMejoras.id(camino.nombre),
          sort: 0,
          system: {
            description: `<p><em>Mejora de ${poder.nombre}.</em></p>${mejora.texto}${mejora.gasto ? `<p><em>${camino.gasto?.nombre ?? "Gasto"}: además de incluir los dados de Desesperación, bajá la Desesperación de la Célula en 1.</em></p>` : ""}`,
            macroid: "",
            bonuses: [],
            dataItemId: "",
            source: { book: "Del Velo a la Vigilia", page: camino.nombre },
            edge: eid,
            selected: false
          },
          effects: [],
          ownership: { default: 0 },
          flags: flags("mejora", { poder: eid, camino: camino.id, mejora: mejora.id, gasto: !!mejora.gasto }),
          _stats: STATS
        });
        nMejoras++;
      }
    }

    // Defecto obligatorio del camino.
    if (camino.defecto) {
      const rid = ID.rasgo(camino.id);
      escribirDoc("rasgos", {
        _id: rid,
        _key: `!items!${rid}`,
        name: `${camino.defecto.nombre} (${camino.nombre})`,
        type: "feature",
        img: ICONO_ITEM,
        folder: null,
        sort: 0,
        system: {
          description: camino.defecto.texto,
          macroid: "",
          bonuses: [],
          dataItemId: "",
          source: { book: "Del Velo a la Vigilia", page: camino.nombre },
          uses: { current: 0, max: 0, enabled: false },
          points: 1,
          featuretype: "flaw"
        },
        effects: [],
        ownership: { default: 0 },
        flags: flags("rasgo", { camino: camino.id }),
        _stats: STATS
      });
    }
  }

  carpReservas.escribir();
  carpMejoras.escribir();

  // customEdges en module.json y etiquetas en lang/.
  const manifestPath = path.join(RAIZ, "module.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.flags ??= {};
  manifest.flags.wod5e ??= {};
  manifest.flags.wod5e.customEdges = customEdges;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(RAIZ, "lang/caminos-es.json"), JSON.stringify({ DVV: { Edges: langEs } }, null, 2) + "\n");
  fs.writeFileSync(path.join(RAIZ, "lang/caminos-en.json"), JSON.stringify({ DVV: { Edges: langEn } }, null, 2) + "\n");

  console.log(`caminos: ${customEdges.length} facultades, ${nReservas} reservas, ${nMejoras} mejoras`);
}

/* ========================================================================== */
/*  Estados                                                                   */
/* ========================================================================== */

function construirEstados() {
  if (!existe("content/estados.json")) return;
  const { estados } = leerJson("content/estados.json");
  const carpetas = new Carpetas("estados", "Item");
  const nombreCamino = Object.fromEntries(CAMINOS.map(c => [c.id, c.nombre]));

  for (const e of estados) {
    const bonuses = (e.bonuses ?? []).map(b => ({
      ...b,
      paths: b.paths.flatMap(p => edgesDeCamino[p] ?? [p])
    }));
    const id = ID.estado(e.id);
    escribirDoc("estados", {
      _id: id,
      _key: `!items!${id}`,
      name: e.nombre,
      type: "condition",
      img: e.icono ?? ICONO_ITEM,
      folder: carpetas.id(nombreCamino[e.camino] ?? "Otros"),
      sort: 0,
      system: {
        description: e.descripcion,
        macroid: "",
        bonuses,
        dataItemId: "",
        source: { book: "Del Velo a la Vigilia", page: nombreCamino[e.camino] ?? "" },
        suppressed: false,
        effects: {}
      },
      effects: [],
      ownership: { default: 0 },
      flags: flags("estado", { estado: e.id, camino: e.camino }),
      _stats: STATS
    });
  }
  carpetas.escribir();
  console.log(`estados: ${estados.length}`);
}

/* ========================================================================== */
/*  El Arsenal de la Vigilia                                                  */
/* ========================================================================== */

const ARSENAL = existe("content/arsenal.json") ? leerJson("content/arsenal.json") : null;
const NOMBRE_DADO = {
  "attributes.strength": "Fuerza", "attributes.dexterity": "Destreza", "attributes.stamina": "Resistencia",
  "attributes.charisma": "Carisma", "attributes.manipulation": "Manipulación", "attributes.composure": "Compostura",
  "attributes.intelligence": "Inteligencia", "attributes.wits": "Astucia", "attributes.resolve": "Resolución",
  "skills.athletics": "Atletismo", "skills.brawl": "Pelea", "skills.craft": "Artesanía", "skills.drive": "Conducir",
  "skills.firearms": "Armas de fuego", "skills.larceny": "Latrocinio", "skills.melee": "Cuerpo a cuerpo",
  "skills.stealth": "Sigilo", "skills.survival": "Supervivencia", "skills.animalken": "Trato con animales",
  "skills.etiquette": "Etiqueta", "skills.insight": "Empatía", "skills.intimidation": "Intimidación",
  "skills.leadership": "Liderazgo", "skills.performance": "Interpretación", "skills.persuasion": "Persuasión",
  "skills.streetwise": "Callejeo", "skills.subterfuge": "Subterfugio", "skills.academics": "Académicas",
  "skills.awareness": "Consciencia", "skills.finance": "Finanzas", "skills.investigation": "Investigación",
  "skills.medicine": "Medicina", "skills.occult": "Ocultismo", "skills.politics": "Política",
  "skills.science": "Ciencias", "skills.technology": "Tecnología"
};
const nombrarDados = dados => dados.map(d => NOMBRE_DADO[d] ?? d).join(" + ");

function descripcionArma(a) {
  const filas = [
    ["Reserva", nombrarDados(a.dados) + (a.dadosAlternativos?.length ? ` (o ${nombrarDados(a.dadosAlternativos)})` : "")],
    ["Daño", `+${a.dano}${a.agravado ? " agravado" : ""}`],
    ["Dif. / regla", a.dificultad || "—"],
    ["Ocultamiento", a.ocultamiento || "—"],
    ["Recursos", a.recursos || "—"]
  ];
  const tabla = `<table class="dvv-ficha"><tbody>${filas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</tbody></table>`;
  return `${tabla}${a.notas ? `<p>${a.notas}</p>` : ""}<p><em>Las armas comunes infligen daño superficial a vampiros y criaturas resistentes (y lo dividen a la mitad). Para agravado hace falta fuego, sol o equipamiento especial.</em></p>`;
}

function construirArsenal() {
  if (!ARSENAL) return;
  const carpetas = new Carpetas("arsenal", "Item");
  const CATEGORIA = { cuerpo: "Cuerpo a cuerpo e improvisadas", fuego: "Armas de fuego", especial: "Arsenal del cazador" };

  for (const a of ARSENAL.armas) {
    const id = ID.arma(a.id);
    escribirDoc("arsenal", {
      _id: id,
      _key: `!items!${id}`,
      name: a.nombre,
      type: "weapon",
      img: a.tipo === "ranged" ? "icons/weapons/guns/gun-pistol-brass.webp" : "icons/weapons/swords/sword-guard-steel-green.webp",
      folder: carpetas.id(CATEGORIA[a.categoria] ?? "Armas"),
      sort: 0,
      system: {
        description: descripcionArma(a),
        macroid: "",
        bonuses: [],
        dataItemId: "",
        source: { book: "Del Velo a la Vigilia", page: "El Arsenal de la Vigilia" },
        weaponType: a.tipo,
        weaponvalue: a.dano,
        uses: { current: 0, max: 0, enabled: false },
        quantity: 1,
        dicepool: Object.fromEntries(a.dados.map((p, j) => [`d${j + 1}`, { path: p }]))
      },
      effects: [],
      ownership: { default: 0 },
      flags: flags("arma", { arma: a.id, categoria: a.categoria, agravado: !!a.agravado }),
      _stats: STATS
    });
  }

  for (const e of ARSENAL.equipo) {
    const id = ID.equipo(e.id);
    const filas = [["Uso", e.uso], ["Daño", e.dano], ["Regla", e.regla], ["Recursos", e.recursos]].filter(([, v]) => v);
    escribirDoc("arsenal", {
      _id: id,
      _key: `!items!${id}`,
      name: e.nombre,
      type: "gear",
      img: "icons/containers/bags/pack-leather-black-brown.webp",
      folder: carpetas.id("Equipo y munición especial"),
      sort: 0,
      system: {
        description: `<table class="dvv-ficha"><tbody>${filas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</tbody></table>${e.descripcion ? `<p>${e.descripcion}</p>` : ""}`,
        macroid: "",
        bonuses: [],
        dataItemId: "",
        source: { book: "Del Velo a la Vigilia", page: "El Arsenal de la Vigilia" },
        uses: { current: 0, max: 0, enabled: false },
        quantity: 1,
        dicepool: {}
      },
      effects: [],
      ownership: { default: 0 },
      flags: flags("equipo", { equipo: e.id }),
      _stats: STATS
    });
  }
  carpetas.escribir();
  console.log(`arsenal: ${ARSENAL.armas.length} armas, ${ARSENAL.equipo.length} equipo, ${ARSENAL.sets.length} sets`);
}

/** UUID de un ítem del Arsenal por su id de contenido (arma o equipo). */
function uuidArsenal(id) {
  if (!ARSENAL) return null;
  if (ARSENAL.armas.some(a => a.id === id)) return uuid("arsenal", "Item", ID.arma(id));
  if (ARSENAL.equipo.some(e => e.id === id)) return uuid("arsenal", "Item", ID.equipo(id));
  return null;
}

/* ========================================================================== */
/*  Markdown → journals                                                       */
/* ========================================================================== */

const PNJS = existe("content/pnjs.json") ? leerJson("content/pnjs.json").pnjs : [];
const nombrePnj = Object.fromEntries(PNJS.map(p => [p.id, p.nombre]));

function expandirMarcadores(md, archivo) {
  // :::leer ... :::
  md = md.replace(/^:::leer\s*\n([\s\S]*?)\n:::\s*$/gm, (_, inner) =>
    `\n<section class="dvv-leer">${md2html(inner.trim())}</section>\n`);

  // @tirada{paths|dif|texto}
  md = md.replace(/@tirada\{([^}|]+)\|([^}|]*)\|([^}]+)\}/g, (_, paths, dif, texto) => {
    const valuePaths = paths.split("+").map(s => s.trim()).filter(Boolean).join(" ");
    const d = Number(dif) || 0;
    const t = texto.trim().replace(/"/g, "&quot;");
    return `<a class="dvv-tirada" data-dvv-tirada="${valuePaths}" data-dificultad="${d}" data-label="${t}"><i class="fa-solid fa-dice-d10"></i> ${texto.trim()}</a>`;
  });

  // ⚑{fe|+1|motivo}
  md = md.replace(/⚑\{(fe|metodo|carne)\|([+-]?\d+)\|([^}]+)\}/g, (_, baliza, delta, motivo) => {
    const d = Number(delta);
    const signo = d > 0 ? `+${d}` : `${d}`;
    const nombre = { fe: "Fe", metodo: "Método", carne: "Carne" }[baliza];
    const m = motivo.trim().replace(/"/g, "&quot;");
    return `<button type="button" class="dvv-baliza ${baliza}" data-dvv-baliza="${baliza}" data-delta="${d}" data-motivo="${m}"><span class="dvv-baliza-delta">${signo} ${nombre}</span><span class="dvv-baliza-motivo">${motivo.trim()}</span></button>`;
  });

  // @npc{id|texto}
  md = md.replace(/@npc\{([^}|]+)(?:\|([^}]+))?\}/g, (_, id, etiqueta) => {
    id = id.trim();
    if (!nombrePnj[id]) {
      avisos.push(`${archivo}: @npc{${id}} no existe en content/pnjs.json`);
      return etiqueta?.trim() ?? id;
    }
    return enlace("personajes", "Actor", ID.actor(id), etiqueta?.trim() || nombrePnj[id]);
  });

  // @item{id|texto}
  md = md.replace(/@item\{([^}|]+)(?:\|([^}]+))?\}/g, (_, id, etiqueta) => {
    id = id.trim();
    const u = uuidArsenal(id);
    if (!u) {
      avisos.push(`${archivo}: @item{${id}} no existe en content/arsenal.json`);
      return etiqueta?.trim() ?? id;
    }
    return `@UUID[${u}]{${etiqueta?.trim() || id}}`;
  });

  return md;
}

/** Una página por encabezado de nivel 2; lo anterior al primero es la introducción. */
function paginarMarkdown(cuerpo, nombreJournal) {
  const lineas = cuerpo.split("\n");
  const paginas = [];
  let actual = { nombre: null, lineas: [] };
  let enCodigo = false;
  for (const linea of lineas) {
    if (/^```/.test(linea)) enCodigo = !enCodigo;
    const h2 = !enCodigo && /^## (.+)$/.exec(linea);
    if (h2) {
      paginas.push(actual);
      actual = { nombre: h2[1].trim(), lineas: [] };
      continue;
    }
    actual.lineas.push(linea);
  }
  paginas.push(actual);

  return paginas
    .map(p => {
      let md = p.lineas.join("\n");
      // La introducción arranca con el H1 del documento: lo sacamos, el journal ya tiene nombre.
      md = md.replace(/^# .+\n?/m, "").trim();
      return { nombre: p.nombre ?? "Introducción", md };
    })
    .filter(p => p.md.length > 0 || p.nombre !== "Introducción");
}

/** Enlaces a reservas y mejoras debajo del encabezado de cada poder en los journals de reglas. */
const CAMINO_POR_JOURNAL = {
  "la-marca-de-los-heraldos": "imbuido",
  "la-ciencia-del-umbral": "iluminado",
  "la-carne-templada": "modificado",
  "injertos-de-segunda-generacion": "gen2"
};

function enlazarPoderes(html, caminoId) {
  const camino = CAMINOS.find(c => c.id === caminoId);
  if (!camino) return html;
  return html.replace(/<h([2-4])>([^<]+)<\/h\1>/g, (m, nivel, texto) => {
    const poder = poderesDe(camino).find(p => texto.trim().toLowerCase().includes(p.nombre.toLowerCase()));
    if (!poder) return m;
    const eid = edgeId(camino, poder);
    const reservas = poder.reservas.map((r, i) => enlace("reservas", "Item", ID.reserva(eid, i), r.nombre));
    const mejoras = (poder.mejoras ?? []).map(mj => enlace("mejoras", "Item", ID.mejora(eid, mj.id), mj.nombre));
    const partes = [];
    if (reservas.length) partes.push(`<strong>Reserva:</strong> ${reservas.join(" · ")}`);
    if (mejoras.length) partes.push(`<strong>Mejoras:</strong> ${mejoras.join(" · ")}`);
    return `${m}\n<p class="dvv-enlaces">${partes.join("<br>")}</p>`;
  });
}

function construirJournals(pack, carpetaRaiz) {
  const dir = path.join(RAIZ, "content", pack);
  const archivos = archivosMd(dir);
  if (!archivos.length) return;
  const carpetas = new Carpetas(pack, "JournalEntry");
  let n = 0;

  for (const archivo of archivos) {
    const rel = path.relative(RAIZ, archivo);
    const { meta, cuerpo } = separarFrontmatter(fs.readFileSync(archivo, "utf8"));
    const id = meta.id ?? slug(path.basename(archivo, ".md"));
    const nombre = meta.nombre ?? id;
    const jid = ID.journal(id);
    const caminoId = CAMINO_POR_JOURNAL[id];

    const paginas = paginarMarkdown(expandirMarcadores(cuerpo, rel), nombre).map((p, i) => {
      let html = md2html(p.md);
      if (caminoId) html = enlazarPoderes(html, caminoId);
      const pid = ID.pagina(jid, i);
      return {
        _id: pid,
        _key: `!journal.pages!${jid}.${pid}`,
        name: p.nombre,
        type: "text",
        title: { show: i > 0, level: 1 },
        text: { format: 1, content: html },
        sort: i * 100000,
        ownership: { default: -1 },
        flags: {}
      };
    });

    escribirDoc(pack, {
      _id: jid,
      _key: `!journal!${jid}`,
      name: nombre,
      folder: carpetas.id(meta.carpeta ?? carpetaRaiz),
      sort: Number(meta.orden ?? 0),
      ownership: { default: meta.jugadores === "si" ? 2 : 0 },
      flags: flags("journal", { archivo: rel }),
      pages: paginas,
      _stats: STATS
    });
    n++;
  }
  carpetas.escribir();
  console.log(`${pack}: ${n} journals`);
}

/* ========================================================================== */
/*  Personajes                                                                */
/* ========================================================================== */

const CAMPOS_CREDO = {
  underground: ["Clandestinos", "Sigilo y subterfugio en servicio de la Caza."],
  entrepreneurial: ["Emprendedores", "Construir, inventar, aumentar o reparar durante la Caza."],
  faithful: ["Fieles", "Cualquier conflicto directo (físico, social o mental) con lo sobrenatural durante la Caza."],
  inquisitive: ["Inquisitivos", "Obtener información durante la Caza: documentación, allanamiento de morada e interrogatorio."],
  martial: ["Marciales", "Conflicto físico durante la Caza (no necesita ser con la presa ni con lo sobrenatural)."]
};

function itemEmbebido(aid, iid, doc) {
  return { ...doc, _id: iid, _key: `!actors.items!${aid}.${iid}` };
}

function construirPersonajes() {
  const carpetas = new Carpetas("personajes", "Actor");
  let n = 0;

  for (const p of PNJS) {
    const aid = ID.actor(p.id);
    const hostil = ["vampire", "ghoul"].includes(p.spcType) || /maton|quimera/.test(p.id);
    escribirDoc("personajes", {
      _id: aid,
      _key: `!actors!${aid}`,
      name: p.nombre,
      type: "spc",
      img: "icons/svg/mystery-man.svg",
      folder: carpetas.id("PNJs"),
      sort: 0,
      prototypeToken: {
        name: p.nombre,
        actorLink: false,
        disposition: hostil ? -1 : 0,
        texture: { src: "icons/svg/mystery-man.svg" }
      },
      system: {
        spcType: p.spcType,
        headers: { concept: p.concepto ?? "" },
        standarddicepools: {
          physical: { value: p.estandar?.physical ?? 1 },
          social: { value: p.estandar?.social ?? 1 },
          mental: { value: p.estandar?.mental ?? 1 }
        },
        exceptionaldicepools: Object.fromEntries(Object.entries(p.excepcionales ?? {}).map(([k, v]) => [k, { value: v }])),
        health: { max: p.salud ?? 5, value: p.salud ?? 5, aggravated: 0, superficial: 0 },
        willpower: { max: p.voluntad ?? 5, value: p.voluntad ?? 5, aggravated: 0, superficial: 0 },
        power: { value: p.poder ?? 0 },
        generaldifficulty: { normal: p.dificultadGeneral?.normal ?? 0, strongest: p.dificultadGeneral?.fuerte ?? 0 },
        description: p.descripcion ?? "",
        biography: [p.poderes ? `<h3>Poderes</h3>${p.poderes}` : "", p.debilidades ? `<h3>Debilidades</h3>${p.debilidades}` : ""].join(""),
        privatenotes: p.notas ?? "",
        settings: { enableDisciplines: p.spcType === "vampire" || p.spcType === "ghoul" }
      },
      items: [],
      effects: [],
      ownership: { default: 0 },
      flags: flags("pnj", { pnj: p.id }),
      _stats: STATS
    });
    n++;
  }

  const PJS = existe("content/pjs.json") ? leerJson("content/pjs.json").pjs : [];
  const armasPorId = Object.fromEntries((ARSENAL?.armas ?? []).map(a => [a.id, a]));
  const equipoPorId = Object.fromEntries((ARSENAL?.equipo ?? []).map(e => [e.id, e]));

  for (const pj of PJS) {
    const aid = ID.actor(`pj:${pj.id}`);
    const items = [];
    const [credoNombre, campos] = CAMPOS_CREDO[pj.credo] ?? [pj.credoNombre ?? pj.credo, ""];

    items.push(itemEmbebido(aid, idEstable(`pj:${pj.id}:credo`), {
      name: credoNombre, type: "creed", img: ICONO_ITEM, sort: 0, effects: [], ownership: { default: 0 }, flags: {},
      system: { description: "", macroid: "", bonuses: [], dataItemId: "", source: { book: "", page: "" }, edges: "", drives: "", desperationFields: campos }
    }));
    if (pj.determinacion) {
      const [nombreDet, ...resto] = pj.determinacion.split(/[:.—]\s*/);
      items.push(itemEmbebido(aid, idEstable(`pj:${pj.id}:drive`), {
        name: nombreDet.trim(), type: "drive", img: ICONO_ITEM, sort: 0, effects: [], ownership: { default: 0 }, flags: {},
        system: { description: "", macroid: "", bonuses: [], dataItemId: "", source: { book: "", page: "" }, redemption: `<p>${resto.join(". ").trim()}</p>` }
      }));
    }

    // Set de armas del Credo, copiado como ítems embebidos.
    const set = ARSENAL?.sets.find(s => s.id === pj.setArsenal);
    for (const [i, itemId] of (set?.items ?? []).entries()) {
      const a = armasPorId[itemId];
      const e = equipoPorId[itemId];
      const iid = idEstable(`pj:${pj.id}:item:${itemId}:${i}`);
      if (a) {
        items.push(itemEmbebido(aid, iid, {
          name: a.nombre, type: "weapon", img: a.tipo === "ranged" ? "icons/weapons/guns/gun-pistol-brass.webp" : "icons/weapons/swords/sword-guard-steel-green.webp",
          sort: 0, effects: [], ownership: { default: 0 }, flags: flags("arma", { arma: a.id }),
          system: {
            description: descripcionArma(a), macroid: "", bonuses: [], dataItemId: "",
            source: { book: "Del Velo a la Vigilia", page: "El Arsenal de la Vigilia" },
            weaponType: a.tipo, weaponvalue: a.dano, uses: { current: 0, max: 0, enabled: false }, quantity: 1,
            dicepool: Object.fromEntries(a.dados.map((p, j) => [`d${j + 1}`, { path: p }]))
          }
        }));
      } else if (e) {
        items.push(itemEmbebido(aid, iid, {
          name: e.nombre, type: "gear", img: "icons/containers/bags/pack-leather-black-brown.webp",
          sort: 0, effects: [], ownership: { default: 0 }, flags: flags("equipo", { equipo: e.id }),
          system: {
            description: `<p>${e.regla ?? ""}</p>`, macroid: "", bonuses: [], dataItemId: "",
            source: { book: "Del Velo a la Vigilia", page: "El Arsenal de la Vigilia" },
            uses: { current: 0, max: 0, enabled: false }, quantity: 1, dicepool: {}
          }
        }));
      }
    }

    const resistencia = pj.atributos?.stamina ?? 1;
    escribirDoc("personajes", {
      _id: aid,
      _key: `!actors!${aid}`,
      name: pj.nombre,
      type: "hunter",
      img: "icons/svg/mystery-man.svg",
      folder: carpetas.id("Plantillas de cazador"),
      sort: 0,
      prototypeToken: { name: pj.nombre, actorLink: true, disposition: 1, texture: { src: "icons/svg/mystery-man.svg" } },
      system: {
        headers: {
          concept: pj.concepto ?? "",
          chronicle: "Del Velo a la Vigilia",
          ambition: pj.ambicion ?? "",
          desire: pj.deseo ?? "",
          touchstones: pj.piedraDeToque ? `<p>${pj.piedraDeToque}</p>` : "",
          creedfields: campos
        },
        attributes: Object.fromEntries(Object.entries(pj.atributos ?? {}).map(([k, v]) => [k, { value: v }])),
        skills: Object.fromEntries(Object.entries(pj.habilidades ?? {}).map(([k, v]) => [k, { value: v }])),
        health: { max: pj.salud ?? resistencia + 3, value: pj.salud ?? resistencia + 3, aggravated: 0, superficial: 0 },
        willpower: { max: pj.voluntad ?? 5, value: pj.voluntad ?? 5, aggravated: 0, superficial: 0 },
        bio: { history: pj.historia ?? "" },
        notes: [
          pj.especialidades?.length ? `<p><strong>Especialidades:</strong> ${pj.especialidades.join(", ")}</p>` : "",
          pj.ventajas?.length ? `<p><strong>Ventajas y Defectos sugeridos:</strong></p><ul>${pj.ventajas.map(v => `<li>${v}</li>`).join("")}</ul>` : "",
          set ? `<p><strong>Set del Arsenal:</strong> ${set.nombre}${set.equipoLibre?.length ? ` — sin ficha: ${set.equipoLibre.join(", ")}` : ""}</p>` : "",
          pj.caminoProbable ? `<p><strong>Camino probable según la crónica:</strong> ${pj.caminoProbable}</p>` : ""
        ].join("")
      },
      items,
      effects: [],
      ownership: { default: 0 },
      flags: flags("pj", { pj: pj.id, caminoProbable: pj.caminoProbable ?? "" }),
      _stats: STATS
    });
    n++;
  }

  carpetas.escribir();
  console.log(`personajes: ${n} actores`);
}

/* ========================================================================== */
/*  Escenas                                                                   */
/* ========================================================================== */

function dimensiones(rutaAbs) {
  try {
    const salida = execFileSync("magick", ["identify", "-format", "%w %h", rutaAbs], { encoding: "utf8" });
    const [w, h] = salida.trim().split(/\s+/).map(Number);
    return { w, h };
  } catch {
    const salida = execFileSync("python3", ["-c", `from PIL import Image; im=Image.open(${JSON.stringify(rutaAbs)}); print(im.size[0], im.size[1])`], { encoding: "utf8" });
    const [w, h] = salida.trim().split(/\s+/).map(Number);
    return { w, h };
  }
}

/** _key de los documentos embebidos: fvtt-cli los guarda como entradas propias. */
function conClaves(escena) {
  const sid = escena._id;
  for (const col of ["walls", "lights", "levels", "tokens", "notes", "sounds", "tiles", "drawings", "regions"]) {
    for (const d of escena[col] ?? []) {
      d._key = `!scenes.${col}!${sid}.${d._id}`;
      if (col === "regions") {
        for (const b of d.behaviors ?? []) b._key = `!scenes.regions.behaviors!${sid}.${d._id}.${b._id}`;
      }
    }
  }
  return escena;
}

/** Escena base, compartida por las dos fuentes (planos y escenas.json). */
function docEscena({ id, nombre, carpeta, orden, w, h, grid, gridAlpha, oscuridad, luzGlobal, fondo, walls, lights, regions, nota, extra = {} }) {
  const sid = ID.escena(id);
  return conClaves({
    _id: sid,
    _key: `!scenes!${sid}`,
    name: nombre,
    folder: carpeta,
    navigation: true,
    navOrder: orden ?? 0,
    width: w,
    height: h,
    padding: 0.25,
    grid: { type: 1, size: grid, style: "solidLines", thickness: 1, color: "#000000", alpha: gridAlpha, distance: 5, units: "ft" },
    tokenVision: true,
    fog: { exploration: true },
    environment: { darknessLevel: oscuridad, globalLight: { enabled: Boolean(luzGlobal) } },
    // En v14 el fondo vive en un Level embebido, no en la escena.
    levels: [{
      _id: idEstable(`nivel:${id}`),
      name: "Suelo",
      elevation: { bottom: 0, top: 20 },
      background: { src: `modules/${MODULO}/${fondo}`, color: "#000000" },
      sort: 0
    }],
    walls, lights, regions,
    tokens: [], notes: [], sounds: [], tiles: [], drawings: [],
    flags: flags("escena", { escena: id, nota: nota ?? "", ...extra }),
    _stats: STATS
  });
}

/**
 * Escenas desde content/planos/*.json (camino principal).
 *
 * Muros, puertas, vidrios, regiones de transición y luces salen del MISMO
 * archivo que el mapa (tools/planos.mjs, tools/iluminacion.mjs), así que lo
 * que se ve y lo que bloquea el paso no pueden desincronizarse. Si todavía no
 * hay mapa pintado, se usa el esquema como fondo provisional.
 */
function escenasDePlanos(carpetas) {
  const planos = cargarPlanos();
  const ids = new Set(planos.map(p => p.id));
  const uuidDeRegion = (idPlano, idRegion) =>
    `Scene.${ID.escena(idPlano)}.Region.${idEstable(`region:${idPlano}:${idRegion}`)}`;
  const resumen = [];

  for (const plano of planos) {
    const pintado = `assets/mapas/${plano.id}.webp`;
    const esquema = `assets/mapas/${plano.id}.esquema.webp`;
    let fondo = pintado;
    if (!existe(pintado)) {
      if (!existe(esquema)) {
        avisos.push(`plano ${plano.id}: no hay mapa ni esquema; corré npm run planos`);
        continue;
      }
      fondo = esquema;
      avisos.push(`plano ${plano.id}: sin mapa pintado, uso el esquema como fondo provisional (npm run pintar)`);
    }
    const W = plano.ancho * PX_POR_PIE, H = plano.alto * PX_POR_PIE;
    const { w, h } = dimensiones(path.join(RAIZ, fondo));
    if (w !== W || h !== H) avisos.push(`plano ${plano.id}: el fondo mide ${w}×${h} y el plano ${W}×${H}; se usa el del plano`);

    const walls = derivarMuros(plano).map(({ _tipo, ...m }, i) => ({ _id: idEstable(`muro:${plano.id}:${i}`), ...m }));
    const regions = derivarRegiones({
      ...plano,
      regiones: (plano.regiones ?? []).filter(rg => {
        const [destino, region] = rg.destino.split(":");
        const ok = ids.has(destino) && planos.find(p => p.id === destino).regiones?.some(r => r.id === region);
        if (!ok) avisos.push(`plano ${plano.id}: la región ${rg.id} apunta a ${rg.destino}, que no existe`);
        return ok;
      })
    }, idEstable, uuidDeRegion);
    const lights = lucesDePlano(plano, idEstable);
    const moviles = mueblesMoviles(plano);
    const nota = [plano.nota ?? "",
      moviles.length ? `Muebles móviles NO pintados (colocarlos como tiles): ${Object.entries(
        moviles.reduce((acc, m) => ({ ...acc, [m.tipo]: (acc[m.tipo] ?? 0) + 1 }), {})
      ).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(", ")}.` : ""
    ].filter(Boolean).join(" ");

    escribirDoc("escenas", docEscena({
      id: plano.id, nombre: plano.nombre, carpeta: carpetas.id("Somnia Biotech"), orden: plano.orden ?? 10,
      w: W, h: H, grid: GRID_PX, gridAlpha: 0, oscuridad: plano.oscuridad ?? 0.5, luzGlobal: plano.luzGlobal,
      fondo, walls, lights, regions, nota,
      extra: { origen: "escena", plano: plano.id, provisional: fondo === esquema }
    }));
    const puertas = walls.filter(m => m.door).length;
    resumen.push(`  ${plano.id.padEnd(22)} ${W}×${H}  ${walls.length - puertas} muros · ${puertas} puertas · ` +
      `${lights.length} luces · ${regions.length} regiones${fondo === esquema ? " · ESQUEMA" : ""}`);
  }
  if (verbose) for (const r of resumen) console.log(r);
  return resumen.length;
}

/** Camino viejo: content/escenas.json + content/muros/<id>.json, para mapas sin plano. */
function escenasDeJson(carpetas) {
  if (!existe("content/escenas.json")) return 0;
  const { escenas } = leerJson("content/escenas.json");
  let n = 0;
  for (const def of escenas) {
    const rel = `assets/mapas/${def.mapa}.webp`;
    if (!existe(rel)) {
      avisos.push(`escenas.json: el mapa ${rel} no existe`);
      continue;
    }
    const { w, h } = dimensiones(path.join(RAIZ, rel));
    const murosRel = `content/muros/${def.id}.json`;
    const walls = existe(murosRel) ? leerJson(murosRel).map((m, i) => ({ ...m, _id: idEstable(`muro:${def.id}:${i}`) })) : [];
    const lights = (def.luces ?? []).map((l, i) => ({
      _id: idEstable(`luz:${def.id}:${i}`),
      x: l.x, y: l.y, rotation: 0, elevation: 0, walls: true, vision: false, hidden: false,
      config: {
        dim: l.dim ?? 20, bright: l.bright ?? 5, angle: 360, color: l.color ?? null, alpha: l.alpha ?? 0.5,
        animation: { type: l.animacion ?? null, speed: 5, intensity: 5, reverse: false },
        coloration: 1, attenuation: 0.5, luminosity: 0.5, saturation: 0, contrast: 0, shadows: 0,
        darkness: { min: 0, max: 1 }, negative: false, priority: 0
      },
      flags: {}
    }));
    escribirDoc("escenas", docEscena({
      id: def.id, nombre: def.nombre, carpeta: carpetas.id(def.carpeta ?? "Somnia Biotech"), orden: def.orden,
      w, h, grid: def.grid ?? GRID_PX, gridAlpha: def.gridAlpha ?? 0.1, oscuridad: def.oscuridad ?? 0.6,
      luzGlobal: def.luzGlobal, fondo: rel, walls, lights, regions: [], nota: def.nota
    }));
    n++;
  }
  return n;
}

function construirEscenas() {
  const carpetas = new Carpetas("escenas", "Scene");
  const n = escenasDePlanos(carpetas) + escenasDeJson(carpetas);
  carpetas.escribir();
  console.log(`escenas: ${n}`);
}

/* ========================================================================== */
/*  Macros                                                                    */
/* ========================================================================== */

function construirMacros() {
  const api = `game.modules.get("${MODULO}").api`;
  const macros = [
    { id: "importar", nombre: "Somnia Biotech — Importar la crónica al mundo", icono: "icons/svg/down.svg", comando: `${api}.importarCronica();` },
    { id: "panel", nombre: "Somnia Biotech — Panel del Narrador", icono: "icons/svg/book.svg", comando: `${api}.abrirPanel();` },
    { id: "otorgar", nombre: "Las Tres Puertas — Otorgar camino", icono: "icons/svg/door-exit.svg", comando: `${api}.otorgarCamino();` },
    { id: "comprar", nombre: "Comprar poder (Borde / Artefacto / Modificación)", icono: "icons/svg/upgrade.svg", comando: `${api}.comprarPoder();` },
    { id: "mejora", nombre: "Comprar mejora", icono: "icons/svg/aura.svg", comando: `${api}.comprarMejora();` },
    { id: "quemar", nombre: "Quemar la Chispa / Sobrecarga / Desgarro", icono: "icons/svg/fire.svg", comando: `${api}.quemar();` },
    { id: "peligro", nombre: "Registrar +1 Peligro", icono: "icons/svg/hazard.svg", comando: `${api}.registrarPeligro();` },
    { id: "balizas", nombre: "Balizas Fe / Método / Carne", icono: "icons/svg/light.svg", comando: `${api}.ajustarBalizas();` },
    { id: "equipar", nombre: "Equipar set del Credo", icono: "icons/svg/item-bag.svg", comando: `${api}.equiparSet();` }
  ];
  for (const m of macros) {
    const id = ID.macro(m.id);
    escribirDoc("macros", {
      _id: id,
      _key: `!macros!${id}`,
      name: m.nombre,
      type: "script",
      scope: "global",
      img: m.icono,
      command: m.comando,
      folder: null,
      sort: 0,
      ownership: { default: 0 },
      flags: flags("macro", { macro: m.id }),
      _stats: STATS
    });
  }
  console.log(`macros: ${macros.length}`);
}

/* ========================================================================== */

construirCaminos();
construirEstados();
construirArsenal();
construirJournals("reglas", "Reglas");
construirJournals("cronica", "Crónica");
construirPersonajes();
construirEscenas();
construirMacros();

const cerrar = () => {
  for (const a of avisos) console.warn(`aviso: ${a}`);
  console.log(avisos.length ? `✓ contenido construido con ${avisos.length} aviso(s)` : "✓ contenido construido");
};

/* ========================================================================== */
/*  Aventura: todo al mundo en un click                                       */
/* ========================================================================== */

/**
 * Un documento Adventure que embebe escenas, actores, journals y macros ya
 * generados, con sus carpetas, para que el Narrador importe la crónica entera
 * desde el compendio (o desde el quickstart de Foundry 14) sin arrastrar nada.
 * Los ítems (reservas, mejoras, estados, arsenal) quedan en sus compendios:
 * se usan desde ahí.
 */
function construirAventura() {
  const AVENTURA_ID = idEstable("aventura:somnia-biotech");
  const leerPack = pack => {
    const dir = path.join(RAIZ, "packs-src", pack);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  };
  const sinKey = doc => {
    const { _key, ...resto } = doc;
    for (const campo of ["pages", "items", "effects"]) {
      if (Array.isArray(resto[campo])) resto[campo] = resto[campo].map(({ _key, ...h }) => h);
    }
    return resto;
  };
  const esCarpeta = d => d._key?.startsWith("!folders!");

  const raices = {};
  const raiz = tipo => {
    raices[tipo] ??= {
      _id: idEstable(`aventura:raiz:${tipo}`), name: "Del Velo a la Vigilia", type: tipo, folder: null,
      sorting: "m", sort: 0, color: "#5c1f1f", flags: flags("carpeta"), _stats: STATS
    };
    return raices[tipo];
  };

  const folders = [];
  const colgar = (docs, tipo) => {
    const carpetas = docs.filter(esCarpeta).map(sinKey);
    const resto = docs.filter(d => !esCarpeta(d)).map(sinKey);
    const r = raiz(tipo);
    for (const c of carpetas) folders.push({ ...c, folder: c.folder ?? r._id });
    for (const d of resto) d.folder ??= r._id;
    return resto;
  };

  const actors = colgar(leerPack("personajes"), "Actor");
  const journal = [...colgar(leerPack("cronica"), "JournalEntry"), ...colgar(leerPack("reglas"), "JournalEntry")];
  const scenes = colgar(leerPack("escenas"), "Scene");
  const macros = colgar(leerPack("macros"), "Macro");
  folders.unshift(...Object.values(raices));

  const portada = existe("assets/mapas/somnia-planta-nueva.webp") ? `modules/${MODULO}/assets/mapas/somnia-planta-nueva.webp` : "icons/svg/book.svg";
  escribirDoc("aventura", {
    _id: AVENTURA_ID,
    _key: `!adventures!${AVENTURA_ID}`,
    name: "Somnia Biotech — Del Velo a la Vigilia",
    img: portada,
    caption: "<p>La crónica completa, lista para dirigir.</p>",
    description: `<p>Importa al mundo <strong>${scenes.length} escenas</strong>, <strong>${actors.length} actores</strong> (PNJs y plantillas de cazador), <strong>${journal.length} journals</strong> (crónica y reglas caseras) y <strong>${macros.length} macros</strong>, con sus carpetas.</p><p>Los poderes de los tres caminos, los estados y el Arsenal quedan en sus compendios: se usan desde ahí (o desde el panel del Narrador).</p><p>Reimportar actualiza los documentos existentes sin duplicarlos.</p>`,
    actors, journal, scenes, macros, folders,
    items: [], tables: [], playlists: [], cards: [], combats: [],
    folder: null, sort: 0,
    flags: flags("aventura", { aventura: "somnia-biotech" }),
    _stats: STATS
  });

  // El quickstart del manifest apunta a este id.
  const manifestPath = path.join(RAIZ, "module.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.quickstart?.adventures) {
    for (const a of Object.values(manifest.quickstart.adventures)) {
      a.uuid = `Compendium.${MODULO}.aventura.Adventure.${AVENTURA_ID}`;
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(`aventura: ${scenes.length} escenas, ${actors.length} actores, ${journal.length} journals, ${macros.length} macros, ${folders.length} carpetas`);
}

construirAventura();
cerrar();
