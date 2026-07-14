# Tasks 003

- [x] T1. `session.ts`: `requireSession` + `getAuthSession` con React `cache()`;
      layout usa `getAuthSession()` (elimina el 2º lookup de auth).
- [x] T2. `inbox-client.tsx`: selección ⇄ `?c=<id>` (replaceState al elegir,
      restaurar al montar).
- [x] T3. README: sección "Correr en local" — `PORT=3001 pnpm start`
      (gotcha: `pnpm start -- -p` pasa el `--` literal a next y rompe).
- [x] T4. Gate verde (typecheck/lint/build/102 tests). Medición en producción
      2026-07-14: /inbox 67 ms, resto 18–22 ms (vs 1.9 s primera visita en
      dev). Sesión Baileys reanudada en el proceso de producción.
      Restauración visual de `?c=` pendiente de confirmación del operador.
