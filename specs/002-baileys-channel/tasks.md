# Tasks 002 — Baileys

## Fase 1 — canal funcional (este PR)

- [x] T1. Deps: `baileys`, `qrcode`, `pino` (+ `@types/qrcode`);
      `serverExternalPackages: ["baileys"]` en `next.config.ts`.
- [x] T2. Schema: tabla `baileys_auth` (org_id + key únicos, valor cifrado
      AES-GCM) → `pnpm db:generate` → migración aplicada (0001).
- [x] T3. `src/server/baileys/auth-state.ts`: auth state de Baileys respaldado
      en BD (BufferJSON + lib/crypto), `clearAuthState(orgId)`.
- [x] T4. `src/server/baileys/map.ts`: jid↔phone, extracción de tipo/texto,
      ack→status. Funciones puras.
- [x] T5. `src/server/baileys/manager.ts`: singleton por org en `globalThis`;
      connection.update (qr/estado/reconexión), creds.update (persistir),
      messages.upsert → `ingestInboundMessage`, messages.update →
      `applyStatusUpdate`; `sendChannelText`, `logoutSession`, `resumeStoredSessions`.
- [x] T6. `send.ts`: enviar por manager (guard sandbox intacto), quitar guard
      de ventana; `pipeline.ts`: quitar guard de ventana.
- [x] T7. `queries.ts`: `windowOpen: true` fijo; `composer.tsx`: quitar badge
      de ventana.
- [x] T8. API `/api/settings/whatsapp` (GET estado+QR / POST conectar /
      DELETE logout) + componente `whatsapp-qr.tsx` + `page.tsx`.
- [x] T9. `instrumentation-node.ts`: reanudar sesiones al boot.
- [x] T10. Tests: unit de `map.ts` (10 casos); gate completo verde
      (typecheck + lint + build + 98/98 tests).
- [ ] T11. Prueba viva: QR real, entrante en inbox, respuesta, ack, reinicio
      reconecta. **Pendiente: requiere el teléfono del dueño.**

## Fase 2 — limpieza Cloud API (PR separado)

- [ ] T12. Borrar `lib/meta`, `server/whatsapp/{connect,templates,template-events}.ts`,
      webhook routes, wizard, wa-mock, `window.ts` + tests muertos, página de
      plantillas; renombrar códigos `meta_*` de `SendError`; limpiar env
      (`META_*`), README, .env.example, INSTALL-IA, constitución.
