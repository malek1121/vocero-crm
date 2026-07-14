# Guion E2E — US5: Conexión del número (QR)

> Conducido con Playwright (MCP) contra `pnpm dev`. Requiere un teléfono con
> WhatsApp para escanear el QR (el canal es Baileys, cliente no oficial:
> usa un número de pruebas, no el principal del negocio).

## Camino feliz

1. Abrir `/settings/whatsapp`.
   ✅ Estado "Sin sesión activa" con botón **Conectar** y la explicación de
   cómo vincular (WhatsApp → Dispositivos vinculados).
2. Pulsar **Conectar**.
   ✅ Aparece un código QR (imagen) con nota de que se renueva solo.
3. Escanear con el teléfono (Dispositivos vinculados → Vincular un dispositivo).
   ✅ El estado pasa a "Conectado como +<número>" sin recargar (polling).
4. Reiniciar el servidor (`pnpm dev` de nuevo).
   ✅ La sesión se reanuda sola desde la BD (cifrada): sigue "Conectado" sin
   volver a escanear.

## Caminos infelices

5. **Desconectar**: pulsar **Desconectar** y confirmar.
   ✅ Estado vuelve a "Sin sesión activa"; las credenciales guardadas se
   borran (volver a Conectar exige QR nuevo).
6. **Logout remoto**: cerrar la sesión desde el teléfono
   (Dispositivos vinculados → cerrar sesión).
   ✅ La instancia queda "Sin sesión activa" y limpia la sesión guardada; no
   entra en loop de reconexión.
