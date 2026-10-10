---
escena: cripta
prefijo: E
nombre: La cripta del relicario
intro: La cripta medieval bajo el convento desconsagrado, donde Somnia Biotech alimenta a Sor Anunciación con el plasma de los durmientes (Acto 3). Se baja de noche, desde la sacristía o desde la planta vieja de la clínica, y se sale al amanecer o no se sale.
---

# E1. Escalera del convento {sala: Escalera del convento}

:::leer
Los peldaños de piedra bajan en curva, gastados en el centro por siglos de pies. Un cirio en un hueco de la pared tiembla con la corriente que sube desde abajo. El aire es frío y espeso, y trae algo que no debería estar en una cripta: olor a alcohol de hospital.
:::

**Qué hay.** La escalera que sube a la sacristía del convento (transición a la escena del convento, sala D3) y un cirio encendido, cambiado esta misma noche. La barra de hierro que traba la puerta de arriba cuelga de sus ganchos: quien baje por acá debe decidir si la deja puesta o la saca para tener una salida rápida.

**Qué pasa.** Si la célula entra por el convento, este es el punto de partida del Descenso. El Limpiador sabe qué peldaños crujen: guiar al grupo en silencio es @tirada{attributes.dexterity+skills.stealth|2|Destreza + Sigilo (dif. 2)} por cabeza, o una sola tirada suya con @tirada{attributes.wits+skills.awareness|2|Astucia + Consciencia (dif. 2)} si los demás pisan donde él pisa. Un fallo alerta a los @npc{ghoul-somnia|ghouls} de la antecámara (E2).

**Para el Narrador.** Si sacaron la barra, la escalera sirve de segunda vía de escape en el Acto 3, pero no lleva al amanecer: lleva a un convento cerrado de noche, con el auto de los matones en la esquina. La huida canónica es por el pasillo lateral (E6).

# E2. Antecámara {sala: Antecámara}
tokens: ghoul-somnia x2

:::leer
Una sala baja de piedra húmeda, con nichos de enterramiento abiertos en las paredes como bocas negras. Un cirio arde en el suelo, junto a una silla plegable y un termo. Más allá, entre columnas, se adivina un resplandor frío y azulado, y el pitido lento de un monitor médico.
:::

**Qué hay.** Cinco nichos de enterramiento, la mayoría vacíos o con huesos revueltos. Dos @npc{ghoul-somnia|ghouls} con ambos de enfermero hacen guardia: uno sentado jugando con el celular, el otro de pie, fumando. Llevan una radio de mano que conecta con la seguridad de Somnia. Quitarle la radio a uno permite al Informático escuchar la frecuencia de la clínica con @tirada{attributes.intelligence+skills.technology|2|Inteligencia + Tecnología (dif. 2)}, y saber cuándo baja @npc{marcos}.

**Qué pasa.** Si los ghouls no fueron alertados, se los puede sorprender: @tirada{attributes.dexterity+skills.stealth|3|Destreza + Sigilo (dif. 3)} para acercarse sin ser vistos. Pelean sin miedo pero sin convicción; si uno cae, el otro intenta usar la radio. Si la radio suena, Marcos llega en tres turnos. Un cuchillo, una barra o un @item{taser|táser} alcanzan contra ellos; no hace falta fuego.

**Para el Narrador.** Uno de los ghouls tiene en el bolsillo la llave de la cerradura de la puerta de piedra de la sacristía. Si la célula planea volver alguna vez al convento, esa llave vale oro.

# E3. Osario {sala: Osario}
tokens: marcos (oculto)

:::leer
Los nichos de esta sala están llenos hasta el techo de huesos: cráneos apilados, fémures cruzados como leña. El olor es seco, de polvo antiguo. Y en un rincón, debajo de todo eso, algo que no tiene siglos: una mochila de lona verde, con un parche de un club de fútbol.
:::

**Qué hay.** Cuatro nichos del osario medieval y, mezclados con los huesos viejos, los restos de la célula del garaje de Huelin: cuatro esqueletos con jirones de ropa moderna, una zapatilla, un reloj. La mochila es de Mara. Adentro hay un aparato a medio terminar, una lente montada en un tubo con cables, el mismo que aparece dibujado en su cuaderno. Revisar los restos con calma (@tirada{attributes.intelligence+skills.medicine|2|Inteligencia + Medicina (dif. 2)}) muestra que no los mataron peleando: los dejaron desangrarse. Un fémur sirve como @item{improvisada-liviana|arma improvisada}.

**Qué pasa.** @npc{marcos} espera acá, entre los huesos, desde antes de que ellos bajaran: los olió en la escalera y prefiere cazarlos que avisarle a nadie. Irrumpe desde las sombras cuando la célula empieza a desconectar a los durmientes en la cámara (E4), o antes si alguien se demora en el osario. Llevarse la mochila de Mara da ⚑{metodo|+1|Recuperar el aparato de Mara}.

**Para el Narrador.** Si Elías bajó con ellos, ver los restos de sus amigos es el detonante de su gesto más adelante. Dale un momento en silencio antes de que Marcos aparezca.

# E4. Cámara del relicario {sala: Cámara del relicario}
tokens: sor-anunciacion (oculto), durmiente x6

:::leer
La cámara es una nave de piedra románica sostenida por cuatro columnas achaparradas. En el centro, un relicario enorme de piedra y bronce, con una cruz tallada en la tapa, brilla con una luz fría que no viene de ninguna lámpara. A su alrededor, seis camillas de hospital. Seis personas dormidas, pálidas como la cera, con vías en los brazos. Los tubos corren por el suelo y se pierden, todos, dentro del relicario.
:::

**Qué hay.** Los seis @npc{durmiente|durmientes}, conectados por vías que bombean su plasma hacia el relicario donde yace @npc{sor-anunciacion|Sor Anunciación}. Los tubos se pueden cortar; las columnas y los nichos dan cobertura. Desconectar a un durmiente sin provocarle un shock pide @tirada{attributes.intelligence+skills.medicine|2|Inteligencia + Medicina (dif. 2)}: el Doctorando es quien entiende lo que está viendo.

**Qué pasa.** Al tercer durmiente desconectado, Marcos irrumpe desde el osario (ver su diálogo en *Dramatis personae*). La pelea es frenética, en un espacio cerrado y lleno de equipo frágil. Si el combate se alarga o alguien toca el relicario, Sor Anunciación despierta y se incorpora. En el peor momento, @npc{elias-roca|Elías} se interpone y grita a un cielo que lleva nueve años mudo: vos decidís si los Heraldos responden. Con Elías caído, la Encrucijada III: protegerse unos a otros sin chance y sacar un crítico con dados de Desesperación da ⚑{fe|+1|El Destello: baliza definitiva de Imbuido}; sobrevivir a heridas mortales con el Compuesto A en las venas da ⚑{carne|+1|La Marca: baliza definitiva de Quimera}.

**Para el Narrador.** Sor Anunciación no es un combate: es una fuerza de la naturaleza. Ofrecé su trato monstruoso antes de que la mesa se suicide.

# E5. Laboratorio improvisado {sala: Laboratorio improvisado}
tokens: dra-salas (oculto)

:::leer
Detrás de una arcada baja, la Edad Media termina de golpe. Un banco de trabajo de acero con centrífugas y una notebook abierta, una heladera de plasma que zumba, estanterías con bolsas de sangre etiquetadas y un carro con instrumental quirúrgico. Una lámpara de escritorio ilumina todo con luz blanca, clínica, obscena.
:::

**Qué hay.** La mesa de la @npc{dra-salas|Dra. Salas}: la notebook conectada a un disco duro externo con toda la investigación del Compuesto A y, en la heladera, una gradilla con los viales restantes del Compuesto A. En el estante, alcohol, éter y oxígeno: material para convertir el laboratorio en una hoguera con un @item{molotov|molotov} o un encendedor. En el carro, bisturíes (@item{cuchillo|cuchillo}) y jeringas de adrenalina que, con @tirada{attributes.intelligence+skills.medicine|2|Inteligencia + Medicina (dif. 2)}, ponen de pie a un PJ que acaba de caer.

**Qué pasa.** Salas está escondida detrás de la heladera. No pelea: si la descubren, levanta las manos, negocia y, si puede, huye por el pasillo lateral. En la huida, alguien elige: tienen cinco segundos frente a esta mesa. Salvar el disco duro da ⚑{metodo|+1|Salvar el disco duro de Salas}; salvar los viales da ⚑{carne|+1|Salvar los viales del Compuesto A}. Lo que quede, arde.

**Para el Narrador.** Si la célula deja escapar a Salas, ella vuelve en el Epílogo con su maletín y su oferta cruel. Si la entregan o la matan, esa puerta de la Carne se cierra.

# E6. Pasillo lateral {sala: Pasillo lateral}

:::leer
Una puerta de piedra, gruesa como un muro, gira sobre un eje de hierro y deja ver un pasillo estrecho que sube. Al fondo, muy lejos, se ve el resplandor rojizo de una luz de emergencia y se oye el zumbido de la planta vieja de Somnia. El aire que baja huele, por fin, a calle.
:::

**Qué hay.** El pasillo medieval que unía la cripta con el antiguo hospital de la orden y que hoy sube a la planta vieja de Somnia Biotech, y de ahí al muelle de carga (transición a la escena de la planta vieja). La puerta de piedra se abre hacia la cámara y se puede trabar con el cuerpo desde este lado.

**Qué pasa.** Es la vía de la huida al amanecer, con sus tres costos obligatorios. **Alguien sostiene:** un PJ se queda un turno extra bloqueando la puerta de piedra para que Marcos o los ghouls no pasen; pide @tirada{attributes.strength+skills.athletics|3|Fuerza + Atletismo (dif. 3)} y el resto de su Voluntad. **Alguien carga:** otro PJ carga a pulso a un durmiente desconectado por la escalera hasta la calle, con @tirada{attributes.stamina+skills.athletics|0|Resistencia + Atletismo}. **Alguien elige:** ver E5. Salen a tropiezos por la puerta trasera de Somnia justo cuando los primeros rayos del sol golpean el asfalto.

**Para el Narrador.** Si la célula entró por Somnia, este pasillo también fue su entrada: el Informático habrá aislado el rack de la planta vieja para cortar alarmas y cámaras. Si no lo hizo, al subir los espera un @npc{maton-somnia|matón} de turno en el muelle.
