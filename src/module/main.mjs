/**
 * Del Velo a la Vigilia — punto de entrada del módulo.
 *
 * Solo cablea: las constantes viven en constantes.mjs y cada mecánica en su
 * propio archivo. Ver README.md para la arquitectura.
 */

import { DVV } from "./constantes.mjs";
import { Caminos } from "./caminos.mjs";
import { TresPuertas } from "./tres-puertas.mjs";
import { Desesperacion } from "./desesperacion.mjs";
import { Balizas } from "./balizas.mjs";
import { Arsenal } from "./arsenal.mjs";
import { PanelCronica } from "./panel-cronica.mjs";
import { cazadorActual } from "./actores.mjs";
import { instalarParches } from "./compat.mjs";

export { DVV, Caminos, TresPuertas, Desesperacion, Balizas, Arsenal, PanelCronica };

/* -------------------------------------------- */

Hooks.once("init", () => {
  console.log(`${DVV.ID} | Inicializando Del Velo a la Vigilia`);
  Desesperacion.registrarSettings();
});

/* -------------------------------------------- */

Hooks.once("setup", () => {
  instalarParches();
});

Hooks.once("ready", async () => {
  // API pública, para macros y otros módulos. Se expone antes de cargar los
  // datos: cada método espera a Caminos.cargar() por su cuenta.
  game.modules.get(DVV.ID).api = {
    DVV, Caminos, TresPuertas, Desesperacion, Balizas, Arsenal, PanelCronica,
    abrirPanel: () => PanelCronica.abrir(),
    otorgarCamino: (actor, opciones) => TresPuertas.otorgar(actor, opciones),
    comprarPoder: (actor, opciones) => TresPuertas.comprar(actor, opciones),
    comprarMejora: actor => TresPuertas.comprarMejora(actor),
    quemar: (actor, opciones) => Desesperacion.quemar(actor, opciones),
    registrarPeligro: (actor, motivo) => Desesperacion.registrarPeligro(actor, motivo),
    ajustarBalizas: actor => Balizas.dialogo(actor),
    equiparSet: (actor, setId) => Arsenal.equiparSet(actor, setId),
    importarCronica: opciones => importarCronica(opciones),
    cazadorActual
  };

  await Caminos.cargar();
  await Arsenal.cargar().catch(err => console.warn(`${DVV.ID} | arsenal:`, err));

  console.log(`${DVV.ID} | Listo. Foundry ${game.version} · ${game.system.id} ${game.system.version} · ${Caminos.lista.length} caminos`);

  if (game.user.isGM) ofrecerImportacion().catch(err => console.warn(`${DVV.ID} | importación:`, err));
});

/* -------------------------------------------- */
/*  Importar la crónica al mundo                */
/* -------------------------------------------- */

/** La Aventura del compendio: escenas, actores, journals, macros y carpetas. */
async function aventura() {
  const pack = DVV.pack("aventura");
  if (!pack) return null;
  const indice = await pack.getIndex();
  const entrada = indice.contents[0];
  return entrada ? pack.getDocument(entrada._id) : null;
}

function cronicaImportada() {
  return game.scenes.some(s => s.getFlag(DVV.ID, "escena")) || game.journal.some(j => j.getFlag(DVV.ID, "archivo"));
}

/** Importa (o actualiza) todo el contenido de la crónica en el mundo. */
async function importarCronica({ silencioso = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));
  const doc = await aventura();
  if (!doc) return ui.notifications.error(game.i18n.localize("DVV.importar.sinAventura"));
  const resultado = await doc.import({ dialog: false });
  await game.settings.set(DVV.ID, DVV.SETTINGS.IMPORTACION_OFRECIDA, true);
  if (!silencioso) ui.notifications.info(game.i18n.format("DVV.importar.hecho", { n: Object.values(resultado?.created ?? {}).reduce((a, b) => a + (b?.length ?? 0), 0) }));
  return resultado;
}

/** Versión del módulo con la que se importó la crónica por última vez (la anota Foundry). */
function versionImportada(doc) {
  return game.settings.get("core", "adventureImports")?.[doc.uuid]?.moduleVersion ?? "";
}

/**
 * Al entrar por primera vez a un mundo sin la crónica, se ofrece importarla.
 * Si ya está importada pero con una versión anterior del módulo, se ofrece
 * actualizarla (escenas, actores, journals…), una vez por versión.
 */
async function ofrecerImportacion() {
  const doc = await aventura();
  if (!doc) return;
  const version = game.modules.get(DVV.ID).version;

  if (cronicaImportada()) {
    const importada = versionImportada(doc);
    const ofrecida = game.settings.get(DVV.ID, DVV.SETTINGS.VERSION_OFRECIDA);
    if (!importada || importada === version || ofrecida === version) return;
    const si = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DVV.importar.actualizarTitulo") },
      classes: ["dvv-dialogo"],
      content: `<p>${game.i18n.format("DVV.importar.actualizarPregunta", { importada, version })}</p>`,
      yes: { label: game.i18n.localize("DVV.importar.actualizarSi"), default: true },
      no: { label: game.i18n.localize("DVV.importar.no") }
    });
    await game.settings.set(DVV.ID, DVV.SETTINGS.VERSION_OFRECIDA, version);
    if (si) await importarCronica();
    return;
  }

  if (game.settings.get(DVV.ID, DVV.SETTINGS.IMPORTACION_OFRECIDA)) return;
  const si = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("DVV.importar.titulo") },
    classes: ["dvv-dialogo"],
    content: `<p>${game.i18n.localize("DVV.importar.pregunta")}</p>${doc.description}`,
    yes: { label: game.i18n.localize("DVV.importar.si"), default: true },
    no: { label: game.i18n.localize("DVV.importar.no") }
  });
  await game.settings.set(DVV.ID, DVV.SETTINGS.IMPORTACION_OFRECIDA, true);
  if (si) await importarCronica();
}

/* -------------------------------------------- */
/*  Hooks del sistema                           */
/* -------------------------------------------- */

/** Un «1» en los dados de Desesperación. */
Hooks.on("wod5e.handleFailure", (actor, system, failures, diceResults, rollMode) => {
  Desesperacion.onHandleFailure(actor, system, failures, diceResults, rollMode)
    .catch(err => console.warn(`${DVV.ID} | recordatorio:`, err));
});

/** Reserva o mejora `dvv-*` arrastrada a una hoja: completar la Facultad. */
Hooks.on("createItem", (item, _options, userId) => {
  if (userId !== game.user.id) return;
  TresPuertas.onCreateItem(item).catch(err => console.warn(`${DVV.ID} | createItem:`, err));
});

/** El panel se entera cuando algo se mueve desde una macro, un journal o el chat. */
for (const hook of ["dvvBalizas", "dvvPeligro", "dvvDesesperacion", "dvvCaminos"]) {
  Hooks.on(hook, () => PanelCronica.refrescar());
}
Hooks.on("updateActor", actor => {
  if (actor.type === "group" || actor.type === "hunter") PanelCronica.refrescar();
});

/* -------------------------------------------- */
/*  Botones embebidos en journals y chat        */
/* -------------------------------------------- */

/**
 * Listener delegado en el documento: los journals se renderizan en muchos
 * contextos distintos (hoja, popout, «mostrar a jugadores») y engancharse a
 * cada uno sería frágil. Lo mismo para los botones de los mensajes de chat.
 */
Hooks.once("ready", () => {
  document.addEventListener("click", async event => {
    const tirada = event.target.closest("[data-dvv-tirada]");
    if (tirada) {
      event.preventDefault();
      return lanzarTirada(tirada.dataset);
    }

    const baliza = event.target.closest("[data-dvv-baliza]");
    if (baliza) {
      event.preventDefault();
      baliza.disabled = true;
      try {
        await Balizas.desdeBoton({ baliza: baliza.dataset.dvvBaliza, delta: baliza.dataset.delta, motivo: baliza.dataset.motivo });
        baliza.classList.add("usado");
      } finally {
        baliza.disabled = false;
      }
      return;
    }

    const accion = event.target.closest("[data-dvv-accion]");
    if (accion) {
      event.preventDefault();
      return Desesperacion.accionRecordatorio(accion.dataset.dvvAccion, {
        actorId: accion.dataset.actor, unos: accion.dataset.unos, estado: accion.dataset.estado
      });
    }
  });
});

/** Botón @tirada de un journal: reserva por paths de wod5e, con dificultad. */
async function lanzarTirada({ dvvTirada, dificultad, label }) {
  const actor = await cazadorActual({ soloCazadores: false });
  if (!actor) return;
  const paths = dvvTirada.split(/\s+/).filter(Boolean);
  const selectors = paths.flatMap(p => [p, ...p.split(".")]);
  await WOD5E.api.RollFromDataset({
    dataset: {
      label,
      valuePaths: paths.map(p => `${p}.value`).join(" "),
      selectors: [...new Set(selectors)].join(" "),
      difficulty: Number(dificultad) || 0
    },
    actor
  });
}
