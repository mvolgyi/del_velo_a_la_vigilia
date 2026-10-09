# Del Velo a la Vigilia — Spec del módulo Foundry VTT

Módulo para **Hunter: The Reckoning 5e** (Cazador: La Venganza) sobre el sistema **wod5e**.
Empaqueta las reglas caseras de los *tres caminos*, el *Arsenal de la Vigilia* y la crónica
*Somnia Biotech* para jugarla en Foundry.

| | |
|---|---|
| id del módulo | `del-velo-a-la-vigilia` |
| Sistema | `wod5e` ≥ 5.3 (verificado contra 5.3.28, código leído en GitHub) |
| Foundry | v14 (servidor: 14 build 361; local: 14 build 365) |
| Idioma primario | español (etiquetas también en inglés para el selector de Facultades) |
| Mundo destino | "Hunters The Reckoning" en theflock.moltenhosting.com |
| Repo | github.com/mvolgyi/del_velo_a_la_vigilia (público) |

---

## 1. Qué hay en `docs/` y qué entra al módulo

| Fuente | Entra | Cómo |
|---|---|---|
| *La Marca de los Heraldos* (Bordes Imbuidos) | sí | Facultades + Beneficios + reservas + journal de reglas |
| *La Ciencia del Umbral* (Artefactos Iluminados) | sí | ídem |
| *La Carne Templada* (Modificaciones) | sí | ídem |
| *Injertos de Segunda Generación* | sí | ídem (coste 4 pts / 8 PX, doble slot) |
| *El Arsenal de la Vigilia* | sí | ítems `weapon`/`gear` + journal de sets por Credo |
| *Pantalla del Narrador — Somnia Biotech* | sí | journal de referencia rápida para el Narrador |
| *Narración — Del velo a la vigilia* | sí | journals de la crónica (3 actos, interludio, epílogo, diálogos) + PNJs |
| Libro básico H5 (PDF Nosolorol) | **no** | es material con copyright; el sistema wod5e ya implementa sus reglas |

> **Aviso de licencia.** El repo es público. El PDF del libro básico está en `docs/` sin
> trackear; hay que agregar `docs/*.pdf` al `.gitignore` antes del primer commit de contenido.
> Los `.docx` son material propio y pueden quedar.

---

## 2. Cómo modela wod5e lo que necesitamos (lo que condiciona el diseño)

Leído del código fuente del sistema (`system/api/def/edges.js`, `item/data-models/htr/*`,
`actor/actor.js`, `scripts/rolls/*`):

- **Facultad (Edge)** no es un ítem: es una entrada de un registro estático (`WOD5E.Edges`).
  Un módulo puede inyectar entradas nuevas con `module.json → flags.wod5e.customEdges`
  (`[{ id, label }]`, `label` es una clave i18n). En la hoja del cazador la Facultad se
  "agrega" (`system.edges.<id>.visible = true`) y su descripción vive **en el actor**
  (`system.edges.<id>.description`), no en un compendio.
- **Beneficio (Perk)** sí es un ítem (`type: perk`, `system.edge = <id de Facultad>`).
- **Reserva de Facultad (edgepool)** es un ítem (`type: edgepool`, `system.edge`,
  `system.dicepool = { k: { path: "attributes.resolve" }, ... }`). Es lo que se tira.
- **Desesperación** vive en el actor `group` (la Célula) y se propaga a los miembros al
  actualizar la célula. Al tirar, el cazador suma dados de Desesperación como dados
  "avanzados" (el diálogo de tirada lo permite salvo en Desesperanza: `unless: ['despair']`).
- Un `1` en dados de Desesperación produce la etiqueta "Extralimitación o Desesperanza" en el
  chat. El sistema **no** automatiza la consecuencia; sí emite el hook
  `wod5e.handleFailure(actor, system, failures, diceResults, rollMode)` con los resultados de
  los dados avanzados.
- **Estados (condition)** son ítems con `system.bonuses[]`: modificadores de dados por
  selectores (`all`, `physical`, `mental`, `social`, `attributes.strength`, `skills.stealth`…)
  con `activeWhen` y `unless`. Es el mecanismo de "efecto activo" del sistema.
- **Armas** son ítems `weapon` con `weaponvalue` (+daño), `weaponType` (`melee`/`ranged`) y
  `dicepool`.
- **PNJs** son actores `spc` (reservas estándar + excepcionales, `power`, `generaldifficulty`).
- No existe nada de "slots por Resistencia", "mantenimiento", "régimen" ni "balizas": eso lo
  lleva el módulo.

Consecuencia: los docs dicen "cargá cada Borde como ítem de tipo Edge"; en la práctica es
**una `customEdge` por poder + un `edgepool` por poder + un `perk` por Mejora**.

---

## 3. Contenido: los Tres Caminos

### 3.1 Facultades registradas (`flags.wod5e.customEdges`)

Una Facultad por poder, con prefijo de camino en la etiqueta para que el selector del sistema
quede legible. 37 entradas:

| Camino | Pasiva gratis | Poderes (3 pts / 6 PX) |
|---|---|---|
| **Imbuido** (Fe) — Celo / Misericordia / Visión | Segunda Vista | Hendir, Custodia, Atravesar · Iluminar, Bálsamo, Sosegar · Presagio, Señalar, Sondear |
| **Iluminado** (Método) — Balística Anómala / Contramedidas / Telemetría | Lente Espectral | Munición Tratada, Emisor de Perímetro, Designador · Difusor de Calma, Kit de Trauma, Inhibidor · Motor Predictivo, Rastreador de Firma, Reconstructor |
| **Modificado** (Carne) — Refuerzo / Soporte / Sensorio | Sentido Vestigial | Osteoinjerto, Glándula Apotropaica, Mirada de Depredador · Feromonas de Calma, Plasma Universal, Toque Supresor · Reflejo Anticipatorio, Olfato Quimérico, Memoria Táctil |
| **Gen II** (4 pts / 8 PX, doble slot, solo Modificados) | — | Ojo Compuesto, Malla Subdérmica, Glándula de Sobremarcha, Miofibras Sintéticas, Ojos de la Bestia, Mimetismo Dérmico, Rostro Maleable |

Ids: `dvv-imb-hendir`, `dvv-ilu-municion-tratada`, `dvv-mod-osteoinjerto`, `dvv-gen2-ojo-compuesto`…

### 3.2 Fuente única de datos: `content/caminos.json`

Un solo archivo describe cada poder: id, camino, rama/virtud/línea, nombre, coste, reserva de
dados (paths wod5e), texto de sistema (HTML), mejoras (nombre, si es Quemar/Sobrecarga/Desgarro,
texto), estados que activa, marca física, precio propio. De ahí se generan:

- las `customEdges` de `module.json` (build),
- el pack `reservas` (edgepool),
- el pack `mejoras` (perk),
- la descripción que el módulo escribe en el actor al otorgar la Facultad,
- la tabla del journal de reglas.

Así el código y los compendios nunca divergen.

### 3.3 Packs de ítems

| Pack | Tipo | Contenido |
|---|---|---|
| `reservas` | Item/edgepool | una reserva por poder (ej. *Custodia — Resolución + Ocultismo*), con el texto de sistema en la descripción (sale en el chat al tirar) |
| `mejoras` | Item/perk | ~75 Beneficios; los de Quemar/Sobrecarga/Desgarro llevan el sufijo en el nombre |
| `estados` | Item/condition | ver 3.4 |
| `rasgos` | Item/feature (flaw) | *La cicatriz* (Imbuido), *La obsesión* (Iluminado), *La marca de la carne* (Modificado): Defecto de 1 punto obligatorio |
| `arsenal` | Item/weapon + gear | ver §4 |

### 3.4 Estados (conditions con `bonuses`)

| Estado | Efecto en dados | Camino |
|---|---|---|
| Silencio de los Heraldos | marcador; bloquea Bordes (el módulo avisa al tirar reservas `dvv-imb-*`) | Imbuido |
| Artefacto quemado | marcador por ítem; bloquea esa reserva hasta reparar (Int + Tecnología/Artesanía dif. 3) | Iluminado |
| Sin mantenimiento | −1 a reservas `dvv-ilu-*` | Iluminado |
| Manos ajenas | −2 a reservas `dvv-ilu-*` | Iluminado |
| Crisis de rechazo | marcador; 1 agravado + Modificación inerte hasta cuidados (Int + Medicina dif. 3) | Modificado |
| Sin régimen | −1 a reservas `dvv-mod-*` y `dvv-gen2-*` | Modificado |
| Malla Subdérmica activa | nota "Armadura 2"; −1 a tacto fino/Medicina propia | Gen II |
| Sobremarcha activa | +2 a `attributes.dexterity` | Gen II |
| Bajón de Sobremarcha | −1 a `physical` | Gen II |
| Miofibras activas | +2 a `attributes.strength` | Gen II |
| Ojo Compuesto activo | +2 Percepción (`skills.awareness`); −2 a resistir ataques sensoriales | Gen II |
| Mimetismo activo | +3 a `skills.stealth` | Gen II |
| Lente no equipada | marcador: sin Segunda Vista tecnológica | Iluminado |

### 3.5 Journals de reglas (`reglas`)

Un JournalEntry por documento, con páginas por sección, generado desde Markdown en
`content/reglas/*.md` (mismo pipeline que *La Cruzada Escarlata*: Markdown → JSON de journal
con ids estables). Los poderes enlazan a sus reservas y mejoras con `@UUID`.

---

## 4. Contenido: El Arsenal de la Vigilia

- Pack `arsenal` (Item): cada fila de las tablas 2, 3 y 4 como `weapon` (reserva en `dicepool`,
  `weaponvalue` = daño) o `gear` (munición, sal, agua bendita, espejo…). Dif., Ocultamiento y
  Recursos van en la descripción con un formato fijo para que se lean en la hoja.
- Journal *El Arsenal de la Vigilia*: tablas completas, reglas rápidas contra lo sobrenatural y
  los **sets por Credo** con enlaces `@UUID` a cada ítem.
- Macro *Equipar set*: elige Credo y crea en el actor los ítems del set (los jugadores nuevos
  quedan equipados en un click).

---

## 5. Contenido: la crónica Somnia Biotech

### 5.1 Journals (`cronica`), solo Narrador

Markdown en `content/cronica/`:

- Acto 1 — La noche que se rompe el Velo (Convergencia, Escena del Velo, Encrucijada I, Huida)
- Interludio — El Superviviente (refugio, catálogo, Las Tres Puertas, La Pregunta) + el monólogo
  de Elías como *handout* leíble en voz alta
- Acto 2 — La Vigilia (escenas modulares con sus balizas) + Encrucijada II
- Acto 3 — La Cripta (Descenso, Relicario, Gesto de Elías, Encrucijada III, Amanecer)
- Epílogo — una página por destino (Despertar, Quimera, Heredero, Cazador Mortal)
- Dramatis personae y diálogos (Marcos, Sor Anunciación, Dra. Salas)
- Pantalla del Narrador (campos de Desesperación por Credo, los tres caminos en una página,
  combate rápido, hilos abiertos)

Cada tirada de la crónica lleva un botón inline que la lanza por la API de wod5e
(ej. *Compostura + Resolución dif. 2*), y cada "+1 Fe/Método/Carne" lleva un botón que mueve
la baliza del actor elegido (el mismo truco de ⚑ que ya usás en La Cruzada).

### 5.2 Actores (`pnjs`, tipo `spc`)

Marcos, Sor Anunciación, Dra. Irene Salas, Elías Roca (Físico 4, Mental 7, Ocultismo 8,
Salud 5, Segunda Vista intacta, Bordes silenciados), ghoul de Somnia, matón corporativo,
durmiente, Quimera suelta (tres variantes con un injerto cada una).

**Opcional:** cuatro plantillas de cazador (`hunter`) para el Guardia, el Informático, el
Doctorando y el Limpiador, con Credo y Determinación sugeridos y el set de armas de su Credo.

### 5.3 Escenas (fase 4, opcional)

Somnia Biotech (pasillo de cristal / ala de ensayos / muelle de carga), el piso de Elías, el
convento y la cripta. Se generan con el pipeline de mapas que ya tenés (`battlemaps`), con muros
y luces de emergencia rojas para el apagón. Sin esto el módulo es jugable igual con teatro de
la mente.

---

## 6. Código del módulo (`src/`)

Todo ES modules, ApplicationV2/DialogV2, sin jQuery, sin APIs de `appv1/`. CSS prefijado
`dvv-`. Flags en scope `del-velo-a-la-vigilia`.

| Archivo | Responsabilidad |
|---|---|
| `main.mjs` | `init`/`ready`, settings, registro de hooks, `game.dvv` (API para macros) |
| `caminos.mjs` | carga `content/caminos.json`; helpers "qué camino tiene este actor", "cuántos slots usa" |
| `tres-puertas.mjs` | DialogV2 **Otorgar camino** (Imbuimiento / Avance / Operación): hace visible la pasiva gratis con su descripción, crea su reserva, crea el Defecto de 1 punto, anota el momento en el chat. DialogV2 **Comprar poder**: lista los poderes del camino con el coste (normal / +1 pt fuera de Virtud-Rama-Línea / Gen II 4 pts), hace visible la Facultad, crea reserva y ofrece sus Mejoras; para Modificados comprueba el límite de Resistencia (Gen II cuenta doble) y avisa |
| `desesperacion.mjs` | `quemar(actor, motivo)`: −1 Desesperación en la Célula del actor (si está en 0, se niega) + mensaje de chat con registro. `peligro(+1, motivo)`: anota en el log de Peligro del módulo y, con una setting, sube el Danger de la Célula. Hook `wod5e.handleFailure`: si hubo un `1` en dados de Desesperación, publica el recordatorio de consecuencias (Extralimitación o Desesperanza; y si la tirada fue una reserva `dvv-*`, el Silencio / Artefacto quemado / Crisis de rechazo correspondiente) con botones para aplicar el estado |
| `balizas.mjs` | balizas Fe / Método / Carne por actor en flags; botones inline en journals; resumen en el panel |
| `panel-cronica.mjs` | ApplicationV2 para el Narrador: Desesperación y Peligro de la Célula, balizas por PJ, caminos otorgados y slots de carne usados, estado de Artefactos (mantenimiento/quemado), log de Peligro de la sesión, cambios al epílogo según balizas dominantes |
| `arsenal.mjs` | macro *Equipar set* por Credo |
| `styles/dvv.css` | panel, botones inline, chips de estado |

Settings (`world`): subir Danger automáticamente al registrar +1 Peligro (default: no, solo
log); mostrar recordatorio de consecuencias en el chat (default: sí).

### Niveles de automatización

1. **Datos** (sin código): Facultades, reservas, mejoras, estados, armas, journals. Jugable solo
   con esto, a mano como describen los docs.
2. **Asistido**: Tres Puertas, Quemar/Sobrecarga/Desgarro con registro, balizas, panel.
3. **Reactivo** (best effort): recordatorios automáticos tras un `1` de Desesperación. Depende
   de un hook que no distingue de qué ítem vino la tirada; se resuelve leyendo el título del
   mensaje de chat. Si el sistema cambia eso, el nivel 3 se degrada sin romper nada.

---

## 7. Estructura del repo y pipeline

```
module.json                 manifest (customEdges se generan desde content/caminos.json)
package.json                scripts: contenido, verificar, pack, unpack, release
src/module/*.mjs            código
src/styles/dvv.css
lang/es.json, lang/en.json
content/caminos.json        fuente única de los tres caminos
content/arsenal.json        fuente de armas y sets
content/reglas/*.md         los 5 documentos de reglas
content/cronica/*.md        la crónica
content/pnjs.json           fichas spc
packs-src/<pack>/*.json     generado por tools/ (commiteado, legible, con _key)
packs/                      LevelDB compilado — GITIGNORED
tools/construir-contenido.mjs   content/ → packs-src/ (+ module.json customEdges)
tools/verificar.mjs             ids únicos, _key, UUIDs resueltos, paths de dicepool válidos
docs/                       material fuente (PDF ignorado por git)
```

Packs en `module.json`: `reservas`, `mejoras`, `estados`, `rasgos`, `arsenal`, `reglas`,
`cronica` (solo GM), `pnjs` (solo GM), `macros`. Carpeta de compendios "Del Velo a la Vigilia".

Flujo: `npm run contenido` → `npm run verificar` → `npm run pack`. Release por GitHub Releases
(`manifest` fijo en `latest/download/module.json`, `download` fijado al tag). En Molten se
instala pegando la URL del manifest en *Add-on Modules → Install*.

---

## 8. Entorno de pruebas local

El Foundry local (v14.365) no tiene wod5e instalado. Para probar:

1. instalar wod5e en `~/.local/share/FoundryVTT/Data/systems/wod5e` desde su manifest oficial,
2. crear un mundo de prueba "dvv-test" con sistema wod5e,
3. enlazar el módulo: `ln -s <repo> ~/.local/share/FoundryVTT/Data/modules/del-velo-a-la-vigilia`,
4. una Célula con dos cazadores para probar Desesperación compartida.

---

## 9. Fases

| Fase | Entrega | Estado (2026-10-09) |
|---|---|---|
| 0 | esqueleto: manifest, pipeline, lang, entorno local con wod5e | ✓ hecho; probado en Foundry 14.365 + wod5e 5.3.28 |
| 1 | los Tres Caminos: `caminos.json`, customEdges, reservas, mejoras, estados, rasgos, journals de reglas, Tres Puertas, Quemar | ✓ hecho; 37 Facultades, 39 reservas, 46 mejoras, 15 estados, 3 defectos |
| 2 | Arsenal: ítems, journal, Equipar set | ✓ hecho; 23 armas, 7 equipo, 7 sets |
| 3 | Crónica: journals con botones, PNJs, balizas, panel del Narrador, pantalla | ✓ hecho; 9 journals, 8 PNJs, 4 plantillas de PJ |
| 4 | Escenas con mapa | ✓ hecho; 5 escenas desde planos vectoriales, mapas pintados (ver `MAPS_SPEC.md`) |
| 5 | Release 0.1.0 e instalación en Molten | pendiente: commit, tag `v0.1.0`, el workflow publica `module.json` + `module.zip`; instalar en Molten con la URL del manifest |

Prueba end-to-end: `npm run e2e` (ver README). Pendiente de mesa: retratos/tokens de PNJs y
tiles de muebles móviles (listados en la nota de cada escena).

---

## 10. Decisiones tomadas (2026-10-08)

1. **Granularidad de Facultades:** una Facultad por poder. Etiquetas con prefijo de camino:
   `[Imbuido] Hendir (Cleave)`, `[Gen II] Malla Subdérmica`.
2. **Marcos** es un vampiro joven; la Pantalla del Narrador se corrigió.
3. **Peligro:** el +1 por usar un poder ante testigos queda anotado en el registro de sesión;
   la setting *Subir el Peligro automáticamente* (apagada por defecto) lo aplica a la Célula.
4. **Plantillas de PJ:** incluidas (Guardia, Informático, Doctorando, Limpiador) en el
   compendio de personajes, con Credo, Determinación, set del Arsenal y camino probable.
5. **Escenas:** entran en el alcance inicial, con planos vectoriales (`content/planos/`) y el
   pipeline de mapas de La Cruzada Escarlata adaptado a estética moderna (`MAPS_SPEC.md`).
6. **Nombres:** los docs mandan en el contenido (Bordes, Artefactos, Modificaciones, Mejoras);
   la UI del sistema sigue diciendo Facultad/Beneficio.

## 11. Adaptaciones de reglas que el material no fijaba

- **Aguante** no existe como Habilidad en H5. Toda reserva que lo nombra usa **Atletismo** y lo
  anota en la descripción de la reserva.
- **Convicción** tampoco existe; *Resolución + Convicción* (Encrucijadas, Capilla) se tira como
  **Resolución + Ocultismo**.
- Hendir, Munición Tratada y Osteoinjerto no fijan reserva de ataque: se usa la estándar
  (Fuerza + Cuerpo a cuerpo; Destreza + Armas de fuego para la munición; Fuerza + Pelea para el
  Osteoinjerto).
- Las tiradas enfrentadas del objetivo no se cargan como reserva: se mencionan en la nota.
- Las cifras de los PNJs que la Pantalla no da (todos salvo Elías) y las fichas de los cuatro
  PJs son sugeridas y están marcadas como tales en sus notas.
- **Un «1» en Desesperación:** wod5e emite el hook antes de publicar el mensaje; el módulo espera
  el mensaje de la tirada (máx. 1,5 s) para reconocer la reserva. Si no la reconoce, publica el
  recordatorio genérico (Extralimitación / Desesperanza) sin la consecuencia del camino.
- **Despair y Bordes:** el sistema ya bloquea los dados de Desesperación en Desesperanza; el
  estado *Silencio de los Heraldos* es un marcador, no un modificador.
