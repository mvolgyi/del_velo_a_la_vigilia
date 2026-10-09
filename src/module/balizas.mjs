import { DVV } from "./constantes.mjs";
import { cazadorActual, elegirCazador, cazadoresDelMundo, publicar } from "./actores.mjs";

/**
 * Balizas Fe / Método / Carne.
 *
 * La crónica las va cargando escena a escena (+1 Fe por cuidar al durmiente,
 * +2 Carne por inyectarse el Compuesto A) y en el epílogo la baliza
 * dominante decide en qué clase de cazador se convierte cada personaje.
 * Viven como flag en el actor; los botones ⚑ de los journals y el panel del
 * Narrador las mueven.
 */
export class Balizas {
  static get vacias() {
    return { fe: 0, metodo: 0, carne: 0, historial: [] };
  }

  static de(actor) {
    return foundry.utils.mergeObject(this.vacias, actor.getFlag(DVV.ID, DVV.FLAGS.BALIZAS) ?? {}, { inplace: false });
  }

  /** @returns {"fe"|"metodo"|"carne"|null} */
  static dominante(actor) {
    const b = this.de(actor);
    const max = Math.max(b.fe, b.metodo, b.carne);
    if (max <= 0) return null;
    const ganadoras = DVV.BALIZAS.filter(k => b[k] === max);
    return ganadoras.length === 1 ? ganadoras[0] : null;
  }

  static async ajustar(actor, baliza, delta, motivo = "") {
    if (!DVV.BALIZAS.includes(baliza)) throw new Error(`Baliza desconocida: ${baliza}`);
    if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));
    const b = this.de(actor);
    b[baliza] = Math.max(0, b[baliza] + delta);
    b.historial.push({ baliza, delta, motivo, fecha: new Date().toISOString() });
    await actor.setFlag(DVV.ID, DVV.FLAGS.BALIZAS, b);
    await publicar(game.i18n.format("DVV.balizas.ajustado", {
      actor: actor.name, signo: delta > 0 ? "+" : "", delta, baliza: game.i18n.localize(`DVV.balizas.${baliza}`),
      motivo: motivo || "—", fe: b.fe, metodo: b.metodo, carne: b.carne
    }), { actor, susurro: true });
    Hooks.callAll("dvvBalizas", { actor, balizas: b, baliza, delta, motivo });
    return b;
  }

  /** Botón ⚑ de un journal: elegir cazador y aplicar. */
  static async desdeBoton({ baliza, delta, motivo }) {
    if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));
    const actor = await elegirCazador(cazadoresDelMundo());
    if (!actor) return;
    return this.ajustar(actor, baliza, Number(delta), motivo);
  }

  /** Macro: diálogo libre. */
  static async dialogo(actor = null) {
    if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));
    actor ??= await cazadorActual();
    if (!actor) return;
    const b = this.de(actor);
    const opciones = DVV.BALIZAS.map(k => `<option value="${k}">${game.i18n.localize(`DVV.balizas.${k}`)} (${b[k]})</option>`).join("");
    const r = await foundry.applications.api.DialogV2.input({
      window: { title: `${game.i18n.localize("DVV.balizas.dialogoTitulo")} — ${actor.name}` },
      classes: ["dvv-dialogo"],
      content: `
        <div class="form-group"><label>${game.i18n.localize("DVV.balizas.titulo")}</label><select name="baliza">${opciones}</select></div>
        <div class="form-group"><label>Δ</label><input type="number" name="delta" value="1" step="1"></div>
        <div class="form-group"><label>${game.i18n.localize("DVV.balizas.motivo")}</label><input type="text" name="motivo"></div>`,
      ok: { label: game.i18n.localize("DVV.confirmar") }
    });
    if (!r) return;
    return this.ajustar(actor, r.baliza, Number(r.delta) || 0, r.motivo);
  }
}
