# Plan 002 — Baileys

## Arquitectura

```
teléfono ⇄ WhatsApp ⇄ [socket Baileys (singleton en proceso)]
                             │ events                    │ send
                             ▼                           ▲
                     src/server/baileys/manager.ts ◄─ send.ts (sendText)
                       │ messages.upsert → ingestInboundMessage (existente)
                       │ messages.update → applyStatusUpdate (existente)
                       │ creds.update    → auth-state.ts → Postgres (cifrado)
                       └ connection.update → estado {qr,status} para la UI
```

Todo lo aguas abajo del canal (ingesta, SSE, agente, pipeline, sandbox,
kanban) queda intacto: Baileys solo sustituye la frontera de entrada/salida.

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Librería | `baileys` (WhiskeySockets) + `qrcode` (QR→dataURL) + `pino` (logger silencioso) | estándar de facto; qrcode server-side evita libs de UI |
| Auth store | tabla `baileys_auth(organization_id, key, value_cipher/iv/tag)`; JSON serializado con `BufferJSON` y cifrado AES-256-GCM | Constitución I (secretos cifrados en reposo); sobrevive reinicios (FR-B02) |
| Singleton | mapa `orgId → sesión` cacheado en `globalThis` | sobrevive HMR en dev; 1 socket por org (FR-B09) |
| Reconexión | `close` con causa ≠ `loggedOut` → reintentar; `loggedOut` → borrar auth y quedar `disconnected` | comportamiento canónico de Baileys |
| Boot | `instrumentation-node.ts` reanuda sesiones con creds guardadas | FR-B02 sin intervención |
| Envío | `sock.sendMessage(jid, {text})`; jid = `<phone>@s.whatsapp.net`; `key.id` → `wa_message_id` | reusa idempotencia existente |
| Errores de envío | se reutilizan los códigos existentes de `SendError` (`not_connected`, `meta_error`, `meta_unavailable`) | no tocar la capa API→HTTP en esta fase; rename en fase 2 |
| Ventana 24h | guard fuera de `send.ts` y `pipeline.ts`; `queries.ts` reporta `windowOpen: true` (compat de tipo); composer deja de mostrar el badge | FR-B06 con diff mínimo; `window.ts` + su test se borran en fase 2 |
| Cloud API | `lib/meta`, `connect.ts`, `templates.ts`, webhook routes y wizard quedan muertos pero compilando | slice chico y verificable; borrado = fase 2 |
| Next config | `serverExternalPackages: ["baileys"]` | dep con binarios/optionals; no debe pasar por el bundler |
| Mapeos puros | `src/server/baileys/map.ts` (jid↔phone, tipo de mensaje, ack→status) | testeable por unit sin socket |

## Estado de conexión (contrato UI)

`GET /api/settings/whatsapp` → `{ status, qrDataUrl?, phone? }`
`POST /api/settings/whatsapp` → inicia/reinicia conexión (genera QR)
`DELETE /api/settings/whatsapp` → logout + borra credenciales

UI: `whatsapp-qr.tsx` (client) reemplaza al wizard: botón Conectar, QR con
polling ~2s, estado conectado con teléfono, botón Desconectar.

## Mapeo de acks

Baileys `WAMessageStatus`: 2 SERVER_ACK → `sent` · 3 DELIVERY_ACK →
`delivered` · 4 READ → `read`. Otros se ignoran (monotonicidad ya cubierta).

## Riesgos

- **Ban del número** (aceptado, spec).
- **Una sola réplica**: 2 procesos = sesión inestable. Documentado; sin guard
  técnico en esta fase.
- **e2e self-test**: wa-mock apunta a Graph; el guion e2e de canal real queda
  obsoleto hasta fase 2. Gate de esta fase: unit + typecheck + lint + build +
  prueba manual QR.
