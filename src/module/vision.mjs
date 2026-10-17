/**
 * Visión de los cazadores: penumbra, linterna y Lente Espectral.
 *
 * Foundry 14 hace que un token con alcance de visión 0 vea SOLO lo iluminado;
 * fuera de las luces de la escena, negro. Para una crónica que pasa en
 * edificios a oscuras eso es demasiado: una persona distingue bultos a unos
 * metros. De ahí las tres piezas:
 *
 *   - Penumbra: todo token de cazador ve a tientas hasta PENUMBRA_M metros
 *     (en gris, apagado); más allá, solo lo que alumbra una luz.
 *   - Linterna: botón en el HUD del token que enciende una luz sobre el
 *     token (la rotación de los tokens de personaje está bloqueada, así que
 *     es un haz abierto y no un cono). El Narrador puede encenderla a un PNJ.
 *   - Lente Espectral: botón (solo para quien tiene la Facultad) que activa la
 *     visión nocturna de Foundry (modo darkvision, LENTE_M metros).
 *
 * Todo se guarda en el token, no en el actor: dos tokens del mismo cazador
 * pueden tener la linterna en distinto estado.
 */
import { DVV } from "./constantes.mjs";

const PENUMBRA_M = 3;
const LENTE_M = 20;
const EDGE_LENTE = "dvv-ilu-lente-espectral";
const LINTERNA = {
  bright: 5, dim: 10, angle: 360, color: "#ffe6bf", alpha: 0.4, luminosity: 0.5, attenuation: 0.55,
  coloration: 1, saturation: 0, contrast: 0, shadows: 0,
  animation: { type: null, speed: 5, intensity: 5, reverse: false }, darkness: { min: 0, max: 1 }
};
const APAGADA = { bright: 0, dim: 0, angle: 360, alpha: 0.5, animation: { type: null } };

export class Vision {
  static esCazador(doc) { return doc?.actor?.type === "hunter"; }
  static tieneLente(doc) { return !!doc?.actor?.system?.edges?.[EDGE_LENTE]?.visible; }
  static linternaEncendida(doc) { return !!doc.getFlag(DVV.ID, "linterna"); }
  static lenteActiva(doc) { return !!doc.getFlag(DVV.ID, "lente"); }

  /** Hook preCreateToken: los cazadores ven a tientas hasta PENUMBRA_M si no traen un alcance propio. */
  static onPreCreateToken(doc, data) {
    const actor = game.actors.get(data.actorId);
    if (actor?.type !== "hunter") return;
    const cambios = {};
    if (!doc.sight?.enabled) cambios["sight.enabled"] = true;
    if (!(Number(data.sight?.range) > 0)) cambios["sight.range"] = PENUMBRA_M;
    if (Object.keys(cambios).length) doc.updateSource(cambios);
  }

  static async linterna(doc, encender = !this.linternaEncendida(doc)) {
    if (!doc?.isOwner) return ui.notifications.warn(game.i18n.localize("DVV.vision.sinPermiso"));
    await doc.update({ light: encender ? LINTERNA : APAGADA, [`flags.${DVV.ID}.linterna`]: encender });
  }

  static async lente(doc, activar = !this.lenteActiva(doc)) {
    if (!doc?.isOwner) return ui.notifications.warn(game.i18n.localize("DVV.vision.sinPermiso"));
    if (activar && !this.tieneLente(doc)) return ui.notifications.warn(game.i18n.localize("DVV.vision.sinLente"));
    await doc.update({
      sight: activar
        ? { enabled: true, range: LENTE_M, visionMode: "darkvision", saturation: -1, contrast: 0.1 }
        : { enabled: true, range: PENUMBRA_M, visionMode: "basic", saturation: 0, contrast: 0 },
      [`flags.${DVV.ID}.lente`]: activar
    });
  }

  /** Botones Linterna y Lente en el HUD del token de un cazador (o de cualquier PNJ para el Narrador). */
  static onRenderTokenHUD(hud, html) {
    const doc = hud.document;
    if (!doc?.isOwner || !doc.actor) return;
    if (!this.esCazador(doc) && !game.user.isGM) return;
    const col = html.querySelector(".col.left") ?? html;
    const boton = (icono, tooltip, activo, onClick) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = `control-icon dvv-hud${activo ? " active" : ""}`;
      b.dataset.tooltip = tooltip;
      b.innerHTML = `<i class="fa-solid ${icono}"></i>`;
      b.addEventListener("click", ev => { ev.preventDefault(); onClick().then(() => hud.render()); });
      return b;
    };
    col.append(boton("fa-flashlight", game.i18n.localize("DVV.vision.linterna"), this.linternaEncendida(doc), () => this.linterna(doc)));
    if (this.tieneLente(doc) || this.lenteActiva(doc)) {
      col.append(boton("fa-eye-low-vision", game.i18n.localize("DVV.vision.lente"), this.lenteActiva(doc), () => this.lente(doc)));
    }
  }
}
