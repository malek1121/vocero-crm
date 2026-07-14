# Guion E2E — US1: Bandeja de WhatsApp en tiempo real

> Conducido con Playwright (MCP) contra `pnpm dev`, con un número de WhatsApp
> vinculado por QR (Configuración → WhatsApp) y un segundo teléfono como
> "cliente". El canal es Baileys: la prueba usa mensajes reales — respeta las
> reglas de guardarraíl (allowlist, sin ráfagas, volumen mínimo).

## Preparación

1. Login en `/login` y abrir `/inbox`.
2. Verificar en `/settings/whatsapp` estado "Conectado".

## Camino feliz

3. **Entrante en tiempo real (SC-001)**: desde el teléfono cliente enviar
   "Hola, ¿tienen taladros?" al número conectado.
   ✅ La conversación aparece en la lista en ≤2 s SIN recargar, con nombre y preview.
4. **Abrir el hilo**: clic en la conversación.
   ✅ El mensaje entrante se ve en burbuja; el contador de no-leídos se limpia.
5. **Responder**: escribir "¡Sí! ¿Qué modelo buscas?" y enviar.
   ✅ El mensaje aparece en el hilo (dirección out, reloj de pending) y llega
   al teléfono cliente.
6. **Estados**: al entregarse/leerse en el teléfono cliente.
   ✅ Los ticks progresan a ✓✓ y a ✓✓ azul sin recargar.
7. **Avatares**: la conversación muestra iniciales con color estable.

## Caminos infelices

8. **Dedup (SC-004)**: los reintentos del canal no duplican mensajes
   (idempotencia por `wa_message_id`; cubierto además por unit test).
9. **Canal desconectado**: desconectar la sesión en Configuración → WhatsApp
   e intentar responder.
   ✅ `POST /api/conversations/:id/messages` responde 409 `not_connected` y el
   composer muestra el error sin colgarse.
10. **Reconexión SSE**: (cubierto por diseño: EventSource reconecta y el
    cliente refetch-ea con el evento `open`).
