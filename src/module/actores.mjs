import { DVV } from "./constantes.mjs";

/**
 * Elegir con qué cazador se trabaja.
 *
 * Orden: el token seleccionado, el personaje del usuario, y si no hay
 * ninguno un diálogo con los cazadores del mundo. Lo usan las macros y los
 * botones de los journals, que no tienen un actor «a mano».
 */
export async function cazadorActual({ permitirDialogo = true, soloCazadores = true } = {}) {
  const esValido = a => a && (!soloCazadores || a.type === "hunter");

  const token = canvas?.tokens?.controlled?.[0];
  if (esValido(token?.actor)) return token.actor;

  if (esValido(game.user.character)) return game.user.character;

  if (!permitirDialogo) return null;
  return elegirCazador();
}

export function cazadoresDelMundo() {
  return game.actors.filter(a => a.type === "hunter" && (a.hasPlayerOwner || game.user.isGM));
}

export async function elegirCazador(lista = cazadoresDelMundo()) {
  if (!lista.length) {
    ui.notifications.warn(game.i18n.localize("DVV.sinActor"));
    return null;
  }
  if (lista.length === 1) return lista[0];

  const opciones = lista.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
  const resultado = await foundry.applications.api.DialogV2.input({
    window: { title: game.i18n.localize("DVV.elegirActor") },
    classes: ["dvv-dialogo"],
    content: `<div class="form-group"><label>${game.i18n.localize("DVV.elegirActor")}</label><select name="actor">${opciones}</select></div>`,
    ok: { label: game.i18n.localize("DVV.confirmar") }
  });
  return resultado ? game.actors.get(resultado.actor) : null;
}

/** Busca en un compendio del módulo los documentos cuyo flag coincida. */
export async function documentosDelPack(pack, filtro) {
  const compendio = DVV.pack(pack);
  if (!compendio) return [];
  const indice = await compendio.getIndex({ fields: ["flags"] });
  const ids = indice.filter(e => filtro(e.flags?.[DVV.ID] ?? {})).map(e => e._id);
  const docs = await Promise.all(ids.map(id => compendio.getDocument(id)));
  return docs.filter(Boolean);
}

export async function publicar(contenido, { actor = null, susurro = false, titulo = "" } = {}) {
  const datos = {
    content: `<div class="dvv-chat">${titulo ? `<h4>${titulo}</h4>` : ""}${contenido}</div>`,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: game.i18n.localize("DVV.modulo") }
  };
  if (susurro) datos.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  return ChatMessage.create(datos);
}
