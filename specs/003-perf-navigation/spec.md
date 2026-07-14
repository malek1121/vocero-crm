# Spec 003 — Navegación fluida y estado persistente

## Problema

1. **Lag al cambiar de página**: el operador siente ~1–2 s por navegación.
   Diagnóstico medido (2026-07-14): (a) la instancia corre en `next dev`, que
   compila cada ruta en la primera visita (1.9 s vs 0.09 s ya compilada);
   (b) el layout ejecuta 2 lecturas de sesión + 1 de branding contra la BD en
   CADA navegación (`getSessionOrNull` y `getAuth().api.getSession` duplican
   el lookup de auth).
2. **Estado perdido al volver a una página**: la conversación seleccionada en
   la Bandeja vive solo en `useState`; navegar desmonta el componente y al
   volver se pierde la selección y se recarga todo.

## Requerimientos

- **FR-P01 Sesión deduplicada**: las lecturas de sesión de un mismo request se
  resuelven UNA sola vez (React `cache()`); el layout no repite el lookup de
  auth. Sin cambio de contrato para rutas ni componentes.
- **FR-P02 Selección de bandeja en la URL**: la conversación seleccionada se
  refleja como `/inbox?c=<id>` sin recargar la página; al volver a `/inbox`
  con ese parámetro, la conversación se restaura y sus mensajes se cargan.
  Convive con el deep-link existente `?contact=<id>`.
- **FR-P03 Modo producción local**: la instancia local puede correr compilada
  (`pnpm build` + `next start`) en el puerto 3001, eliminando el costo de
  compilación por visita. Documentado como el modo recomendado para USO
  (dev queda solo para modificar código).

## No-goals

- Caché de datos de cliente (TanStack Query) — se difiere hasta medir de nuevo
  tras FR-P01/P03.
- Persistir estado de Pipeline/Contactos — solo la Bandeja duele hoy.
- Quitar `force-dynamic` — correcto para una app autenticada por cookie.

## Criterio de Hecho

Gate técnico verde + medición: navegación entre páginas ya compiladas < 300 ms
servida en modo producción, y volver a `/inbox?c=…` restaura la conversación.
