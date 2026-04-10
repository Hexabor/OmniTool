const CHANGELOG = [
    {
        date: '10/04/2026',
        version: 'v0.4',
        tag: 'ÚLTIMA',
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
