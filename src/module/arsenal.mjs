import { DVV } from "./constantes.mjs";
import { cazadorActual, documentosDelPack, publicar } from "./actores.mjs";

/**
 * El Arsenal de la Vigilia: equipar a un cazador con el set de su Credo en
 * un click. Los ítems salen del compendio `arsenal`; lo que no tiene ficha
 * (botiquín, radios, lockpicks) se anota en el chat.
 */
export class Arsenal {
  static #datos = null;

  static async cargar() {
    this.#datos ??= await foundry.utils.fetchJsonWithTimeout(DVV.ruta("content/arsenal.json"));
    return this.#datos;
  }

  static get sets() {
    return this.#datos?.sets ?? [];
  }

  static async equiparSet(actor = null, setId = null) {
    actor ??= await cazadorActual();
    if (!actor) return;
    if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));
    await this.cargar();

    let set = setId ? this.sets.find(s => s.id === setId) : null;
    if (!set) {
      const opciones = this.sets.map(s => `<option value="${s.id}">${s.nombre}${s.credoNombre ? ` (${s.credoNombre})` : ""} — Rec. ${s.recursos}</option>`).join("");
      const r = await foundry.applications.api.DialogV2.input({
        window: { title: game.i18n.localize("DVV.arsenal.titulo") },
        classes: ["dvv-dialogo"],
        content: `<p><strong>${actor.name}</strong></p><div class="form-group"><label>${game.i18n.localize("DVV.arsenal.set")}</label><select name="set">${opciones}</select></div>`,
        ok: { label: game.i18n.localize("DVV.confirmar") }
      });
      if (!r) return;
      set = this.sets.find(s => s.id === r.set);
    }
    if (!set) return;

    const ids = set.items ?? [];
    const docs = await documentosDelPack(DVV.PACKS.ARSENAL, f => ids.includes(f.arma) || ids.includes(f.equipo));
    const porId = new Map(docs.map(d => [d.getFlag(DVV.ID, "arma") ?? d.getFlag(DVV.ID, "equipo"), d]));
    const nuevos = ids.map(id => porId.get(id)).filter(Boolean).map(d => d.toObject());
    if (nuevos.length) await actor.createEmbeddedDocuments("Item", nuevos);

    let texto = `<p>${game.i18n.format("DVV.arsenal.equipado", { actor: actor.name, set: set.nombre, items: nuevos.map(n => n.name).join(", ") || "—" })}</p>`;
    if (set.equipoLibre?.length) texto += `<p>${game.i18n.format("DVV.arsenal.equipoLibre", { lista: set.equipoLibre.join(", ") })}</p>`;
    if (set.estilo) texto += set.estilo;
    await publicar(texto, { actor });
  }
}
