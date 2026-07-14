# Spec 004 — Funciones de WhatsApp vía Baileys (3 tiers)

## Problema

Usamos ~5% de Baileys: solo entrantes de texto, acks y envío. El operador
espera de un WhatsApp real: historial al vincular, tildes azules, "escribiendo…",
media, archivar, y etiquetas (labels de WhatsApp Business).

## Requerimientos

### Sync de historial + pantalla de carga (flagship)

- **FR-401 Historial al vincular**: al conectar, consumir el evento
  `messaging-history.set` de Baileys e ingerir contactos, conversaciones y
  mensajes que el teléfono sincronizó (chats directos; grupos/broadcast se
  ignoran). Idempotente por `wa_message_id`. Los mensajes históricos NO
  disparan el agente ni cuentan como no-leídos.
- **FR-402 Pantalla de carga**: mientras el sync corre, la UI muestra un
  estado `syncing` con progreso (0–100%) — como la pantalla "cargando
  mensajes" de WhatsApp. Al terminar (`isLatest`), pasa a `connected`.

### Tier 1 — sensación de WhatsApp real

- **FR-411 Read receipts**: al abrir una conversación, marcar sus mensajes
  entrantes como leídos en WhatsApp (el cliente ve tildes azules).
- **FR-412 Typing del agente**: mientras el agente genera respuesta (y al
  enviar), emitir presencia `composing` al contacto; `paused` al terminar.
- **FR-413 Descarga de media**: bajar el binario de imagen/audio/video/doc
  entrante y guardarlo (Postgres, ver design); renderizarlo en el hilo.
  Sin media saliente en v1.

### Tier 2 — organización

- **FR-421 Archivar (CRM local)**: archivar/desarchivar una conversación;
  filtro "Archivadas" en la Bandeja. Es estado LOCAL del CRM (reusa
  `contact.archivedAt`), no se sincroniza con WhatsApp en v1.
- **FR-422 Historial por cuenta al desvincular**: al desvincular, el historial
  de esa cuenta de WhatsApp no se pierde: queda marcado por la cuenta
  (número) y separado del historial de una cuenta nueva vinculada después.

### Tier 3 — etiquetas (WhatsApp Business)

- **FR-431 Labels**: crear, listar y asignar/quitar etiquetas a una
  conversación; reflejar cambios hechos desde el teléfono
  (`labels.edit` / `labels.association`). Solo funciona con WhatsApp Business;
  con número normal la sección queda vacía sin romper nada.

## No-goals v1

- Grupos, comunidades, newsletters (fuera del foco vertical 1:1).
- Media saliente, editar/borrar mensajes, bloquear, foto de perfil.
- Almacenamiento de objetos externo (S3/R2) — prohibido por Constitución II.

## Riesgo

Baileys no oficial: cada función suma superficie. Las "humanas" (typing,
receipts) reducen sospecha; ninguna aquí es de volumen. Labels exige el número
en modo Business — se prueba después.

## Criterio de Hecho

Gate técnico verde por slice. Verificación viva por slice cuando aplique
(pantalla de carga con teléfono real; labels con número Business — diferido).
