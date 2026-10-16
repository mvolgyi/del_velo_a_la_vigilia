---
escena: laboratorio-satelite
prefijo: F
nombre: Martiricos — la torre y el laboratorio satélite
intro: La escena de «Seguir a Salas» (Acto 2). Dos plantas de la misma torre junto al Guadalmedina. Abajo, el vestíbulo con los tornos y Rafa, el vigilante. Arriba, en la planta 6, el laboratorio que una sociedad pantalla alquila para Somnia, donde la Dra. Salas refina el Compuesto A y agenda las cirugías. El Informático anula las alarmas; el Doctorando sabe qué buscar.
---

# F1. Vestíbulo {sala: Vestíbulo}
tokens: rafa-vigilante

:::leer
Mármol claro, un ficus de plástico y una pantalla que repite el logo de una gestoría. Detrás del mostrador, un vigilante de unos sesenta años resuelve un crucigrama con la radio bajita. Entre él y los ascensores, tres tornos de cristal con lector de tarjeta, encendidos en verde.
:::

**Qué hay.** La entrada principal de la torre, con cámara sobre la puerta y otra sobre los tornos. Rafa tiene la lista de visitas de la noche: los martes y viernes aparece "Laboratorios Aldaia, planta 6", que es Somnia con otro nombre. Detrás del mostrador cuelga un tablero con tarjetas de proveedor.

**Qué pasa.** Pasar por los tornos sin tarjeta: @tirada{attributes.dexterity+skills.larceny|2|Destreza + Latrocinio (dif. 2)} o una excusa a Rafa con @tirada{attributes.manipulation+skills.subterfuge|2|Manipulación + Subterfugio (dif. 2)}. @npc{rafa-vigilante|Rafa} no es enemigo: si lo tratan bien, avisa por radio cuando "la doctora" baja. Una tarjeta de proveedor del tablero abre la puerta de la esclusa de arriba (F5).

**Para el Narrador.** El ascensor y la escalera llevan a la planta 6 (regiones). Si la célula entra por la puerta de emergencia del río, Rafa no se entera de nada.

# F2. Ascensores {sala: Ascensores}

:::leer
Dos puertas de acero cepillado con el panel iluminado. Uno de los dos ascensores tiene el botón del 6 tapado con cinta: "solo con llave".
:::

**Qué hay.** El ascensor sube a la planta 6 solo con la llave o la tarjeta de Salas. Sin ella, hay que forzar el panel: @tirada{attributes.intelligence+skills.technology|2|Inteligencia + Tecnología (dif. 2)}. Cada viaje queda en el registro del edificio.

# F3. Escalera de emergencia {sala: Escalera de emergencia (planta baja)}

:::leer
Hormigón pintado de gris, un pasamanos frío y una puerta con barra antipánico que da al paseo del río. La luz se enciende con un sensor de movimiento, con un segundo de retraso.
:::

**Qué hay.** La puerta del río no tiene cámara y la alarma de apertura está cableada al panel del vestíbulo. Anularla antes de abrir: @tirada{attributes.intelligence+skills.technology|2|Inteligencia + Tecnología (dif. 2)}; si no, suena en el mostrador de Rafa. Seis tramos de escalera hasta la planta 6.

**Qué pasa.** Es la ruta de la infiltración: @tirada{attributes.dexterity+skills.stealth|3|Destreza + Sigilo (dif. 3)} para subir sin que el sensor de luz de cada rellano los delate ante la cámara del pasillo de arriba.

# F4. Rellano de la planta 6 {sala: Rellano de la planta 6}

:::leer
El rellano huele a desinfectante y a algo dulce debajo. La única luz es el cartel verde de salida. Una puerta blanca sin nombre, con un lector de tarjeta que parpadea en rojo.
:::

**Qué hay.** La llegada desde el ascensor y la escalera. La puerta de la esclusa (F5) pide tarjeta. Una cámara pequeña sobre el marco graba a quien espere aquí.

# F5. Esclusa {sala: Esclusa}

:::leer
Un cuarto estrecho de azulejo blanco con taquillas, batas colgadas y un lavamanos que se acciona con la rodilla. En la pared, un cartel plastificado con el protocolo de lavado.
:::

**Qué hay.** Batas, guantes, mascarillas y calzas. Ponérselas hace que una cámara los tome por personal de noche. En una taquilla sin candado, la bata de Salas con su credencial de la clínica en el bolsillo.

**Qué pasa.** Abrir la puerta del rellano sin tarjeta: @tirada{attributes.intelligence+skills.technology|2|Inteligencia + Tecnología (dif. 2)} (el Informático) o @tirada{attributes.dexterity+skills.larceny|3|Destreza + Latrocinio (dif. 3)}.

# F6. Sala de técnicos {sala: Sala de técnicos}

:::leer
Tres escritorios con los monitores apagados, tazas con restos de café y un calendario de una distribuidora farmacéutica. En la cocinita, la cafetera tiene la luz roja encendida: alguien la dejó prendida.
:::

**Qué hay.** Los puestos de los técnicos que trabajan de día y no saben para quién. En un cajón, un listado de pedidos con cantidades de anticoagulante que no tienen sentido para un laboratorio de análisis. Entender por qué: @tirada{attributes.intelligence+skills.medicine|2|Inteligencia + Medicina (dif. 2)}.

# F7. Pasillo del laboratorio {sala: Pasillo del laboratorio}

:::leer
Un pasillo largo de linóleo con puertas a los dos lados. Al fondo, una cámara domo con el piloto encendido. Del otro lado de una puerta de vidrio esmerilado, el resplandor rojizo de una heladera.
:::

**Qué hay.** La cámara del fondo graba todo el pasillo y está conectada a los servidores (F9), no al edificio. Si el Informático la congela desde la sala de servidores, el pasillo es libre.

# F8. Laboratorio {sala: Laboratorio}

:::leer
Mesas de trabajo con microscopios, pipetas y gradillas de tubos. Una campana de extracción zumba. Contra la pared, una heladera de puerta de vidrio llena de viales con un líquido oscuro, casi negro, que brilla un poco cuando le da la luz.
:::

**Qué hay.** Donde se refina el Compuesto A. Los viales de la heladera son la producción de la semana. En la mesa de la isla, un cuaderno de protocolo con anotaciones a mano de Salas: dosis, tiempos y "pérdidas".

**Qué pasa.** Llevarse viales es posible, pero cada uno que falta se nota al día siguiente. Entender el protocolo: @tirada{attributes.intelligence+skills.science|2|Inteligencia + Ciencia (dif. 2)} (el Doctorando): con éxito, sabe qué cuadernos de F11 importan y no pierde tiempo allí.

# F9. Sala de servidores {sala: Sala de servidores}

:::leer
Dos racks a máxima potencia, un ruido de ventiladores que tapa todo lo demás y un aire acondicionado que gotea. Una consola con la pantalla bloqueada.
:::

**Qué hay.** Las cámaras de la planta, el control de acceso y la copia de seguridad de los datos de los ensayos. La puerta está trabada.

**Qué pasa.** Congelar las cámaras: @tirada{attributes.intelligence+skills.technology|2|Inteligencia + Tecnología (dif. 2)}. Copiar los datos de los voluntarios: @tirada{attributes.intelligence+skills.technology|3|Inteligencia + Tecnología (dif. 3)}; con éxito, la célula tiene los nombres de los durmientes. Un fallo dispara una alerta que llega al teléfono de Salas.

# F10. Cámara fría {sala: Cámara fría}

:::leer
El frío pega en la cara. Puertas de congelador de acero, estantes con neveras portátiles y bolsas de sangre etiquetadas con números, no con nombres.
:::

**Qué hay.** La materia prima: sangre de los voluntarios del ensayo, clasificada por "lote". Una de las neveras portátiles lleva una etiqueta con la cruz del convento. Quien la abra sabe de dónde sale el Compuesto A: @tirada{attributes.resolve+skills.occult|2|Resolución + Ocultismo (dif. 2)} para mirar sin quebrarse.

# F11. Despacho de Salas {sala: Despacho de Salas}
tokens: dra-salas (oculto)

:::leer
Un despacho con moqueta gris, estanterías de revistas médicas y una pizarra llena de fórmulas. Sobre el escritorio, una pila de cuadernos de tapa negra, una laptop cerrada y una hoja impresa con una tabla de fechas y nombres. La lámpara de escritorio está encendida.
:::

**Qué hay.** Los **cuadernos del Compuesto A**: el objetivo de la infiltración. La hoja impresa es la **agenda de cirugías clandestinas**, con una columna que dice "Quimera" junto a varios nombres. La puerta está trabada con llave.

**Qué pasa.** Abrir la puerta: @tirada{attributes.dexterity+skills.larceny|2|Destreza + Latrocinio (dif. 2)}. Llevarse los cuadernos sin dejar rastro: ⚑{metodo|+1|Robar los cuadernos del Compuesto A}. Con un crítico en la infiltración, la célula se lleva también la agenda: la palabra "@npc{quimera-suelta|Quimera}" entra en juego. Si la @npc{dra-salas|Dra. Salas} está esta noche, está acá (token oculto): revelala cuando abran la puerta.

**Para el Narrador.** Si los detectan, esa misma noche @npc{marcos} visita el piso de Elías.

# F12. Sala de procedimientos {sala: Sala de procedimientos}

:::leer
Azulejo blanco, una camilla quirúrgica bajo una lámpara enorme apagada, una máquina de anestesia con la pantalla en negro. El carro de instrumental todavía tiene una gasa con sangre seca. Huele a lejía, y no alcanza.
:::

**Qué hay.** Aquí se hacen las "cirugías" de la agenda: implantes de continuidad en voluntarios. En el cubo de residuos, una pulsera de Somnia cortada con el número de un ensayo.

**Qué pasa.** Reconocer qué se operó aquí: @tirada{attributes.intelligence+skills.medicine|2|Inteligencia + Medicina (dif. 2)}. Es la puerta de entrada a la Carne: quien se quede mirando la camilla demasiado tiempo entiende que podría tumbarse en ella.
