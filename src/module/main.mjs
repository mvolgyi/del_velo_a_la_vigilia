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

export { DVV, Caminos, TresPuertas, Desesperacion, Balizas, Arsenal, PanelCronica };

/* -------------------------------------------- */

Hooks.once("init", () => {
  console.log(`${DVV.ID} | Inicializando Del Velo a la Vigilia`);
  Desesperacion.registrarSettings();
});

/* -------------------------------------------- */

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
    cazadorActual
  };

  await Caminos.cargar();
  await Arsenal.cargar().catch(err => console.warn(`${DVV.ID} | arsenal:`, err));

  console.log(`${DVV.ID} | Listo. Foundry ${game.version} · ${game.system.id} ${game.system.version} · ${Caminos.lista.length} caminos`);
});

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
