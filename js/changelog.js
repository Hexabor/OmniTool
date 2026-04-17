const CHANGELOG = [
    {
        date: '17/04/2026',
        version: 'v1.0',
        tag: 'ÚLTIMA',
        entries: [
            { type: 'new', text: 'Garantías — nuevo módulo para llevar el control de cada cobertura' },
            { type: 'new', text: 'Estados: Pedido → Recibido → Entregado → Cerrado, con Fallido como vía paralela' },
            { type: 'new', text: 'Filtros por estado con conteos en vivo + búsqueda por UMID, Box ID o Box Name' },
            { type: 'new', text: 'Tabla ordenable por cualquier columna (especial atención a fechas)' },
            { type: 'new', text: 'Aviso visual: las garantías en estado Pedido con ≥ 7 días se resaltan en ámbar' },
            { type: 'new', text: 'Panel lateral con acciones por estado (recibir, entregar, procesar RMA/RTO)' },
            { type: 'new', text: 'Registro de llamadas al cliente con fecha/hora editable y resultado de contacto' },
            { type: 'new', text: 'Garantías fallidas: botón "Generar nuevo intento" que enlaza con la original' },
            { type: 'new', text: 'Tienda origen como dropdown con las 69 tiendas para futuras estadísticas' },
            { type: 'ui', text: 'Botón Garantías colocado a la derecha de Xfer Reg en home y sidebar' },
            { type: 'ui', text: 'Tabla optimizada para monitor vertical: UMID y Box ID son iconos de copiar al portapapeles' },
            { type: 'new', text: 'Sección Defectuoso ampliada: descripción del defecto, fecha de venta, tipo (RMA Externa/Interna o RTO), tienda destino, investigado por' },
            { type: 'ui', text: 'Acción "Cerrar caso" sustituye a "Procesar defectuoso", con fecha y responsable de cierre' },
            { type: 'new', text: 'Inspector de garantía con dos disposiciones: lateral (monitor horizontal) o inferior (monitor vertical), recordada por navegador' },
            { type: 'new', text: 'Panel inferior redimensionable: arrastra el borde superior para ajustar el alto (también se recuerda por ordenador)' },
            { type: 'ui', text: 'Panel inferior en modo tarjetas: secciones distribuidas en columnas para aprovechar el ancho y reducir scroll' },
            { type: 'ui', text: 'Formato de fechas unificado en DD/MM/AAAA y hora en 24h en toda la aplicación' },
            { type: 'new', text: 'Calendarios en lunes-primero y formato 24h en Garantías (flatpickr con locale español, independiente del SO)' },
            { type: 'fix', text: 'Panel inferior: la tarjeta en edición se expande al ancho completo y los inputs se adaptan sin desbordar' },
            { type: 'ui', text: 'Al editar una tarjeta, ésta sube al top del panel para que el formulario quede siempre a la vista' },
            { type: 'ui', text: 'Iconos de comentarios y llamadas unificados en SVG line-icon minimalista (ya no emojis)' },
            { type: 'new', text: 'Botones de copiar UMID / Box ID se resaltan en rojo si falta uno de los dos en la línea' },
            { type: 'new', text: 'Sincronización entre dispositivos: los cambios de otros usuarios de la misma tienda se traen al volver a la pestaña, al abrir una garantía, o con el botón manual de refrescar' },
        ]
    },
    {
        date: '14/04/2026',
        version: 'v0.9',
        entries: [
            { type: 'new', text: 'Backup local: descarga y restaura el estado completo como JSON' },
            { type: 'new', text: 'Revisión: % de coste en todas las tablas (tipo incorrecto, justificados, pendientes)' },
            { type: 'new', text: 'Revisión: envíos no solicitados agrupados por tipo, RMA Stock Out expandible' },
            { type: 'ui', text: 'Revisión: "Enviado XFER" ahora muestra % por coste descontando justificados' },
            { type: 'new', text: 'Imprimir "Buscando no encontrado" desde Resumen y Revisión (con categoría y %)' },
            { type: 'new', text: 'Ordenar: tercer modo "Estado" — agrupa por estado, colapsado, expandible' },
            { type: 'fix', text: 'Keys de estado estables — los estados ya no bailan al cambiar de vista' },
            { type: 'fix', text: 'Migración automática de estados guardados al nuevo formato de keys' },
            { type: 'ui', text: 'Vista Estado: tiendas ordenadas por peso (mayor coste primero)' },
            { type: 'ui', text: 'Impresión en vista Estado: solo el grupo desplegado, con cabecera' },
            { type: 'fix', text: 'Grupos de estado ya no se colapsan solos (snapshot Firestore controlado)' },
            { type: 'new', text: 'Archivo semanal: archivar xfer con nombre editable (ej: "Xfer Reg WK15 2026")' },
            { type: 'new', text: 'Panel de Archivo: recuperar o eliminar xfers archivados con resumen de stats' },
            { type: 'ui', text: 'Botón Ordenar: switch horizontal de 3 posiciones, nombre dinámico' },
            { type: 'ui', text: 'Botones Archivar/Archivo apilados en azul junto a la botonera principal' },
            { type: 'ui', text: 'Eliminar archivo protegido: doble confirmación + contraseña de tienda' },
        ]
    },
    {
        date: '11/04/2026',
        version: 'v0.8',
        entries: [
            { type: 'ui', text: 'Dropbox y barra de progreso integrados en un único marco' },
            { type: 'ui', text: 'Dropbox se transforma al cargar archivo (Clark Kent / Superman)' },
            { type: 'ui', text: 'Botones renombrados: Resumen, Revisión, Imprimir, Ordenar' },
            { type: 'new', text: 'Botón Ordenar: alterna entre vista por Secciones (C/H/S) y por Tiendas' },
            { type: 'new', text: 'Tooltips de ayuda en botones Resumen y Revisión (hover sobre ?)' },
            { type: 'new', text: 'Enlace a Looker Studio en tooltip de Revisión' },
            { type: 'ui', text: 'Columna Unit Cost oculta (pantalla e impresión)' },
            { type: 'ui', text: 'Botones con tamaño uniforme, layout responsive con wrap' },
            { type: 'ui', text: 'Header sticky: barra de progreso y botones fijos al hacer scroll' },
            { type: 'fix', text: 'Reducido padding superior del contenido' },
            { type: 'ui', text: 'Home: módulos deshabilitados muestran solo "Próximamente" como subtítulo' },
            { type: 'fix', text: 'Estado de línea puede revertirse a vacío (—)' },
            { type: 'new', text: 'Resumen: botón para copiar BoxIDs por estado de descuento' },
            { type: 'fix', text: 'Tooltip de Revisión: enlace a Looker Studio clicable (pin con click)' },
        ]
    },
    {
        date: '10/04/2026',
        version: 'v0.7',
        entries: [
            { type: 'ui', text: 'Título del módulo activo centrado en la barra superior' },
            { type: 'new', text: 'Barra de progreso de fulfilment en el header del módulo Xfer Reg — se actualiza en tiempo real' },
            { type: 'ui', text: 'Header reestructurado: dropbox e info a la izquierda, progreso en el centro, botones a la derecha' },
            { type: 'ui', text: 'Botones Análisis y Comprobador del mismo tamaño' },
        ]
    },
    {
        date: '10/04/2026',
        version: 'v0.6',
        entries: [
            { type: 'new', text: 'Xfer Reg — Comprobador de envíos: cruza Stock Transfers con Xfer Reg' },
            { type: 'new', text: 'Comprobador — % real de envíos XFER Regular Transfer Out' },
            { type: 'new', text: 'Comprobador — detecta envíos con tipo incorrecto (S/R, RMA, etc.)' },
            { type: 'new', text: 'Comprobador — items justificados por estado (Printed cover, Vendido, etc.)' },
            { type: 'new', text: 'Comprobador — items pendientes con detección de sustitutos similares' },
            { type: 'new', text: 'Comprobador — envíos no solicitados (artículos extra)' },
            { type: 'new', text: 'Comprobador — manejo de encoding mojibake en nombres de tienda' },
        ]
    },
    {
        date: '10/04/2026',
        version: 'v0.5',
        entries: [
            { type: 'new', text: 'Xfer Reg — panel de Resumen con desglose por estado, valor efectivo, barra de progreso y alertas' },
            { type: 'new', text: 'Xfer Reg — el resumen se actualiza en tiempo real al cambiar estados' },
            { type: 'new', text: 'Botón de resumen en el sidebar (icono de barras)' },
        ]
    },
    {
        date: '10/04/2026',
        version: 'v0.4',
        entries: [
            { type: 'new', text: 'Lista cerrada de 69 tiendas — selector dropdown, sin texto libre' },
            { type: 'new', text: 'Contraseña por tienda — se establece en el primer acceso y se pide en los siguientes' },
            { type: 'new', text: 'Panel de administrador — ver todas las tiendas registradas, contraseñas, último acceso y borrar datos' },
            { type: 'new', text: 'Doble confirmación en Limpiar — evita borrados accidentales' },
            { type: 'ui', text: 'Dropbox y barra de archivo integrados en el header del módulo' },
        ]
    },
    {
        date: '10/04/2026',
        version: 'v0.3',
        entries: [
            { type: 'new', text: 'Sincronización en la nube — los datos se guardan en Firebase Firestore, accesibles desde cualquier dispositivo' },
            { type: 'new', text: 'Selector de tienda al abrir la app — cada tienda tiene sus propios datos aislados' },
            { type: 'new', text: 'Panel de configuración (engranaje en sidebar): muestra tienda activa, cambiar tienda y restablecer datos' },
            { type: 'new', text: 'Restablecimiento de fábrica con doble confirmación — borra todos los datos de la tienda en la nube' },
            { type: 'new', text: 'Sincronización en tiempo real — los cambios de estado se reflejan al instante en todos los dispositivos conectados' },
        ]
    },
    {
        date: '10/04/2026',
        version: 'v0.2',
        entries: [
            { type: 'new', text: 'Xfer Reg — diseño responsive: la tabla se escala automáticamente en ventanas estrechas' },
            { type: 'fix', text: 'Xfer Reg — botones de salto C (Críticos) ahora funcionan correctamente' },
            { type: 'new', text: 'Xfer Reg — tooltip en botones de salto: muestra nº items, % total y listado de Box Name + % al hacer hover' },
            { type: 'new', text: 'Xfer Reg — tooltip se posiciona arriba automáticamente si no cabe abajo' },
            { type: 'ui', text: 'Botón Novedades reubicado junto al título OmniTool' },
            { type: 'ui', text: 'Texto de formato esperado actualizado en la zona de upload' },
        ]
    },
    {
        date: '09/04/2026',
        version: 'v0.1',
        entries: [
            { type: 'new', text: 'Dashboard con 6 módulos: Xfer Reg, Procurement, Garantías, Abandoned 45 días, Checklist, Entrenamientos' },
            { type: 'new', text: 'Topbar fija + sidebar con iconos y navegación' },
            { type: 'new', text: 'Módulos no implementados marcados con badge "Próximamente" y estado disabled' },
            { type: 'new', text: 'Xfer Reg — upload de CSV con drag & drop' },
            { type: 'new', text: 'Xfer Reg — tabla con 3 bloques: Críticos (>0.5%), +Hardware, Software' },
            { type: 'new', text: 'Xfer Reg — items expandidos por quantity, ordenados por coste descendente' },
            { type: 'new', text: 'Xfer Reg — tiendas ordenadas por % de fulfilment descendente dentro de cada bloque' },
            { type: 'new', text: 'Xfer Reg — columna Estado con selector coloreado (Enviado, Vendido en tienda, Ya enviado, Printed cover, Buscando no encontrado, No shipeable, REVISAR)' },
            { type: 'new', text: 'Xfer Reg — columna % con colores por tier: 2%+ rojo, 1%+ naranja, 0.5%+ amarillo' },
            { type: 'new', text: 'Xfer Reg — % de fulfilment por tienda y por sección' },
            { type: 'new', text: 'Xfer Reg — botones de salto entre secciones (C/H/S) con flash de 5s al aterrizar' },
            { type: 'new', text: 'Xfer Reg — formato imprimible: landscape, B&W, compacto, cada tienda enmarcada, secciones en hojas separadas, columna Notas y checkbox solo en print' },
            { type: 'new', text: 'Panel de Novedades (changelog) accesible desde la topbar' },
        ]
    }
];
