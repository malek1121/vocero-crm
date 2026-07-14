# Vocero CRM

**El CRM de WhatsApp open source con un agente de IA que se pone a prueba solo.**

Vocero es un CRM self-hosted y gratuito para negocios que venden por WhatsApp:
bandeja en tiempo real, pipeline de ventas, un agente de IA con el conocimiento
de tu negocio y un **Laboratorio** donde clientes simulados lo evalúan antes de
que hable con clientes reales. Una instancia = un negocio, en tu propio
servidor, con tus datos.

![Bandeja de Vocero CRM](docs/screenshots/bandeja.png)

<p align="center">
  <img src="docs/screenshots/laboratorio.png" width="49%" alt="Laboratorio: reporte con score y hallazgos" />
  <img src="docs/screenshots/pipeline.png" width="49%" alt="Pipeline kanban" />
</p>

> 🎬 **Video-instalador oficial**: próximamente en
> [el canal de Kevin Belier](https://www.youtube.com/@KevinBelier)

## ¿Para quién es?

- **Agencias de IA/automatización** que implementan CRM + agente para sus
  clientes: despliegas una instancia por cliente en su VPS, la configuras y la
  entregas con evidencia de calidad (el reporte del Laboratorio).
- **Negocios** que quieren atender WhatsApp con IA sin regalar sus datos a un
  SaaS: todo corre en tu servidor.

## Features

### 🧪 Laboratorio: el agente se prueba solo

La pieza estelar. Seis clientes simulados —el comprador decidido, el preguntón
de precios, el cliente enojado, el que pregunta lo que no sabes, el que exige
un humano y el que escribe "ke onda si benden pintura"— conversan contra tu
agente REAL en un **sandbox interno que jamás envía mensajes reales**. Un juez
LLM independiente evalúa cada conversación y te entrega:

- un **score 0–100** de qué tan listo está el agente,
- **hallazgos con evidencia** (alucinaciones, huecos del conocimiento, fallas
  de escalado, tono),
- **sugerencias aplicables con un click** al knowledge base,
- e **historial con delta**: re-corre después de cada cambio y mira si mejoraste.

Deja de "esperar que el bot funcione": mídelo.

### 💬 Bandeja de WhatsApp en tiempo real

Tres columnas (conversaciones / hilo / contacto), mensajes entrantes en ≤2
segundos sin recargar, estados enviado/entregado/leído, respuestas del agente
marcadas como IA y handoff a humano con un click.

### 📊 Contactos y pipeline kanban

Cada persona que escribe queda registrada sola y entra al pipeline
(Nuevo → En conversación → Interesado → Cliente → Perdido, editable). Arrastra
tarjetas, busca, agrega notas, archiva. El agente puede mover leads de etapa
cuando detecta intención de compra.

### 🤖 Agente de IA con TU conocimiento

Configura nombre, tono, instrucciones y reglas de escalado; dale conocimiento
en pares pregunta/respuesta y bloques libres. Responde SOLO con lo que sabe,
agrupa ráfagas de mensajes en una respuesta, escala a humano cuando el cliente
lo pide (con detección de respaldo), cuando él lo decide o cuando algo falla.
Proveedor LLM por adaptador OpenAI-compatible — por defecto
**Cloudflare Workers AI**: usa el modelo que quieras.

### 👥 Multi-usuario · 🔐 Self-hosted

Cuentas de equipo creadas por el propietario (el registro público se cierra
tras la primera organización); sesión de WhatsApp cifrada en reposo
(AES-256-GCM) y cero dependencias de runtime más allá de WhatsApp y tu
proveedor LLM opcional.

## Requisitos

- Un VPS con Docker (2 GB de RAM bastan) — con o sin [Coolify](https://coolify.io).
- Un dominio apuntando al VPS (https para la app).
- Un número de WhatsApp normal en un teléfono (la conexión es por código QR,
  como WhatsApp Web — ver [Conexión](#conexión-del-número-de-whatsapp)).
- Opcional: un API token de [Cloudflare](https://dash.cloudflare.com) con
  permiso **Workers AI** (o cualquier proveedor OpenAI-compatible) para el
  agente y el Laboratorio.

## Instalación (~15 minutos)

### 0. Apunta tu dominio

Crea un registro **A** de `crm.tudominio.com` hacia la IP del VPS y espera a
que resuelva.

### Ruta A — Coolify guiado por IA (recomendada)

Abre tu asistente de IA (p. ej. Claude Code con el MCP de Coolify), pásale el
archivo [`INSTALL-IA.md`](INSTALL-IA.md) y responde 3 preguntas (dominio,
credenciales de Cloudflare Workers AI opcionales, ruta). El asistente crea la
base de datos y la app, genera los secretos y verifica el healthcheck.

### Ruta B — docker compose

```bash
git clone https://github.com/kevinrivm/vocero-crm.git vocero && cd vocero
cp .env.example .env    # rellena: dominio + secretos (cada uno trae su comando openssl)
docker compose up -d --build
```

Caddy emite el certificado HTTPS solo. Verifica con
`https://crm.tudominio.com/api/health` → `{"ok":true}`.

### Correr en local (sin Docker)

Para **usar** el CRM en tu máquina, corré la versión compilada — `next dev` es
solo para modificar código y compila cada página al visitarla (se siente lento):

```bash
pnpm build
PORT=3001 pnpm start   # producción local: navegación instantánea
# PowerShell: $env:PORT="3001"; pnpm start
```

### Primer arranque

1. Entra y **regístrate**: el primer registro crea tu organización y cierra el
   registro público.
2. Opcional: pulsa **"Cargar datos de demostración"** para explorar con la
   **Ferretería El Martillo** (contactos, conversaciones, pipeline, un
   knowledge base con huecos a propósito y una corrida de Laboratorio de
   ejemplo — corre el Laboratorio y mira cómo los encuentra).
3. La conexión de WhatsApp se hace después, en **Configuración → WhatsApp**.

## Conexión del número de WhatsApp

La conexión es por **código QR**, igual que WhatsApp Web — el canal es
[Baileys](https://github.com/WhiskeySockets/Baileys), un cliente de WhatsApp
Web no oficial:

1. Entra a **Configuración → WhatsApp** y pulsa **Conectar**.
2. En el teléfono: WhatsApp → **Dispositivos vinculados** → **Vincular un
   dispositivo** → escanea el QR.
3. Listo: estado "Conectado". La sesión queda **cifrada en la base de datos**
   (AES-256-GCM) y sobrevive reinicios sin volver a escanear.

Para desconectar: botón **Desconectar** en la misma pantalla (o cierra la
sesión desde el teléfono).

> ⚠️ **Advertencia importante**: Baileys es un cliente NO oficial y va contra
> los Términos de Servicio de WhatsApp. **El número puede ser baneado**, sobre
> todo con mensajería automatizada. Usa un número dedicado (no el personal ni
> el principal del negocio), escribe solo a personas que te escribieron
> primero, y evita ráfagas o volumen alto. Úsalo bajo tu propio riesgo.

## Configuración de la IA

En las variables de la instancia (proveedor OpenAI-compatible; por defecto
**Cloudflare Workers AI**):

```bash
AI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai
AI_API_TOKEN=...                       # API token de Cloudflare con permiso "Workers AI"
AI_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast
AI_JUDGE_MODEL=                        # opcional: modelo distinto para el juez del Laboratorio
```

El Account ID sale del dashboard de Cloudflare; el token se crea en
My Profile → API Tokens con el permiso **Workers AI**. Cualquier otro
proveedor OpenAI-compatible funciona apuntando `AI_BASE_URL` a su endpoint.

Sin token, todo lo demás funciona; Agente y Laboratorio muestran cómo
activarlos. Después configura el comportamiento y el conocimiento en la
pestaña **Agente** y corre el **Laboratorio** antes de encender el agente con
clientes reales.

## Uso responsable del canal

1. **Opt-in**: escribe solo a personas que iniciaron la conversación o
   aceptaron recibir mensajes.
2. **El Laboratorio es 100 % interno**: los clientes simulados jamás tocan el
   canal real (bloqueado por diseño y verificado con tests).
3. **Sin spam ni broadcast**: Vocero no incluye envíos masivos; úsalo para
   conversaciones reales de venta y soporte. Con un cliente no oficial, el
   volumen alto es además la vía rápida al baneo.
4. **Datos del cliente en su servidor**: cada negocio aloja su instancia; la
   sesión de WhatsApp va cifrada en reposo.
5. **Una sola réplica**: la sesión de WhatsApp es un socket único — no
   escales la app a múltiples instancias.

## FAQ de errores comunes

**El QR no aparece** — Revisa los logs de la instancia
(`docker compose logs app`); casi siempre la BD no está lista o la app acaba
de reiniciar. Pulsa Conectar de nuevo.

**Se desconecta solo** — Si cerraste sesión desde el teléfono, la instancia
queda "Sin sesión activa": reconecta con QR. Si el teléfono estuvo mucho
tiempo sin internet, WhatsApp puede cerrar la sesión vinculada.

**Llegan mensajes pero no salen** — Revisa el estado en Configuración →
WhatsApp: si no dice "Conectado", reconecta. El composer muestra el error
exacto al intentar enviar.

**El agente no responde** — ¿Token de IA configurado (`AI_API_TOKEN`)?
¿Toggle global encendido? ¿La conversación tiene la IA activa y sin handoff?
Revisa también los logs de la instancia.

**`ENCRYPTION_KEY` inválida al arrancar** — Debe ser exactamente 32 bytes en
base64 (44 caracteres): `openssl rand -base64 32`.

**La app arranca pero /api/health falla** — La base de datos no está lista o
`DATABASE_URL` apunta mal; revisa los logs (`docker compose logs app`).

## Roadmap

- Multimedia completa en la bandeja (hoy: indicador de tipo).
- RAG para knowledge bases grandes (hoy: se inyecta completo con aviso de tamaño).
- Personas configurables del Laboratorio y comparativas entre corridas.
- Analytics de conversación.

## Stack

Next.js 15 (App Router) + React 19 · TypeScript estricto · PostgreSQL +
Drizzle ORM · Better Auth · Baileys (canal WhatsApp por QR) · Cloudflare
Workers AI (adaptador OpenAI-compatible) · Tailwind CSS · SSE (sin WebSockets)
· Docker multi-stage con migraciones al arranque. Diseñado para que una
agencia lo modifique con un asistente de IA: specs y decisiones de diseño en
[`specs/`](specs/), guía de modificación en [`CLAUDE.md`](CLAUDE.md).

## Licencia

[MIT](LICENSE) — úsalo, véndelo instalado, modifícalo. Si te sirve, una ⭐ al
repo ayuda a que más gente lo encuentre.

## Créditos

Creado por [Kevin Belier](https://www.youtube.com/@KevinBelier). ¿Quieres
monetizar con tu agencia de IA? Únete a la
[VIBE Community](https://www.skool.com/vibe-community-vip). Los patrones de
producción (ingesta idempotente, cifrado de secretos en reposo) vienen de un
proyecto de referencia privado en producción, portados y simplificados para
este repo.
