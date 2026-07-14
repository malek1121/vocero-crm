# Tasks 004

## Slice 1 — Sync + pantalla de carga (FR-401/402)
- [ ] T1. Schema: `conversation.wa_account`, `message.wa_account` (nullable);
      migración 0004.
- [ ] T2. `map.ts`: extraer historial de un `WAMessage` (dirección, texto,
      timestamp, waMessageId, fromMe).
- [ ] T3. Manager: listener `messaging-history.set` → ingesta histórica en
      lotes; estado `syncing` + `syncProgress`; SSE `channel.sync`.
- [ ] T4. `ingest.ts`: modo `historical` (sin agente, sin unread).
- [ ] T5. Status endpoint expone `syncProgress`; `whatsapp-qr` muestra
      pantalla de carga; Bandeja muestra overlay mientras sincroniza.
- [ ] T6. Test unit de mapeo histórico; gate.

## Slice 2 — Receipts + typing (FR-411/412)
- [ ] T7. `readMessages` al abrir conversación (API markRead ya existe).
- [ ] T8. Presencia `composing`/`paused` en pipeline del agente y envío manual.
- [ ] T9. Gate.

## Slice 3 — Media (FR-413)
- [ ] T10. Schema `media_asset`; migración.
- [ ] T11. `downloadMediaMessage` en ingesta; ruta `/api/media/[id]`.
- [ ] T12. Render en el hilo (imagen/audio/video/doc). Gate.

## Slice 4 — Archivar (FR-421)
- [ ] T13. API archive/unarchive; filtro "Archivadas" en Bandeja. Gate.

## Slice 5 — Historial por cuenta al desvincular (FR-422)
- [ ] T14. Logout marca `wa_account` como histórico (no borra mensajes);
      Bandeja separa cuenta activa vs histórica. Gate.

## Slice 6 — Labels (FR-431)
- [ ] T15. Schema `label` + `conversation_label`; migración.
- [ ] T16. Eventos `labels.edit`/`labels.association`; acciones
      `addLabel`/`addChatLabel`/`removeChatLabel`.
- [ ] T17. API + UI chips. Gate. Prueba viva diferida (número Business).
