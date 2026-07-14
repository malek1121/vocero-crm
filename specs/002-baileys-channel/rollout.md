# Runbook de despliegue — Canal WhatsApp vía Baileys

## Estado actual

**RELEASE BLOQUEADO (2026-07-14).** Los gates locales del código están verdes,
pero eso NO equivale a una aprobación de producción. Faltan estas acciones que
requieren evidencia operativa del responsable:

1. Revocar y rotar en Cloudflare la credencial que estuvo expuesta en material
   de ejemplo, actualizar el entorno sin registrar el nuevo valor y reiniciar.
2. Revalidar el estado de migraciones y un restore drill contra el artefacto que
   realmente se vaya a desplegar. El dump existente se conserva fuera del repo,
   pero su mera existencia no demuestra una restauración vigente.
3. Repetir la matriz de dispositivo real de §6 sobre este candidato, incluidos
   corte/retorno de red, retry ambiguo con ID estable y sandbox negativo.
4. Registrar la aprobación explícita del responsable de datos/operaciones y la
   decisión final de release.

Las entradas históricas que aparecen más abajo sirven como antecedente, no como
evidencia suficiente para aprobar este worktree actual. No existe un entorno de
producción inventariado en este documento.

## 1. Inventario obligatorio por entorno

Completar una fila por cada entorno real. No asumir que una base vacía implica
que `0002` nunca se aplicó.

| Entorno/base | Estado de `0002` | Registro de migración | Esquema observado | Copia de seguridad | Restauración ensayada | Evidencia | Responsable/fecha |
|---|---|---|---|---|---|---|---|
| `local-dev` (Docker `vocero-dev`, BD `vocero`) | `applied` | fila 3 de `drizzle.__drizzle_migrations`, hash `b204ebfc…` = SHA-256 del archivo; `0003` también aplicada (fila 4) | coincide con post-`0003`: sin `meta_credentials`/`template`; presentes `baileys_auth`, `agent_dispatch`; 6 columnas de delivery en `message` | `vocero-20260713-215409.dump` en almacenamiento externo al repositorio (pg_dump -Fc) | sí — restaurada en `vocero_restore_drill`, conteos idénticos (18 tablas / 1 user / 1 org / 67 messages / 4 migraciones), scratch eliminada | consultas y salidas en §8 | registro local / 2026-07-13 |

No hay otros entornos: nunca hubo deploy remoto de este fork.

Estados admitidos:

- `never_applied`: no existe registro de `0002` y el esquema coincide con la
  línea base anterior a esa migración.
- `applied`: existe el registro esperado y el esquema coincide con el estado
  posterior a `0002`.
- `mixed`: el registro y el esquema no coinciden, o distintos entornos tienen
  estados incompatibles para un único plan de despliegue.
- `unknown`: falta alguna evidencia necesaria.

`mixed` o `unknown` bloquean el release.

### Inspección

1. Con acceso de solo lectura, identificar el esquema y la tabla de migraciones
   configurados por Drizzle. Con los valores predeterminados de PostgreSQL, la
   consulta de partida es:

   ```sql
   SELECT id, hash, created_at
   FROM drizzle.__drizzle_migrations
   ORDER BY created_at;
   ```

   Confirmar la configuración real antes de ejecutar la consulta. No inferir la
   migración únicamente por su posición o fecha.

2. Comparar el registro con el archivo desplegado y con el journal del mismo
   artefacto de release.
3. Inspeccionar cada operación de `0002` y registrar, antes de cualquier cambio,
   la existencia de los objetos afectados y los conteos de datos relevantes.
4. Clasificar el entorno con las definiciones anteriores y adjuntar consultas,
   resultados y hash del artefacto. La evidencia no debe contener credenciales,
   JIDs completos, tokens ni contenido de clientes.

## 2. Copia de seguridad y prueba de restauración

Para cada base que pueda recibir migraciones:

1. Detener despliegues concurrentes y definir una ventana de cambio.
2. Crear una copia consistente en formato restaurable. Ejemplo para PostgreSQL:

   ```bash
   pg_dump --format=custom --no-owner --no-privileges \
     --file="vocero-before-baileys-YYYYMMDD-HHMM.dump" "$DATABASE_URL"
   ```

3. Calcular y registrar un checksum del archivo; almacenarlo cifrado y con acceso
   restringido.
4. Restaurar la copia en una base aislada y desechable. Nunca ensayar sobre la
   base de origen.
5. Verificar que la restauración abre, que las tablas críticas existen y que los
   conteos acordados coinciden con el origen en el instante de la copia.
6. Registrar duración, responsable, comandos aprobados y evidencia sanitizada.

Una copia no se considera válida hasta que la restauración haya sido ensayada.

## 3. Selección de la ruta de migración

### Todos los entornos son `never_applied`

1. No desplegar la versión destructiva actual de `0002`.
2. Conservar la evidencia del hash actual para auditoría.
3. Sustituir o regenerar la secuencia no publicada con una migración que preserve
   datos; revisar también snapshots, journal y las dependencias de `0003`.
4. Probar desde una copia restaurada representativa: migración completa, arranque,
   lectura de datos existentes y rollback operativo.
5. Repetir el gate completo antes de aprobar el release.

Reescribir una migración solo es admisible cuando existe evidencia de que nunca
fue aplicada en **ningún** entorno compartido.

### Algún entorno es `applied`

1. No reescribir `0002`, su snapshot ni su identidad histórica.
2. Determinar con evidencia qué datos u objetos se modificaron. No prometer
   recuperación basándose únicamente en el SQL de la migración.
3. Elegir explícitamente una de estas rutas:
   - migración correctiva solo hacia adelante, probada sobre una copia restaurada;
   - restauración de una copia anterior y replay controlado de escrituras válidas.
4. Documentar pérdida potencial de datos y obtener aprobación del responsable
   antes de continuar.
5. Probar la ruta elegida de punta a punta en un clon antes de producción.

### Estado `mixed` o `unknown`

Detenerse. No modificar archivos históricos ni ejecutar migraciones. Reconciliar
primero el inventario y diseñar una ruta específica por entorno.

## 4. Orden de despliegue

1. Fijar commit/artefacto, hashes y responsable del cambio.
2. Confirmar una sola réplica de aplicación para Baileys (`FR-B09`).
3. Pausar cambios de esquema y, si corresponde, escrituras de negocio.
4. Crear y restaurar la copia de seguridad.
5. Ejecutar únicamente la ruta de migración aprobada desde un proceso controlado.
6. Verificar journal, esquema, invariantes y conteos antes de arrancar la app.
7. Desplegar una réplica de la aplicación.
8. Verificar health checks y recuperación de intents/dispatches pendientes sin
   iniciar un segundo socket por organización.
9. Ejecutar la prueba con dispositivo real de la sección 6.
10. Reabrir tráfico y observar errores estables, reconexiones, leases vencidos y
    duplicados durante la ventana acordada.

## 5. Límites de rollback

- No usar una migración inversa automática para deshacer operaciones destructivas.
  La recuperación es hacia adelante o mediante una copia restaurada y validada.
- Una restauración pierde las escrituras posteriores a la copia salvo que exista
  un mecanismo de replay probado.
- Revertir la aplicación solo es seguro si el esquema resultante continúa siendo
  compatible con la versión anterior.
- El estado de autenticación de WhatsApp puede avanzar durante el despliegue. Un
  logout invalida credenciales y puede exigir un QR nuevo.
- Un envío aceptado cuyo resultado quedó ambiguo no se reintenta con un ID nuevo.
  Se conserva el mismo idempotency key, ID de mensaje y `wa_message_id`.
- Volver a Cloud API no es un rollback operativo soportado por esta fase.

## 6. Prueba con dispositivo real

Prerrequisitos:

- número de prueba autorizado y aceptación explícita del riesgo de Baileys;
- una sola réplica;
- copia restaurable validada;
- observabilidad sanitizada;
- conversación sandbox identificable, que nunca debe tocar WhatsApp.

Registrar para cada paso: hora UTC, operador, organización, build, resultado y
referencia de evidencia sanitizada.

| Paso | Prueba | Resultado esperado | Evidencia |
|---|---|---|---|
| 1 | Acceso a Configuración → WhatsApp | Solo el owner puede ver o cambiar el canal; un member recibe 403 | PARCIAL 2026-07-14: la instancia solo tiene 1 usuario (owner); el 403 a member está cubierto por unit test (`baileys-access.test.ts`). Repetir en vivo cuando exista un member. |
| 2 | Conexión por QR | Estado `qr` → `connected`; el teléfono confirma el vínculo | ✅ 2026-07-14, operador (dueño): sesión vinculada y `connected`; `baileys_auth` con creds activas (1354 filas, updated_at avanza con el tráfico). |
| 3 | Entrada con dirección LID | Se resuelve al teléfono canónico mediante la dirección alternativa; no se crea un contacto LID | PARCIAL: el entrante real resolvió a teléfono canónico (contacto numérico, sin contacto LID en BD); no se pudo confirmar si WhatsApp usó dirección LID en este caso. Lógica cubierta por unit tests (`resolveMessagePhone`). |
| 4 | Ingesta | El mensaje aparece una sola vez en Inbox/SSE; unread y dispatch avanzan una sola vez | ✅ 2026-07-14 03:04:39 UTC: entrante único, `processed_at` seteado, 1 fila en `agent_dispatch` → `completed` (attempts=1, sin error), 0 duplicados de `wa_message_id` en toda la tabla. |
| 5 | Respuesta manual | Una petición con UUID crea un único intent y un único mensaje visible en el teléfono | ✅ 2026-07-14 03:07:32 y 03:08:57 UTC: 2 envíos, cada uno con `idempotency_key`, `delivery_attempts=1`, `delivery_state=sent`, visibles en el teléfono receptor (confirmado por el operador). |
| 6 | Acknowledgements | El estado progresa de forma monotónica por sent/delivered/read cuando corresponda | ✅ ambos salientes llegaron a `status=read` sin regresiones. |
| 7 | Reinicio de la app | La sesión se reanuda sin QR y recupera trabajo pendiente | ✅ 2026-07-13/14: reinicios del server durante la verificación reanudaron la sesión desde `baileys_auth` sin QR (creds intactas post-boot). |
| 8 | Corte y retorno de red | Existe una sola reconexión activa y el canal vuelve a `connected` | PENDIENTE (no inducido de forma controlada). |
| 9 | Retry con ID estable | Repetir exactamente UUID y contenido tras un resultado inducido como ambiguo no duplica fila ni mensaje y conserva IDs | PENDIENTE — no se indujo resultado ambiguo; no se marca por inferencia (regla de esta sección). Lógica cubierta por `outbound-delivery.test.ts`. |
| 10 | Logout | Se eliminan credenciales, queda `disconnected` y no se programa reconexión | ✅ 2026-07-14: logout remoto desde el teléfono → `baileys_auth` pasó a 0 filas, sin errores ni reintentos de reconexión en el log; la UI reporta desconectado (polling 200). |
| 11 | Sandbox negativo | Enviar desde una conversación `is_test` no invoca el socket ni llega al teléfono | PARCIAL: cubierto por unit tests (`send-sandbox`, `lab-sandbox`); corrida viva del Lab pendiente de token de IA real. |

Si no es posible inducir de forma controlada el resultado ambiguo del paso 9,
el paso queda pendiente; no debe marcarse como aprobado por inferencia.

## 7. Gates y condiciones de parada

Detener o revertir el cambio si ocurre cualquiera de estas condiciones:

- estado `unknown` o `mixed` de `0002`;
- hash inesperado o journal inconsistente;
- copia ausente, checksum inválido o restauración no ensayada;
- más de una réplica con capacidad de abrir sockets;
- migración parcial, conteos inesperados o pérdida de datos no aprobada;
- suite completa, typecheck, lint o build en rojo;
- QR, LID, ack, reinicio, reconexión, logout, retry estable o sandbox sin evidencia;
- errores que contengan contenido de cliente, provider bodies, tokens o JIDs;
- duplicados de mensajes, sockets, unread increments o agent dispatches;
- crecimiento sostenido de intents/dispatches pendientes o leases vencidos.

## 8. Evidencia técnica disponible

Evidencia repetible del worktree actual (2026-07-14):

- `corepack pnpm typecheck`: aprobado.
- `corepack pnpm lint`: aprobado.
- `corepack pnpm build`: aprobado con Next.js 15.5.20.
- `corepack pnpm test`: 30 archivos y 124 tests aprobados.
- Playwright Chromium: 4/4 smokes aprobados contra el build de producción
  (`/api/health`, login + headers, redirect privado y API privada 401).
- `corepack pnpm audit --prod`: sin vulnerabilidades conocidas.
- El dump `vocero-20260713-215409.dump` está preservado fuera del repositorio.
- La ejecución automática equivalente está definida en `.github/workflows/ci.yml`.

Esta evidencia cubre el software local. No reemplaza la rotación de credenciales,
la verificación de migraciones/restauración ni la prueba con un teléfono real.

## 9. Aprobación

- Gates locales de código: **APROBADOS** el 2026-07-14.
- Rotación de credencial Cloudflare: **PENDIENTE DE CONFIRMACIÓN DEL RESPONSABLE**.
- Migración + restauración sobre el artefacto de release: **PENDIENTE**.
- Matriz de dispositivo real sobre el candidato actual: **PENDIENTE**.
- Aprobación de datos/operaciones: **PENDIENTE**.
- Decisión de release: **BLOQUEADO** hasta cerrar todos los puntos anteriores.
