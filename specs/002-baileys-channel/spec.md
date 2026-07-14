# Spec 002 — Canal WhatsApp vía Baileys (reemplaza Cloud API)

## Problema

Vocero hoy depende de WhatsApp Cloud API (Meta): requiere WABA, phone_number_id,
token de sistema y webhook público. El dueño quiere operar con un número de
WhatsApp normal, conectado por QR, sin infraestructura de Meta.

## Decisión

Reemplazar el canal de mensajería por **Baileys** (cliente WhatsApp Web no
oficial, WebSocket persistente). La Cloud API deja de ser el camino de
runtime; su código se elimina en una fase de limpieza posterior.

**Riesgo aceptado por el dueño (2026-07-13):** Baileys viola los ToS de
WhatsApp; el número puede ser baneado. Enmienda a la Constitución II: la
dependencia de runtime del canal pasa de "WhatsApp Cloud API" a "Baileys".

## Requerimientos

- **FR-B01 Conexión por QR**: desde Configuración → WhatsApp el operador ve un
  QR, lo escanea con su teléfono y la instancia queda conectada. Estado
  visible: `disconnected | connecting | qr | connected`.
- **FR-B02 Sesión persistente**: las credenciales de sesión de Baileys se
  guardan **cifradas** (AES-256-GCM, `lib/crypto`) en Postgres. Un reinicio
  del contenedor reconecta solo, sin re-escanear QR.
- **FR-B03 Ingesta**: mensajes entrantes (texto y tipos soportados existentes)
  entran por el pipeline actual (`ingestInboundMessage`): idempotencia por
  `wa_message_id` (= `key.id` de Baileys), contacto/conversación upsert, SSE,
  trigger del agente. Se ignoran grupos, broadcasts y mensajes propios.
- **FR-B04 Envío**: `sendText` envía por el socket Baileys. Errores tipados:
  `not_connected` si no hay sesión activa; fallo del socket degrada sin
  colgarse.
- **FR-B05 Estados**: acks de Baileys (server/delivery/read) actualizan el
  estado del mensaje por el camino monotónico existente (`applyStatusUpdate`).
- **FR-B06 Sin ventana 24h**: Baileys no tiene ventana de servicio. El guard
  de ventana se elimina del envío (manual y del agente). La UI no muestra
  ventana.
- **FR-B07 Desconexión**: el operador puede cerrar sesión desde la UI
  (logout + borrar credenciales). Un logout remoto (desde el teléfono) deja
  el estado `disconnected` y limpia la sesión.
- **FR-B08 Sandbox intacto**: conversaciones `is_test` JAMÁS tocan el socket
  (guard existente se conserva tal cual).
- **FR-B09 Singleton**: un socket por organización, proceso único. Sin
  soporte multi-réplica (documentado).

## No-goals (fase 2, PR separado)

- Borrado del código Cloud API (lib/meta, connect, templates, webhook routes,
  wizard, wa-mock) y de plantillas (concepto Cloud API-only).
- Envío/recepción de media (solo se ingesta el tipo; sin descarga de binarios).
- Multi-dispositivo/multi-número por organización.

## Criterio de Hecho

Typecheck + lint + tests verdes, y self-test de comportamiento: conectar por
QR real, recibir un mensaje entrante (aparece en inbox vía SSE), responder
desde el composer, ver el ack de entrega, reiniciar el server y comprobar que
reconecta sin QR.
