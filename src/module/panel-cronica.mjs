import { DVV } from "./constantes.mjs";
import { Caminos } from "./caminos.mjs";
import { Balizas } from "./balizas.mjs";
import { Desesperacion } from "./desesperacion.mjs";
import { TresPuertas } from "./tres-puertas.mjs";
import { Arsenal } from "./arsenal.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Panel del Narrador.
 *
 * Una sola ventana con lo que la crónica le pide llevar a la cronista y el
 * sistema no lleva solo: Desesperación y Peligro de la Célula, balizas y
 * caminos de cada cazador, slots de carne, estados activos, y el registro
 * de Peligro de la sesión.
 */
export class PanelCronica extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dvv-panel-cronica",
    tag: "div",
    classes: ["dvv-panel"],
    window: { title: "DVV.panel.titulo", icon: "fa-solid fa-eye", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      desperacion: PanelCronica.#onDesesperacion,
      peligro: PanelCronica.#onPeligro,
      baliza: PanelCronica.#onBaliza,
      otorgar: PanelCronica.#onOtorgar,
      comprar: PanelCronica.#onComprar,
      quemar: PanelCronica.#onQuemar,
      registrar: PanelCronica.#onRegistrar,
      equipar: PanelCronica.#onEquipar,
      aplicarTodo: PanelCronica.#onAplicarTodo,
      limpiar: PanelCronica.#onLimpiar,
      abrirActor: PanelCronica.#onAbrirActor
    }
  };

  static PARTS = {
    main: { template: `modules/${DVV.ID}/templates/panel-cronica.hbs` }
  };

  static #instancia = null;

  static abrir() {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));
      return null;
    }
    this.#instancia ??= new this();
    this.#instancia.render(true);
    return this.#instancia;
  }

  static refrescar() {
    if (this.#instancia?.rendered) this.#instancia.render();
  }

  /* -------------------------------------------- */

  async _prepareContext() {
    const celula = Desesperacion.celulaDelMundo();
    const miembros = (celula?.system.members ?? []).map(u => fromUuidSync(u)).filter(a => a?.type === "hunter");
    const cazadores = [...new Set([...miembros, ...game.actors.filter(a => a.type === "hunter" && a.hasPlayerOwner)])];

    return {
      celula: celula ? {
        id: celula.id,
        nombre: celula.name,
        desesperacion: celula.system.desperation?.value ?? 0,
        peligro: celula.system.danger?.value ?? 0,
        peligroMax: celula.system.danger?.max || 5
      } : null,
      cazadores: cazadores.map(a => this.#contextoCazador(a)),
      registro: Desesperacion.registro.slice().reverse().map(e => ({
        ...e,
        fechaCorta: new Date(e.fecha).toLocaleString(game.i18n.lang, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      })),
      pendientes: Desesperacion.registro.filter(e => !e.aplicado).length
    };
  }

  #contextoCazador(actor) {
    const balizas = Balizas.de(actor);
    const dominante = Balizas.dominante(actor);
    const otorgados = Caminos.deActor(actor);
    const caminos = Object.entries(otorgados).map(([id, datos]) => {
      const c = Caminos.camino(id);
      const rama = c?.ramas.find(r => r.id === datos.rama)?.nombre;
      return c ? `${c.subtitulo}${rama ? ` (${rama})` : ""}` : id;
    });
    const poderes = Caminos.visibles(actor).map(e => e.poder.nombre);
    const esCarne = otorgados.modificado || otorgados.gen2;

    return {
      id: actor.id,
      nombre: actor.name,
      img: actor.img,
      jugador: game.users.find(u => u.character?.id === actor.id)?.name ?? "",
      desesperanza: actor.system.despair?.value === 1,
      caminos: caminos.length ? caminos.join(" · ") : game.i18n.localize("DVV.caminos.sinCamino"),
      poderes: poderes.join(", "),
      balizas: DVV.BALIZAS.map(k => ({ clave: k, nombre: game.i18n.localize(`DVV.balizas.${k}`), valor: balizas[k], dominante: dominante === k })),
      epilogo: game.i18n.localize(`DVV.panel.epilogos.${dominante ?? "mortal"}`),
      slots: esCarne ? `${Caminos.slotsUsados(actor)}/${Caminos.limiteCarne(actor)}` : null,
      estados: actor.items.filter(i => i.type === "condition").map(i => i.name).join(", ")
    };
  }

  /* -------------------------------------------- */
  /*  Acciones                                    */
  /* -------------------------------------------- */

  static async #onDesesperacion(_event, target) {
    const celula = game.actors.get(target.dataset.celula);
    if (!celula) return;
    const v = Math.clamp((celula.system.desperation?.value ?? 0) + Number(target.dataset.delta), 0, 5);
    await celula.update({ "system.desperation.value": v });
    this.render();
  }

  static async #onPeligro(_event, target) {
    const celula = game.actors.get(target.dataset.celula);
    if (!celula) return;
    await Desesperacion.subirDanger(celula, Number(target.dataset.delta));
    this.render();
  }

  static async #onBaliza(_event, target) {
    const actor = game.actors.get(target.dataset.actor);
    if (!actor) return;
    await Balizas.ajustar(actor, target.dataset.baliza, Number(target.dataset.delta), game.i18n.localize("DVV.panel.titulo"));
    this.render();
  }

  static async #onOtorgar(_event, target) {
    await TresPuertas.otorgar(game.actors.get(target.dataset.actor) ?? null);
    this.render();
  }

  static async #onComprar(_event, target) {
    await TresPuertas.comprar(game.actors.get(target.dataset.actor) ?? null);
    this.render();
  }

  static async #onQuemar(_event, target) {
    await Desesperacion.quemar(game.actors.get(target.dataset.actor) ?? null);
    this.render();
  }

  static async #onRegistrar(_event, target) {
    await Desesperacion.registrarPeligro(game.actors.get(target.dataset.actor) ?? null);
    this.render();
  }

  static async #onEquipar(_event, target) {
    await Arsenal.equiparSet(game.actors.get(target.dataset.actor) ?? null);
    this.render();
  }

  static async #onAplicarTodo() {
    await Desesperacion.aplicarRegistro();
    this.render();
  }

  static async #onLimpiar() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DVV.panel.limpiar") },
      content: `<p>${game.i18n.localize("DVV.panel.limpiarConfirmar")}</p>`
    });
    if (!ok) return;
    await Desesperacion.limpiarRegistro();
    this.render();
  }

  static async #onAbrirActor(_event, target) {
    game.actors.get(target.dataset.actor)?.sheet.render(true);
  }
}
