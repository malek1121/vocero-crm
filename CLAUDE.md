# Vocero CRM — Guía para Claude

Vocero es un CRM de WhatsApp open source (MIT), self-hosted, con agente de IA y
Laboratorio de auto-evaluación. Una instancia = un negocio. Este archivo guía a
Claude Code (u otro asistente) para operar y **modificar** este repositorio —
el caso típico: una agencia adaptando Vocero para un cliente.

## Stack

**Next.js 15 (App Router) + React 19** en monolito · TypeScript estricto
(`strict` + `noUncheckedIndexedAccess`) · Tailwind CSS (tema oscuro propio,
acento `#25D366`) · **PostgreSQL + Drizzle ORM** (migraciones versionadas en
`drizzle/`, aplicadas al ARRANCAR el contenedor) · **Better Auth** + plugin
organization · **Zod** en todo input externo · nanoid con prefijos (`ct_`,
`cv_`, `msg_`…) · pnpm · Vitest (unit) + guiones E2E en `tests/e2e/`
conducidos con Playwright · Docker multi-stage (standalone, healthcheck
`/api/health`) · deploy en Coolify (Ruta A) o docker compose + Caddy (Ruta B).

Tiempo real por **SSE** (`/api/events`): heartbeat `: ping` ~25s, headers
anti-buffering, catch-up por refetch con `since=`. Sin WebSockets, sin colas
externas: el trabajo en segundo plano (agente, Laboratorio) es in-process.

## Mapa del código (fronteras de modificación)

| Quieres cambiar… | Toca… |
|---|---|
| El cerebro/proveedor LLM | `src/lib/ai/` (adaptador OpenAI-compatible → Cloudflare Workers AI, `chatJson<T>`) |
| El comportamiento/prompt del agente | `src/server/ai/prompts.ts` |
| Las acciones que puede tomar el agente | `src/server/ai/actions.ts` + ejecución en `src/server/ai/pipeline.ts` |
| Las personas o el juez del Laboratorio | `src/server/lab/personas.ts` · `src/server/lab/judge.ts` |
| El canal WhatsApp (Baileys) | `src/server/baileys/` (manager singleton + auth-state cifrado + mapeos) |
| Campos/tablas | `src/lib/db/schema.ts` → `pnpm db:generate` → migración nueva en `drizzle/` |
| La ingesta/envío de mensajes | `src/server/inbox/` (ingest idempotente, send con guard de sandbox) |
| UI | `src/components/` + `src/app/(app)/` |

El mock del entorno de pruebas vive en `src/app/api/dev/` (ai-mock) tras un
gate único (`src/lib/dev-guard.ts`, `MOCK_ENABLED=true`): 404 incondicional
en producción.

## Reglas de la constitución (no negociables)

Ver [.specify/memory/constitution.md](.specify/memory/constitution.md).

- **Soberanía (II, endurecida)**: dependencias de runtime SOLO el canal
  WhatsApp (Baileys, socket propio) + proveedor LLM OpenAI-compatible opcional
  (Cloudflare Workers AI por defecto). PROHIBIDO en v1 introducir S3/R2,
  email, Stripe, Google u otros servicios externos. Auth y BD self-hosted.
- **Seguridad (I)**: secretos cifrados en reposo (AES-256-GCM, `lib/crypto`);
  jamás al cliente ni a logs. La sesión de Baileys va cifrada en `baileys_auth`.
- **Multi-tenancy (III)**: `organization_id` NOT NULL en toda tabla de dominio;
  toda query pasa por `scoped()` de `src/lib/db/tenant.ts`.
- **Idempotencia (IV)**: eventos del canal dedup por `wa_message_id` UNIQUE;
  estados monotónicos; seeds y migraciones re-ejecutables.
- **Sandbox del Laboratorio**: las conversaciones `is_test` JAMÁS tocan el
  canal real — el sender lanza excepción (no lo "arregles": es un guardrail).
- **Riesgo aceptado**: Baileys es cliente NO oficial (posible baneo del
  número); una sola réplica por instancia (socket singleton).

## Variables de entorno

Ver `.env.example` (cada una con guía inline). Las claves: `APP_BASE_URL`,
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (32 bytes base64), y
para IA (Cloudflare Workers AI, endpoint OpenAI-compatible):

```bash
AI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai
AI_API_TOKEN=...                                    # permiso "Workers AI"
AI_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast
AI_JUDGE_MODEL=                                     # opcional: juez más barato
```

La conexión de WhatsApp no usa variables: QR desde la app (sesión cifrada en
BD). Para el self-test del agente existe el ai-mock (`MOCK_ENABLED=true`).
Nunca actives mocks en producción.

## Manejo de credenciales (obligatorio)

Cuando una feature necesite una variable/credencial nueva: (1) agrégala a
`.env` como placeholder `REEMPLAZA_...` (append), (2) deja guía inline `#` de
cómo obtenerla, (3) resume en el chat y sigue. `.env` está gitignored; para
deploy, las vars van también en la plataforma de hosting (runtime, no build).

## Definición de Hecho REFORZADA (obligatoria)

"Typecheck + lint + build (+ tests)" es el piso, NO el techo. Una feature no
está "Hecha" hasta correr el **self-test de COMPORTAMIENTO de punta a punta**
(Playwright; para IA el ai-mock: `MOCK_ENABLED=true`, `AI_BASE_URL` →
`/api/dev/ai-mock`; para el canal, un número de pruebas vinculado por QR con
guardarraíles) y dejarlo verde: flujo real como usuario,
resultado observable, y el camino infeliz degradando sin colgarse. Prohibido
delegar la prueba al usuario. Si algo depende de un LLM/proveedor externo,
todo turno tolera formato inesperado con extracción robusta + reintentos — un
hipo del proveedor nunca tumba el turno. Al detectar un fallo: diagnostica,
corrige y re-verifica tú mismo hasta verde (loop de auto-corrección).

Gate técnico:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Guiones E2E por historia en `tests/e2e/*.md`.

## Modo Objetivo — Loop SDD

Cuando el dueño da una META (no prompts paso a paso): Discover → Plan →
Execute → Verify → Iterate, de forma autónoma, volviendo solo con el objetivo
verificado en vivo o con un bloqueo real (decisión de producto, credenciales,
acción irreversible/costosa). Agrupa TODAS las preguntas bloqueantes al inicio.
El estado durable son los artefactos SDD en `specs/` (spec/plan/tasks) —
manténlos al día. Invocable como `/loop-sdd <objetivo>`.

## Memoria persistente

Memoria de archivos en `memory/` (índice `memory/MEMORY.md`, cargado por
sesión). Persiste decisiones, gotchas y correcciones; no dupliques lo que el
repo ya registra. Los subagentes con `memory: project` usan
`.claude/agent-memory/`.

## Arquitectura de agentes

1. **Orquestador** = la sesión principal de Claude Code (este CLAUDE.md + skill
   `loop-sdd`).
2. **Subagentes** (`.claude/agents/`): `deploy-ops` (deploy/logs/healthchecks,
   no escribe código de app) · `public-site-builder` (páginas públicas/legales
   y config de paneles externos).
