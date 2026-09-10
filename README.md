# CapiTool · Control de ajustes

Repositorio piloto para separar Control de ajustes del monolito `Hexabor/OmniTool`.

## Invariantes de la migración

- Usa el mismo proyecto Firebase `omnitool-c1ed2`.
- Lee y escribe exclusivamente `stores/{tienda}/modules/adjustments`.
- Mantiene `omni_store` en `localStorage`, compartido entre las GitHub Pages de `hexabor.github.io`.
- El menú principal continúa en `Hexabor/OmniTool`.
- Xfer Reg permanece en `https://hexabor.github.io/OmniTool/xfer-reg.html` y no se modifica.

## Publicación

Publicar GitHub Pages desde la rama `main`, raíz `/`. La URL prevista es:

`https://hexabor.github.io/omnitool-adjustments/`

Solo después de verificar esa URL debe cambiarse la tarjeta de Control de ajustes del menú principal.

## Reversión

Mientras `adjustments.html` siga presente en OmniTool, revertir consiste únicamente en devolver el enlace de la tarjeta del menú a `adjustments.html`. No hay migración de datos que revertir.
