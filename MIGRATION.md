# Piloto de modularización

## Alcance

La aplicación contiene solo la interfaz, estilos y lógica de Control de ajustes. Los enlaces laterales de los demás módulos apuntan al repositorio principal durante la transición.

## Contrato de datos

| Concepto | Contrato |
|---|---|
| Proyecto Firebase | `omnitool-c1ed2` |
| Tienda activa | `localStorage.omni_store` |
| Documento del módulo | `stores/{tienda}/modules/adjustments` |
| Escritura | Reemplazo completo del documento de Ajustes |
| Borrado desde Configuración | Solo `modules/adjustments` |

## Validación antes de activar el enlace

1. Abrir el menú principal, seleccionar una tienda y entrar en la aplicación piloto.
2. Confirmar que reconoce `omni_store` sin pedir de nuevo la tienda.
3. Comparar resumen semanal, listado, filtros y ventas semanales con la página antigua.
4. Cargar un CSV de prueba en una tienda de pruebas y verificar que solo cambia el documento `modules/adjustments`.
5. Comprobar que Inicio, Checklist, Garantías, Xfer Reg, Procurement y Entrenamientos vuelven a OmniTool.
6. Cambiar la tarjeta de Ajustes en OmniTool solo tras superar estas comprobaciones.

## Xfer Reg

No se modifica ningún archivo, enlace ni ruta de Xfer Reg en esta fase.
