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

```bash
node tools/e2e/capturas-escenas.mjs [--solo <texto>] [--jugador]   # tools/e2e/capturas/escenas/*.png
```

Captura cada escena tal como la dibuja Foundry (luces, tiles, tokens, pines, regiones) para
revisarla a ojo antes de una release. Es el control que vale: una composición hecha con
ImageMagick no sabe cómo interpreta Foundry los datos (dónde ancla un tile, qué tapa un pin).

### Mapas

Los interiores se definen como planos vectoriales en `content/planos/*.json` (pies; 150 px por
casilla). De ahí salen el esquema, los muros, las puertas, las luces y las regiones de la escena.
Ver `MAPS_SPEC.md` y `tools/planos.mjs`.

```bash
npm run planos       # esquemas en assets/mapas/<id>.esquema.webp
npm run pintar       # repinta con el modelo (requiere GOOGE_AI_STUDIO_API_KEY en .env)
```

### Música y ambientes

Las pistas se describen en `content/musica.json` y se generan con Lyria 3 (Gemini API):

```bash
npm run musica                         # assets/music/<id>.mp3 (las propias, con `archivo`, no se tocan)
npm run contenido                      # lista de reproducción + ambiente enlazado a cada escena
```

Cada pista nueva que se repite sale ya en bucle: `tools/bucle.mjs` corta la intro y el fundido
que Lyria agrega, ajusta el largo a compases enteros y funde la cola sobre la cabeza. Las
manzanas de Málaga buscan su pista con `"escena": "sector:<id>"`; si no tienen, suena la noche
de Málaga. Para rehacer el bucle de un archivo a mano: `node tools/bucle.mjs assets/music/<id>.mp3`.

### Tiles de muebles móviles

Sillas, sofás, mesas, carros, palets y tubos no se pintan en el mapa: van como tiles que el
Narrador puede mover. Cada mueble móvil del plano nombra su `tile` y hacia dónde mira (`hacia`):

```bash
node tools/generar-arte.mjs --estilo tile   # objeto cenital sobre verde → assets/tiles-crudo/
npm run tiles                               # recorte con alfa → assets/tiles/<id>.webp
npm run contenido                           # cada escena coloca sus tiles, rotados y desbloqueados
```

### Retratos y tokens de PNJs

Los prompts viven en `tools/arte.config.json` (estilos `retrato` y `token`). El token se genera
cenital sobre fondo chroma y se recorta a círculo con anillo:

```bash
node tools/generar-arte.mjs            # retratos → assets/retratos/, crudos → assets/tokens-crudo/
npm run tokens                         # recorte → assets/tokens/<id>.webp
npm run contenido                      # las fichas toman retrato y token si existen
```

### La Guía del Narrador (`guia/`)

Una página local con toda la crónica: visión general, los cuatro cazadores, los PNJs con sus
diálogos, los actos escena por escena, las escenas sala por sala, Málaga con sus manzanas y
lugares, la pantalla y las reglas caseras. Se abre con doble clic en `guia/index.html`, sin
internet y sin nada al lado: es un solo archivo con el CSS, el JS, las fuentes y las imágenes
embebidas (un navegador Flatpak abre el archivo por el portal y no ve la carpeta), y guarda el
seguimiento de la partida (escenas hechas, Desesperación, Peligro, balizas, notas) en el
navegador, con exportación a un archivo. Va dentro del zip de la release.

```bash
node tools/generar-arte.mjs --estilo credo   # fotos de los cinco Credos → assets/credos-crudo/
npm run duotono                              # retratos, mapas y Credos en naranja → assets/guia/
npm run guia                                 # content/ → guia/index.html
```

Toda la guía sigue el patrón de la web de World of Darkness: fondo negro y bandas de mitad texto y
mitad foto tratada en naranja y negro (`npm run duotono`: retratos, mapas, portada y Credos) con el
nombre encima en mayúsculas gigantes. Cada Credo lleva el arquetipo de la crónica que lo encarna;
cada PNJ, cada acto y cada escena abren con su banda.

### Visión, linterna y Lente Espectral

Los tokens de cazador ven a tientas hasta 3 m (penumbra gris) y, más allá, solo lo que alumbra
una luz de la escena. En el HUD del token hay dos botones: **Linterna** (una luz de 5 m fuertes y
10 m tenues sobre el token; el Narrador puede encenderla a cualquier PNJ) y, solo para quien tiene
la Facultad, **Lente Espectral** (visión nocturna de Foundry a 20 m, en monocromo). También desde
macros: `game.modules.get("del-velo-a-la-vigilia").api.linterna(token)` y `.lenteEspectral(token)`.

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

## Salas y puntos de interés

`content/salas/<escena>.md` describe cada habitación de una escena (una sección `# A1. Nombre
{sala: Nombre del plano}` por habitación, con texto para leer, qué hay y qué pasa). El build
genera un journal por escena, un **pin numerado** por sala en el mapa que abre su página, y los
**tokens** de PNJ declarados en la línea `tokens: marcos, durmiente x6, dra-salas (oculto)`.

`content/malaga/` tiene `pois.json` (puntos de interés con coordenadas), `geo.json` (escala del
mapa, lo escribe `tools/malaga-mapa.mjs` al renderizar OpenStreetMap) y un Markdown por punto.
El build genera la escena «Málaga» con un pin por punto y el journal de la ciudad.

### Sectores caminables

`content/sectores.json` define manzanas de 80×60 m (1 m = 50 px). `npm run sectores` genera desde
la caché de OpenStreetMap (`cache/osm/`, se baja con `tools/malaga-mapa.py --descargar`) el
esquema, los muros, las puertas, las farolas y las regiones de cada sector
(`content/sectores/geo/<id>.json`); `npm run pintar:sectores` los repinta con el modelo. Las
páginas van en `content/sectores/<id>.md`. En Foundry, un token que entra en la zona de un sector
en el mapa de Málaga aparece en su calle; el borde del sector devuelve a la ciudad; la puerta de
cada lugar lleva a su interior y viceversa.

### Vehículos

`content/vehiculos.json` define los vehículos (plazas, estructura, maniobra, blindaje, dónde
están aparcados). Son actores con token cenital de 2×4 m; en el mapa general se achican solos a un
marcador. En el HUD del token del vehículo hay dos botones: **Subir** (los tokens seleccionados o
los que estén al lado desaparecen y quedan dentro) y **Bajar** (vuelven a aparecer alrededor).
Los pasajeros viajan con el coche por las regiones de teletransporte. Reglas de conducción y
persecución en el journal *Vehículos y persecuciones*.

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
