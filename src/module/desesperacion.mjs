import { DVV } from "./constantes.mjs";
import { Caminos } from "./caminos.mjs";
import { cazadorActual, documentosDelPack, publicar } from "./actores.mjs";

/**
 * Desesperación y Peligro: lo que los tres caminos le piden a la Célula.
 *
 * - Quemar la Chispa / Sobrecarga / Desgarro: −1 Desesperación de la Célula,
 *   con registro en el chat. wod5e propaga el valor a los miembros solo.
 * - +1 Peligro por usar un poder ante un sobrenatural que sobrevive: queda
 *   anotado en un registro de sesión (setting de mundo). Subir el Danger de
 *   la Célula es decisión de la cronista, al final de la sesión o con la
 *   setting automática.
 * - Un «1» en dados de Desesperación: recordatorio en el chat con botones.
 */
export class Desesperacion {
  /** La Célula (actor group) a la que pertenece el cazador. */
  static celula(actor) {
    const id = actor?.system?.group;
    const grupo = id ? game.actors.get(id) : null;
    return grupo?.type === "group" ? grupo : null;
  }

  /** Cualquier Célula del mundo, para el panel cuando no hay actor. */
  static celulaDelMundo() {
    return game.actors.find(a => a.type === "group" && a.system.groupType === "cell")
      ?? game.actors.find(a => a.type === "group")
      ?? null;
  }

  /* -------------------------------------------- */
  /*  Quemar / Sobrecarga / Desgarro              */
  /* -------------------------------------------- */

  static async quemar(actor = null, { gasto = "", motivo = "" } = {}) {
    actor ??= await cazadorActual();
    if (!actor) return null;

    const celula = this.celula(actor);
    if (!celula) {
      ui.notifications.warn(game.i18n.format("DVV.sinCelula", { actor: actor.name }));
      return null;
    }

    // Nombre del gasto según el camino del actor, si no vino dado.
    if (!gasto || !motivo) {
      const caminos = Caminos.lista.filter(c => c.gasto?.nombre && Caminos.tiene(actor, c.id));
      const opciones = (caminos.length ? caminos : Caminos.lista.filter(c => c.gasto?.nombre))
        .map(c => `<option value="${c.gasto.nombre}">${c.gasto.nombre} (${c.nombre})</option>`).join("");
      const r = await foundry.applications.api.DialogV2.input({
        window: { title: game.i18n.localize("DVV.desesperacion.quemarTitulo") },
        classes: ["dvv-dialogo"],
        content: `
          <div class="form-group"><label>${game.i18n.localize("DVV.desesperacion.motivo")}</label>
            <select name="gasto">${opciones}</select></div>
          <div class="form-group"><label>${game.i18n.localize("DVV.balizas.motivo")}</label>
            <input type="text" name="motivo" value="${motivo}" placeholder="Filo Paciente, Santuario, Golpe de Prensa…"></div>`,
        ok: { label: game.i18n.localize("DVV.confirmar") }
      });
      if (!r) return null;
      gasto = r.gasto;
      motivo = r.motivo;
    }

    const antes = celula.system.desperation?.value ?? 0;
    if (antes <= 0) {
      ui.notifications.warn(game.i18n.format("DVV.desesperacion.sinDesesperacion", { gasto }));
      return null;
    }
    const despues = antes - 1;
    await celula.update({ "system.desperation.value": despues });
    await publicar(game.i18n.format("DVV.desesperacion.quemado", { actor: actor.name, gasto, motivo: motivo || "—", antes, despues }), { actor });
    Hooks.callAll("dvvDesesperacion", { celula, antes, despues, actor, gasto, motivo });
    return despues;
  }

  /* -------------------------------------------- */
  /*  Peligro                                     */
  /* -------------------------------------------- */

  static get registro() {
    return foundry.utils.deepClone(game.settings.get(DVV.ID, DVV.SETTINGS.REGISTRO_PELIGRO) ?? []);
  }

  static async registrarPeligro(actor = null, motivo = "") {
    actor ??= await cazadorActual();
    if (!actor) return;

    if (!motivo) {
      const r = await foundry.applications.api.DialogV2.input({
        window: { title: game.i18n.localize("DVV.desesperacion.peligroTitulo") },
        classes: ["dvv-dialogo"],
        content: `<div class="form-group"><label>${game.i18n.localize("DVV.desesperacion.peligroMotivo")}</label>
          <input type="text" name="motivo" placeholder="Usó Hendir frente a Marcos y Marcos escapó"></div>`,
        ok: { label: game.i18n.localize("DVV.confirmar") }
      });
      if (!r) return;
      motivo = r.motivo;
    }

    const registro = this.registro;
    const entrada = { fecha: new Date().toISOString(), actor: actor.name, actorId: actor.id, motivo, aplicado: false };
    registro.push(entrada);

    const celula = this.celula(actor) ?? this.celulaDelMundo();
    const auto = game.settings.get(DVV.ID, DVV.SETTINGS.SUBIR_DANGER);
    let texto = game.i18n.format("DVV.desesperacion.peligroRegistrado", { actor: actor.name, motivo });
    if (auto && celula) {
      const valor = await this.subirDanger(celula, 1);
      entrada.aplicado = true;
      texto += ` ${game.i18n.format("DVV.desesperacion.peligroAplicado", { valor })}`;
    }
    await this.#guardarRegistro(registro);
    await publicar(texto, { actor, susurro: true });
  }

  static async subirDanger(celula, delta = 1) {
    const actual = celula.system.danger?.value ?? 0;
    const max = celula.system.danger?.max || 5;
    const valor = Math.clamp(actual + delta, 0, max);
    await celula.update({ "system.danger.value": valor });
    return valor;
  }

  /** Aplica a la Célula todas las entradas pendientes del registro. */
  static async aplicarRegistro(celula = this.celulaDelMundo()) {
    const registro = this.registro;
    const pendientes = registro.filter(e => !e.aplicado);
    if (!celula || !pendientes.length) return;
    const valor = await this.subirDanger(celula, pendientes.length);
    for (const e of pendientes) e.aplicado = true;
    await this.#guardarRegistro(registro);
    await publicar(game.i18n.format("DVV.desesperacion.peligroAplicadoTodo", { n: pendientes.length, valor }), { susurro: true });
  }

  static async limpiarRegistro() {
    await this.#guardarRegistro([]);
  }

  static async #guardarRegistro(registro) {
    await game.settings.set(DVV.ID, DVV.SETTINGS.REGISTRO_PELIGRO, registro);
    Hooks.callAll("dvvPeligro", { registro });
  }

  /* -------------------------------------------- */
  /*  Un «1» en los dados de Desesperación        */
  /* -------------------------------------------- */

  /**
   * Hook `wod5e.handleFailure`: el sistema lo emite después de cada tirada
   * con los resultados de los dados avanzados (para cazadores, los de
   * Desesperación). No dice de qué ítem vino la tirada, así que buscamos el
   * último mensaje de chat del usuario y lo comparamos con las reservas
   * `dvv-*` del actor.
   */
  static async onHandleFailure(actor, system, failures, diceResults, rollMode) {
    if (system !== "hunter" || actor?.type !== "hunter") return;
    if (!game.settings.get(DVV.ID, DVV.SETTINGS.RECORDATORIOS)) return;
    const unos = (diceResults ?? []).filter(r => r.result === 1 && !r.discarded).length;
    if (!unos) return;

    // El sistema emite el hook ANTES de publicar la tirada en el chat:
    // esperamos ese mensaje (o un tiempo prudencial) para saber de qué reserva vino.
    const mensaje = await this.#esperarMensajeDeTirada();
    const poder = this.#reservaDelMensaje(actor, mensaje);
    let texto = `<p>${game.i18n.format("DVV.desesperacion.recordatorio.texto", { actor: actor.name, unos })}</p>`;
    const botones = [
      `<button type="button" data-dvv-accion="extralimitacion" data-actor="${actor.id}" data-unos="${unos}">${game.i18n.format("DVV.desesperacion.recordatorio.extralimitacion", { unos })}</button>`,
      `<button type="button" data-dvv-accion="desesperanza" data-actor="${actor.id}">${game.i18n.localize("DVV.desesperacion.recordatorio.desesperanza")}</button>`
    ];
    if (poder) {
      const { camino, poder: p } = poder;
      const fallo = camino.id === "gen2" ? Caminos.camino("modificado")?.falloTotal : camino.falloTotal;
      if (fallo) {
        texto += `<p>${game.i18n.format("DVV.desesperacion.recordatorio.camino", { poder: p.nombre, camino: camino.nombre, fallo: fallo.nombre })}</p>`;
        const estadoId = { imbuido: "silencio-de-los-heraldos", iluminado: "artefacto-quemado", modificado: "crisis-de-rechazo", gen2: "crisis-de-rechazo" }[camino.id];
        if (estadoId) {
          botones.push(`<button type="button" data-dvv-accion="estado" data-actor="${actor.id}" data-estado="${estadoId}">${game.i18n.format("DVV.desesperacion.recordatorio.aplicarEstado", { estado: fallo.nombre })}</button>`);
        }
      }
    }
    await publicar(`${texto}<div class="dvv-botones">${botones.join("")}</div>`, {
      actor,
      titulo: game.i18n.localize("DVV.desesperacion.recordatorio.titulo")
    });
  }

  static #esperarMensajeDeTirada(ms = 1500) {
    return new Promise(resolve => {
      let listo = false;
      const id = Hooks.on("createChatMessage", (m, _o, userId) => {
        if (listo || userId !== game.user.id || !m.isRoll) return;
        listo = true;
        Hooks.off("createChatMessage", id);
        resolve(m);
      });
      setTimeout(() => {
        if (listo) return;
        listo = true;
        Hooks.off("createChatMessage", id);
        resolve(game.messages.contents.findLast(m => m.isRoll && m.author?.id === game.user.id) ?? null);
      }, ms);
    });
  }

  static #reservaDelMensaje(actor, mensaje) {
    if (!mensaje) return null;
    const reservas = actor.items.filter(i => i.type === "edgepool" && i.system.edge?.startsWith(DVV.PREFIJO_EDGE));
    if (!reservas.length) return null;
    const texto = `${mensaje.flavor ?? ""} ${mensaje.content ?? ""} ${mensaje.rolls?.[0]?.options?.title ?? ""}`;
    const reserva = reservas.find(r => texto.includes(r.name));
    return reserva ? Caminos.porEdge(reserva.system.edge) : null;
  }

  /** Botones del recordatorio. */
  static async accionRecordatorio(accion, { actorId, unos, estado }) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));

    if (accion === "extralimitacion") {
      const celula = this.celula(actor) ?? this.celulaDelMundo();
      if (!celula) return ui.notifications.warn(game.i18n.format("DVV.sinCelula", { actor: actor.name }));
      const valor = await this.subirDanger(celula, Number(unos) || 1);
      await publicar(game.i18n.format("DVV.desesperacion.peligroAplicado", { valor }), { actor });
    } else if (accion === "desesperanza") {
      await actor.update({ "system.despair.value": 1 });
      await publicar(game.i18n.format("DVV.desesperacion.recordatorio.desesperanzaAplicada", { actor: actor.name }), { actor });
    } else if (accion === "estado") {
      const docs = await documentosDelPack(DVV.PACKS.ESTADOS, f => f.estado === estado);
      if (!docs.length) return;
      await actor.createEmbeddedDocuments("Item", docs.map(d => d.toObject()));
      await publicar(game.i18n.format("DVV.desesperacion.recordatorio.estadoAplicado", { estado: docs[0].name, actor: actor.name }), { actor });
    }
  }

  /* -------------------------------------------- */

  static registrarSettings() {
    game.settings.register(DVV.ID, DVV.SETTINGS.REGISTRO_PELIGRO, {
      name: "DVV.settings.registro-peligro.Name",
      hint: "DVV.settings.registro-peligro.Hint",
      scope: "world",
      config: false,
      type: Array,
      default: []
    });
    game.settings.register(DVV.ID, DVV.SETTINGS.SUBIR_DANGER, {
      name: "DVV.settings.subir-danger-automatico.Name",
      hint: "DVV.settings.subir-danger-automatico.Hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: false
    });
    game.settings.register(DVV.ID, DVV.SETTINGS.IMPORTACION_OFRECIDA, {
      scope: "world",
      config: false,
      type: Boolean,
      default: false
    });
    game.settings.register(DVV.ID, DVV.SETTINGS.RECORDATORIOS, {
      name: "DVV.settings.recordatorios-desesperacion.Name",
      hint: "DVV.settings.recordatorios-desesperacion.Hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
  }
}
