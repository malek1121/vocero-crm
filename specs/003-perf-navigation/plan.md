# Plan 003

| Fix | Cómo | Archivos |
|---|---|---|
| FR-P01 | Envolver `requireSession` en React `cache()` y exponer `getAuthSession` cacheado; el layout reutiliza ambos en vez de llamar a better-auth dos veces. `cache()` es per-request: sin estado compartido entre usuarios. | `src/lib/auth/session.ts`, `src/app/(app)/layout.tsx` |
| FR-P02 | Al seleccionar conversación: `history.replaceState` con `?c=<id>` (shallow, no re-renderiza el server). Al montar: si hay `?c=` y no hay selección, seleccionar tras cargar la lista (mismo patrón que `?contact=`). | `src/components/inbox/inbox-client.tsx` |
| FR-P03 | Sin código: `pnpm build` + `next start -p 3001`. Documentar en README (uso vs desarrollo). | `README.md` |

Riesgo: `cache()` requiere que la función sea la MISMA referencia por request —
export const con cache() en módulo cumple. `history.replaceState` nativo está
soportado por Next 14.2+ (sincroniza `useSearchParams`).
