# Plan 004

## Decisiones de arquitectura

| Tema | Decisión | Por qué |
|---|---|---|
| Media store | Postgres: tabla `media_asset` (bytea + mime + tamaño), servida por ruta autenticada `/api/media/[id]` | Constitución II prohíbe S3/R2; single-instance; ponytail: bytea sirve hasta que el volumen duela, luego disco/volumen |
| Progreso de sync | campo en la sesión del manager (`syncProgress`) + evento SSE `channel.sync`; el status endpoint ya expone estado | reusa el bus in-process existente |
| Historial idempotente | reusa `ingestInboundMessage` pero en modo `historical` (sin agente, sin unread, sin marcar reciente) | una sola ruta de escritura, dedup por `wa_message_id` |
| Archivo por cuenta | columna `wa_account` (número vinculado) en `conversation`/`message` al ingerir; desvincular NO borra, marca la cuenta como histórica | "se guarda en una sección" sin perder datos |
| Labels | tablas `label` + `conversation_label`; eventos Baileys reflejan estado del teléfono; acciones salientes vía `addLabel`/`addChatLabel` | Business-only; degrada a vacío |
| Typing/receipts | llamadas directas al socket (`sendPresenceUpdate`, `readMessages`) desde puntos existentes (open conversation, agent pipeline) | sin estado nuevo |

## Slices (orden de implementación y verificación)

1. **Sync + pantalla de carga** (FR-401/402): schema `wa_account`; listener
   `messaging-history.set`; estado `syncing`+progreso en manager; SSE
   `channel.sync`; overlay de carga en `whatsapp-qr` y/o Bandeja.
2. **Receipts + typing** (FR-411/412): `readMessages` al abrir; presencia en
   el pipeline del agente y en `sendChannelText`.
3. **Media** (FR-413): tabla `media_asset`; `downloadMediaMessage` en ingesta;
   ruta `/api/media/[id]`; render en el hilo.
4. **Archivar** (FR-421): API + filtro Bandeja sobre `contact.archivedAt`.
5. **Historial por cuenta al desvincular** (FR-422): usar `wa_account` del
   slice 1; logout marca histórico en vez de borrar mensajes.
6. **Labels** (FR-431): tablas + eventos + acciones + UI (chips).

Cada slice: migración aditiva nueva (no tocar 0002/0003), gate completo, y
nota de qué queda pendiente de prueba viva.

## Riesgos técnicos

- `messaging-history.set` puede llegar en tandas grandes → ingerir en lotes,
  no bloquear el event loop; el progreso viene en `progress`/`isLatest`.
- media pesada en bytea → límite de tamaño por asset; documentar techo.
- labels: shapes de `LabelAssociation` varían (chat vs message) — manejar solo
  asociación de chat en v1.
