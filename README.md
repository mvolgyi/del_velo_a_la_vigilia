# Del Velo a la Vigilia

Módulo de **Foundry VTT** para **Hunter: The Reckoning 5e** (Cazador: La Venganza) sobre el
sistema **wod5e**. Empaqueta las reglas caseras de los *tres caminos*, *El Arsenal de la Vigilia*
y la crónica *Somnia Biotech*, lista para dirigir.

| | |
|---|---|
| Sistema | wod5e ≥ 5.3.0 |
| Foundry | v14 (verificado en 14.365) |
| Idioma | español (etiquetas de Facultades también en inglés) |
| Estado | 0.1.0 — contenido completo (caminos, arsenal, crónica, PNJs, PJs, cinco escenas con mapa) |

## Qué trae

- **Los Tres Caminos.** 37 Facultades nuevas en la hoja del cazador: Bordes Imbuidos (Fe),
  Artefactos Iluminados (Método), Modificaciones Humanas (Carne) e Injertos de Segunda
  Generación. Cada poder con su reserva tirable, sus Mejoras como Beneficios, y los estados que
  activa (Silencio de los Heraldos, Artefacto quemado, Crisis de rechazo, injertos activos…).
- **Las Tres Puertas.** Diálogos para otorgar un camino (la pasiva gratis, el Defecto de 1 punto,
  la descripción en la hoja) y comprar poderes con su coste, incluido el límite de carne por
  Resistencia.
- **Desesperación y Peligro.** Quemar la Chispa / Sobrecarga / Desgarro con registro en el chat;
  registro de +1 Peligro de la sesión; recordatorio con botones cuando una tirada saca un «1» en
  dados de Desesperación.
- **El Arsenal de la Vigilia.** Armas y equipo como ítems, y una macro para equipar el set del
  Credo en un click.
- **Somnia Biotech.** La crónica completa en journals con botones de tirada y de balizas
  (Fe / Método / Carne), los PNJs como actores, cuatro plantillas de cazador, la Pantalla del
  Narrador y un panel con todo lo que la cronista tiene que llevar.

## Instalación

Desde Foundry → *Add-on Modules* → *Install Module* → pegar la URL del manifest:

```
https://github.com/mvolgyi/del_velo_a_la_vigilia/releases/latest/download/module.json
```

Activar el módulo en el mundo. Al entrar como Narrador, el módulo ofrece **importar la crónica
entera** (escenas, actores, journals y macros, con carpetas) en un click; también se puede hacer
después desde el compendio *Somnia Biotech — Importar la crónica* o con la macro del mismo nombre.
Reimportar actualiza sin duplicar. Los poderes, estados y el Arsenal quedan en sus compendios.
Después, abrí la macro **Somnia Biotech — Panel del Narrador**.

## Estructura del repositorio

```
module.json              manifest (las Facultades se generan desde content/caminos.json)
src/module/              código del módulo (ES modules, ApplicationV2)
src/styles/dvv.css       CSS, todo prefijado con `dvv-`
templates/               plantillas Handlebars
lang/                    es.json (primario), en.json; caminos-*.json se generan
content/                 FUENTE ÚNICA: caminos.json, estados.json, arsenal.json, pnjs.json,
                         pjs.json, reglas/*.md, cronica/*.md, planos/*.json
packs-src/               fuente versionable de los compendios (JSON generado, con _key)
packs/                   compendios compilados (LevelDB) — GITIGNORED
assets/mapas/            mapas de las escenas
tools/                   build: content/ → packs-src/, verificación, planos, release
docs/                    material fuente (el PDF del libro básico está ignorado por git)
```

**Los packs compilados nunca se commitean.** La fuente vive en `content/` y se compila con
`fvtt-cli`:

```bash
npm install
npm run contenido     # content/ → packs-src/ (+ module.json customEdges + lang/caminos-*.json)
npm run verificar     # _key, _id, assets
npm run pack          # todo lo anterior + compila los diez packs
```

Cambiar `module.json` exige reiniciar el servidor de Foundry; cambiar JS/CSS/plantillas, F5.

### Prueba end-to-end

Con un Foundry local corriendo el mundo `dvv-test` (wod5e instalado y el módulo enlazado en
`Data/modules`):

```bash
cd ~/FoundryVTT/app/resources/app && node main.js --port=30099 --noupnp --world=dvv-test
npm run e2e          # en otra terminal; capturas en tools/e2e/capturas/
```

Recorre el flujo completo (Facultades registradas, otorgar y comprar caminos, quemar, balizas,
Peligro, arsenal, recordatorio tras un «1», panel, hoja y journals) en un Chromium headless.

### Mapas

Los interiores se definen como planos vectoriales en `content/planos/*.json` (pies; 150 px por
casilla). De ahí salen el esquema, los muros, las puertas, las luces y las regiones de la escena.
Ver `MAPS_SPEC.md` y `tools/planos.mjs`.

```bash
npm run planos       # esquemas en assets/mapas/<id>.esquema.webp
npm run pintar       # repinta con el modelo (requiere GOOGE_AI_STUDIO_API_KEY en .env)
```

### Retratos y tokens de PNJs

Los prompts viven en `tools/arte.config.json` (estilos `retrato` y `token`). El token se genera
cenital sobre fondo chroma y se recorta a círculo con anillo:

```bash
node tools/generar-arte.mjs            # retratos → assets/retratos/, crudos → assets/tokens-crudo/
npm run tokens                         # recorte → assets/tokens/<id>.webp
npm run contenido                      # las fichas toman retrato y token si existen
```

## Cómo funciona por dentro (wod5e)

- Las **Facultades** de wod5e no son ítems: son un registro que este módulo extiende con
  `flags.wod5e.customEdges` en `module.json`. Lo que sí son ítems son las **reservas**
  (`edgepool`, lo que se tira) y las **Mejoras** (`perk`). Por eso cada poder es una Facultad
  propia: así tiene su reserva y sus Mejoras colgadas.
- La descripción de una Facultad vive en el actor. *Las Tres Puertas* la escribe al otorgar el
  poder, y si alguien arrastra una reserva o mejora desde el compendio, el módulo la completa.
- La **Desesperación** vive en la Célula (actor de grupo) y el sistema la propaga a los
  miembros. Quemar / Sobrecarga / Desgarro la bajan ahí.
- Los **estados** son ítems `condition` con modificadores por selector; los que afectan a un
  camino entero usan `edges.dvv-<prefijo>-<poder>` para cada poder del camino.
- Tras cada tirada el sistema emite `wod5e.handleFailure` con los dados de Desesperación; el
  módulo espera el mensaje de la tirada para saber de qué reserva vino y publica el recordatorio.

## Marcadores en los Markdown de `content/`

```
@tirada{attributes.composure+attributes.resolve|2|Compostura + Resolución}   botón de tirada
⚑{fe|+1|Crítico al mirar a Marcos}                                            botón de baliza
@npc{marcos} · @npc{marcos|el vampiro}                                        enlace al actor
@item{molotov|Molotov}                                                        enlace al ítem
:::leer … :::                                                                  leer en voz alta
```

## Decisiones de adaptación

- **Aguante** no existe como Habilidad en H5; las reservas que lo nombran usan Atletismo y lo
  anotan en la descripción.
- **Convicción** tampoco: *Resolución + Convicción* se tira como Resolución + Ocultismo.
- **Marcos** es un vampiro joven (la Pantalla del Narrador lo llamaba ghoul).
- El **+1 de Peligro** por usar un poder ante testigos queda anotado para el fin de sesión; una
  setting lo sube a la Célula automáticamente si se prefiere.

## Licencia

El código y el material propio van bajo la licencia del repositorio. *Hunter: The Reckoning* y
*World of Darkness* son marcas de Paradox Interactive; el libro básico no se incluye.
