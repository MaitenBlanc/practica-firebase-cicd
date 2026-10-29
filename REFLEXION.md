# Reflexión y Evidencia — Prácticas de Programación Avanzada (2026)

---

# Clase 1: Práctica CI/CD con Firebase Hosting y Hardening HTTP

## Medición de Headers (`check-headers.mjs`)

### Antes del hardening (B1 — Medición inicial)

```text
▶ HTML: https://practica-firebase-cicd-33d61.web.app/
  status 200
  ✘ content-security-policy (falta)
  ✔ strict-transport-security: max-age=31556926; includeSubDomains; preload
  ✘ x-content-type-options (falta)
  ✘ x-frame-options (falta)
  ✘ referrer-policy (falta)
  ✘ permissions-policy (falta)
  · cache-control: max-age=3600

▶ Asset estático: /_next/static/chunks/1x6obpmlu1_c2.js
  ✘ cache-control: max-age=3600

❌ 6 control(es) pendiente(s).
```

### Después del hardening (B5 — Medición final en preview / producción)

```text
▶ HTML: https://practica-firebase-cicd-33d61.web.app/
  status 200
  ✔ content-security-policy: default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' https://pi…
  ✔ strict-transport-security: max-age=63072000; includeSubDomains; preload
  ✔ x-content-type-options: nosniff
  ✔ x-frame-options: DENY
  ✔ referrer-policy: strict-origin-when-cross-origin
  ✔ permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  · cache-control: no-cache

▶ Asset estático: /_next/static/chunks/1x6obpmlu1_c2.js
  ✔ cache-control: public, max-age=31536000, immutable

✅ Todos los controles pasaron.
```

---

## Preguntas de reflexión (Sección 8)

### 1. ¿Por qué el preview tiene vencimiento? ¿Qué riesgos tendría un preview que no vence nunca?
Los preview channels son entornos efímeros creados para validar un Pull Request puntual antes de integrarlo. Configurar un vencimiento (`expires: 3d`) garantiza la limpieza automática de recursos. Si los previews no vencieran nunca:
- **Superficie de ataque permanente ("zombie environments")**: Quedarían publicadas versiones preliminares con bugs, dependencias desactualizadas o configuraciones de seguridad incompletas en URLs públicamente accesibles y indexables si se filtran.
- **Confusión y desalineación**: Usuarios o testers podrían seguir accediendo a versiones obsoletas creyendo que son actuales, o consumir cuotas de almacenamiento/tráfico innecesariamente.

### 2. ¿Qué diferencia hay entre *desplegar* y *liberar*? ¿Dónde aparece cada concepto en este flujo?
- **Desplegar (Deploy)**: Es el acto técnico de compilar artefactos e instalarlos en un entorno de infraestructura (por ejemplo, subir el directorio `out/` a un canal de preview o al almacenamiento de versiones de Firebase Hosting). No implica necesariamente que los usuarios finales reciban ese cambio.
- **Liberar (Release)**: Es el acto de negocio/operativo de exponer una versión ya desplegada al tráfico de los usuarios finales en producción.
- **En nuestro flujo**:
  - Cuando el workflow de PR publica en un *preview channel*, estamos **desplegando** sin liberar al público general.
  - Cuando ejecutamos un **rollback** desde el historial de versiones de Firebase Hosting o promovemos un canal con `firebase hosting:clone <PROJECT_ID>:<CANAL> <PROJECT_ID>:live`, estamos cambiando qué versión apunta al canal `live` (**liberando** o revirtiendo la liberación) en segundos y sin recompilar ni volver a desplegar desde cero.
  - *Nota sobre el estado de `main` tras un rollback (A6)*: Hacer rollback en Firebase Hosting revierte la versión liberada en el CDN, pero `main` en Git sigue conteniendo el commit problemático. Si otro PR se mergea después, volverá a desplegar el código roto a menos que el equipo alinee Git con la realidad operativa mediante un `git revert` en `main`.

### 3. ¿Por qué la clave de la service account va en un secreto y no en el repo? ¿Qué podría hacer alguien que la obtenga? ¿Cómo limitarías el daño?
- **Por qué va en un secreto**: El repositorio es público (y aun si fuera privado, el historial de Git persiste en cada clon). Versionar el JSON de la Service Account expondría credenciales privadas de largo plazo.
- **Impacto de filtración**: Quien obtenga esa clave puede autenticarse contra Google Cloud / Firebase y desplegar contenido malicioso (phishing, malware, defacement) en producción en nombre del proyecto, borrar canales o consumir cuota del plan.
- **Cómo limitar el daño (Principio de mínimo privilegio y defensa en profundidad)**:
  1. **Permisos mínimos (IAM)**: Asignar a la Service Account únicamente el rol `Firebase Hosting Admin` (`roles/firebasehosting.admin`), sin permisos de `Owner`/`Editor` sobre el resto del proyecto GCP.
  2. **Rotación y revocación**: Si se compromete, revocar la clave inmediatamente en IAM y generar una nueva, o mejor aún, reemplazar llaves JSON estáticas por **Workload Identity Federation (OIDC)** entre GitHub Actions y Google Cloud para usar tokens efímeros sin llaves permanentes.
  3. **Restricción en GitHub**: Proteger la rama `main`, no exponer secretos a PRs provenientes de forks y usar GitHub Environments (`production`) con revisores obligatorios.

### 4. La CSP rompió la app: ¿por qué? ¿Qué opciones evaluaste y qué costo de seguridad tiene cada una?
Al aplicar la política base (`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'`), se rompieron dos partes:
1. **El filtro interactivo en `/cursos` dejó de funcionar**: Aunque es un export estático (`out/cursos.html`), Next.js App Router inserta etiquetas `<script>` inline (sin atributo `src`, como `self.__next_f.push(...)`) para bootstrapping de Turbopack y para hidratar el payload RSC del Client Component (`FiltroCursos`). Con `script-src 'self'`, el navegador bloquea todo script inline.
2. **La imagen de portada en `/` se bloqueó**: El `<img src="https://picsum.photos/...">` solicita un recurso externo a `picsum.photos`, el cual responde con una redirección HTTP `302` hacia el CDN `https://fastly.picsum.photos/...`. En CSP, las redirecciones requieren autorizar tanto el origen inicial como el origen destino en `img-src`.

**Opciones evaluadas para `script-src` y su costo de seguridad**:
- **Opción A (`'unsafe-inline'`)**: Permitir cualquier script inline. *Costo de seguridad alto*: neutraliza la principal defensa de CSP contra Cross-Site Scripting (XSS), ya que cualquier inyección HTML lograría ejecutar JS arbitrario.
- **Opción B (`nonce-<valor>`)**: Inviable en Firebase Hosting (plan Spark / export estático), porque un nonce debe generarse aleatoriamente en cada request HTTP y no existe un servidor dinámico que reescriba el HTML por petición.
- **Opción C (Elegida — Hashes `'sha256-...'` calculados en el pipeline)**: Se implementó `scripts/generate-csp-hashes.mjs`, que corre automáticamente al finalizar `next build`, extrae todos los bloques `<script>` inline de `out/**/*.html`, calcula sus hashes SHA-256 y actualiza la directiva `script-src 'self' 'sha256-...'` en `firebase.json`. *Costo de seguridad mínimo*: mantiene el bloqueo total contra scripts inyectados por atacantes, autorizando exclusivamente los scripts inmutables generados en el build. (En `style-src` se habilitó `'unsafe-inline'` para estilos de atributos internos de React/Next.js, cuyo riesgo es significativamente menor que en `script-src`).

### 5. Para cada header de B2, ¿qué ataque mitiga?
- **`Strict-Transport-Security` (HSTS)**: Mitiga ataques **Man-in-the-Middle (MitM) / SSL Stripping** (como `sslstrip`) y secuestro de sesión en redes no confiables, obligando al navegador a conectarse exclusivamente por HTTPS durante el `max-age` definido.
- **`X-Content-Type-Options: nosniff`**: Mitiga ataques de **MIME Confusion / MIME Sniffing**, impidiendo que el navegador ignore el `Content-Type` declarado y ejecute archivos estáticos o subidos por usuarios como si fueran HTML o JavaScript ejecutable.
- **`X-Frame-Options: DENY`** (junto con `frame-ancestors 'none'` en CSP): Mitiga ataques de **Clickjacking (UI Redressing)**, impidiendo que un sitio malicioso embeba nuestra aplicación dentro de un `<iframe>` invisible para engañar al usuario y hacerle clickear elementos sin saberlo.
- **`Referrer-Policy: strict-origin-when-cross-origin`**: Mitiga la **fuga de información sensible en URLs (Information Disclosure)** hacia terceros; cuando se navega hacia otro dominio, solo envía el origen (`https://dominio`) y oculta la ruta específica y los query parameters.
- **`Permissions-Policy`**: Mitiga el **abuso de APIs sensibles del navegador** (cámara, micrófono, geolocalización, USB, pagos) en caso de compromiso de dependencias de terceros o XSS, aplicando el principio de mínimo privilegio en el cliente.
- **`Cross-Origin-Opener-Policy: same-origin` (Adicional)**: Mitiga ataques de **Reverse Tabnabbing** y aislamiento de procesos (Spectre/cross-origin leaks) al cortar la referencia `window.opener` con documentos de otros orígenes.

### 6. ¿Por qué los assets de `/_next/static/` pueden cachearse un año y el HTML no?
- **Assets en `/_next/static/**` (`public, max-age=31536000, immutable`)**: Next.js aplica *content addressing* (fingerprinting): el nombre de cada archivo JS/CSS incluye un hash criptográfico derivado de su contenido (ej. `1x6obpmlu1_c2.js`). Si cambia una sola línea de código en un nuevo build, el archivo generado tendrá otro nombre distinto. Por ende, un nombre dado jamás cambia de contenido y puede cachearse por 1 año sin riesgo de servir código viejo.
- **Archivos HTML (`no-cache`)**: Las rutas como `/` (`index.html`) o `/cursos` (`cursos.html`) tienen URLs fijas que no cambian entre versiones y actúan como el punto de entrada que referencia qué nombres de chunks de `/_next/static/` deben cargarse. Si el HTML se cacheara sin revalidar (por ejemplo, `max-age=3600` o superior), tras un deploy o un rollback de emergencia los usuarios seguirían viendo la versión vieja hasta que expire su caché local, o tendrían inconsistencias de versiones. Con `no-cache`, el navegador revalida el ETag del HTML en cada visita y, si hubo un deploy o rollback, descarga el nuevo HTML inmediatamente mientras reutiliza los chunks estáticos que no hayan cambiado.

### 7. Si la app necesitara SSR, ¿qué cambiaría en la arquitectura, en la CSP y en el costo?
- **En la arquitectura**: Ya no alcanzaría con servir archivos estáticos pregenerados en `out/` mediante el CDN de Firebase Hosting. Habría que quitar `output: "export"` de `next.config.ts` y desplegar un runtime de Node.js (por ejemplo, usando **Firebase App Hosting** o **Cloud Run** detrás del CDN de Firebase Hosting) capaz de ejecutar código en el servidor en cada petición o Server Action.
- **En la CSP**: Al existir un servidor que procesa cada request dinámicamente (vía `middleware.ts` de Next.js), podríamos generar un **nonce criptográfico único por request** (`script-src 'self' 'nonce-...' 'strict-dynamic'`), inyectándolo en el header HTTP de respuesta y en los `<script>` renderizados en esa petición, en lugar de precalcular hashes estáticos sobre archivos en disco.
- **En el costo**: Se perdería el costo cero garantizado del plan **Spark** (que solo cubre almacenamiento y transferencia estática dentro de límites gratuitos). Tanto Firebase App Hosting como Cloud Run / Cloud Functions exigen pasar al **plan Blaze (pago por uso con tarjeta de crédito asociada)**, sumando costos por tiempo de CPU/memoria de ejecución de contenedores, invocaciones, Cloud Build y Artifact Registry.

---

# Clase 2: SQL con Firebase SQL Connect — Modelo Relacional y Autorización

## 1. Auditoría de Seguridad (`npm run atacar`) — Entregable 2

### Antes de corregir la fuga (L4 vulnerable)

```text
$ npm run atacar

> practica-firebase-cicd@1.0.0 atacar
> node scripts/atacar.mjs

Auditoría de SQL Connect · proyecto practica-firebase-cicd-33d61 · emuladores locales

✔ ListCursos responde sin login (7 cursos) — público por diseño
✘ ListAlumnos devuelve datos personales SIN login
    Ejemplo filtrado: {"email":"ana@ejemplo.test","id":"seed-uid-ana","nombre":"Ana Ficticia"}
[2026-10-29T17:14:33.645Z]  @firebase/data-connect: DataConnect (13.1.0): Error while performing request: {"code":16,"message":"unauthenticated: this operation requires a signed-in user","details":[{"@type":"type.googleapis.com/google.firebase.dataconnect.http.GraphqlError","message":"@auth rejected the request","locations":[],"path":null,"extensions":{"file":"","code":"UNAUTHENTICATED","debugDetails":"@auth(level: USER) requires a signed-in user","resource":"","warningLevel":"WARNING_LEVEL_UNKNOWN","workarounds":[]}}]}
✔ Inscribirme rechazada sin login
    unauthenticated: this operation requires a signed-in user
✔ Inscribirme es idempotente (repetir no falla)
✔ MisInscripciones solo devuelve lo del usuario que llama
✔ B no puede dar de baja a A

❌ 1 vulnerabilidad(es) · 0 pendiente(s)
```

### Después de corregir L4 (`@auth(level: NO_ACCESS)`)

```text
$ npm run atacar

> practica-firebase-cicd@1.0.0 atacar
> node scripts/atacar.mjs

Auditoría de SQL Connect · proyecto practica-firebase-cicd-33d61 · emuladores locales

✔ ListCursos responde sin login (7 cursos) — público por diseño
[2026-10-29T17:22:18.153Z]  @firebase/data-connect: DataConnect (13.1.0): Error while performing request: {"code":7,"message":"unauthorized: you are not authorized to perform this operation","details":[{"@type":"type.googleapis.com/google.firebase.dataconnect.http.GraphqlError","message":"@auth rejected the request","locations":[],"path":null,"extensions":{"file":"","code":"PERMISSION_DENIED","debugDetails":"@auth(level: NO_ACCESS) always reject non-admin requests","resource":"","warningLevel":"WARNING_LEVEL_UNKNOWN","workarounds":[]}}]}
✔ ListAlumnos rechazada para un cliente
    unauthorized: you are not authorized to perform this operation
[2026-10-29T17:22:18.169Z]  @firebase/data-connect: DataConnect (13.1.0): Error while performing request: {"code":16,"message":"unauthenticated: this operation requires a signed-in user","details":[{"@type":"type.googleapis.com/google.firebase.dataconnect.http.GraphqlError","message":"@auth rejected the request","locations":[],"path":null,"extensions":{"file":"","code":"UNAUTHENTICATED","debugDetails":"@auth(level: USER) requires a signed-in user","resource":"","warningLevel":"WARNING_LEVEL_UNKNOWN","workarounds":[]}}]}
✔ Inscribirme rechazada sin login
    unauthenticated: this operation requires a signed-in user
✔ Inscribirme es idempotente (repetir no falla)
✔ MisInscripciones solo devuelve lo del usuario que llama
✔ B no puede dar de baja a A

✅ Todos los controles pasaron
```

---

## 2. Preguntas de reflexión — Clase 2 (Sección 10)

### 1. ¿Por qué ninguna operación de este conector recibe el id del alumno como variable? ¿Qué es IDOR y cómo lo evita `auth.uid`?
- **Qué es IDOR (Insecure Direct Object Reference — OWASP API1: Broken Object Level Authorization)**: Es una vulnerabilidad donde la API confía en un identificador enviado por el cliente (por ejemplo, `$alumnoId` en el body, query string o variables GraphQL) para acceder o modificar recursos sin verificar que dicho identificador pertenezca al usuario que realiza la petición.
- **Qué pasaría si se recibiera `$alumnoId` como variable**: Como el bundle del cliente es público y cualquiera puede invocar las operaciones del conector directamente, un atacante podría enviar el `uid` de otro alumno en `MisInscripciones($alumnoId)`, `Inscribirme($alumnoId, $cursoId)` o `DarmeDeBaja($alumnoId, $cursoId)` para espiar sus cursos, inscribirlo sin su consentimiento o darle de baja.
- **Cómo lo evita `auth.uid` (`_expr: "auth.uid"`)**: Al usar expresiones de servidor (`id_expr: "auth.uid"` y `alumnoId_expr: "auth.uid"`), la operación **no acepta el identificador desde el cliente**. El servidor de SQL Connect extrae el `uid` directamente del token JWT firmado criptográficamente por Firebase Auth. Así, cada usuario queda estrictamente confinado a leer, insertar o borrar únicamente sus propias filas.

### 2. `ListCursos` es `PUBLIC` y `ListAlumnos` terminó en `NO_ACCESS`. ¿Qué criterio usaste? ¿Cómo haría el "panel de admin" para listar alumnos?
- **Criterio aplicado (Clasificación de datos y Principio de Mínimo Privilegio)**:
  - `ListCursos` expone el catálogo de oferta académica, que es información pública por requerimiento de negocio (cualquier visitante debe poder consultar los cursos antes de registrarse); por eso se declara `@auth(level: PUBLIC)` con su `insecureReason` explícito.
  - `ListAlumnos` devuelve **datos personales identificables (PII)**: `id`, `nombre` y `email` de todos los usuarios registrados. Dejarla en `PUBLIC` permitía a cualquier anónimo descargar la base de usuarios, y cambiarla a `USER` seguiría siendo vulnerable porque cualquier alumno autenticado podría listar los correos y nombres de todos sus compañeros. Como ningún flujo de la aplicación cliente necesita listar alumnos, corresponde `@auth(level: NO_ACCESS)`.
- **Cómo resolver el "panel de admin" sin exponer datos**:
  1. **Vía backend administrativo / Cloud Functions / CLI**: Las operaciones con `NO_ACCESS` solo bloquean llamadas desde los SDKs de cliente, pero pueden seguir ejecutándose desde entornos de servidor autenticados con credenciales de **Google Cloud IAM** (por ejemplo, mediante Firebase Admin SDK o desde la consola de Cloud/Firebase).
  2. **Vía Custom Claims en Firebase Auth (si el panel fuera una app cliente)**: Si existiera un frontend de administración, se asignaría un custom claim (`admin: true`) al token de los administradores desde el Admin SDK y se crearía una operación específica protegida con una expresión CEL en el servidor: `@auth(expr: "auth.token.admin == true")`.

### 3. ¿Qué ventaja tiene una clave primaria compuesta en `Matricula` frente a validar duplicados en el código del cliente? (`insert` vs `upsert` y restricciones adicionales)
- **Integridad garantizada en el motor relacional**:
  1. **Seguridad frente a clientes que saltean la UI**: Las validaciones en el frontend son puramente cosméticas para la experiencia de usuario; un atacante puede llamar directamente al endpoint de SQL Connect ignorando la interfaz.
  2. **Prevención de condiciones de carrera (TOCTOU — Time-of-Check to Time-of-Use)**: Si se validara leyendo primero si existe la inscripción y luego insertando, dos peticiones concurrentes pasarían la verificación al mismo tiempo y crearían registros duplicados. Declarar `@table(key: ["alumno", "curso"])` traduce la regla a un constraint `PRIMARY KEY (alumno_id, curso_id)` en PostgreSQL, haciendo imposible a nivel físico que existan dos filas para el mismo par `(alumno, curso)`.
- **Diferencia entre `matricula_insert` y `matricula_upsert` (L2)**:
  - `matricula_insert` ejecuta un `INSERT INTO matricula ...` puro; si el alumno intenta inscribirse por segunda vez al mismo curso, PostgreSQL arroja un error de violación de clave primaria (`duplicate key value violates unique constraint`).
  - `matricula_upsert` ejecuta un `INSERT ... ON CONFLICT (alumno_id, curso_id) DO UPDATE ...`, logrando que la operación `Inscribirme` sea **idempotente**: repetir la petición mantiene una única inscripción sin fallar ni duplicar filas.
- **Índices y restricciones adicionales propuestas para producción (Nivel Destacado — L1)**:
  - **Índice sobre `curso_id`**: La clave primaria compuesta `(alumno_id, curso_id)` indexa eficientemente las búsquedas por `alumno_id` (como `MisInscripciones`), pero para consultar todos los inscriptos de un curso o contar vacantes ocupadas por curso conviene un índice adicional `CREATE INDEX idx_matricula_curso ON matricula(curso_id)` (o `@index` en el campo `curso`).
  - **Restricción de dominio y control de cupo**: Agregar un `CHECK (cupo >= 0)` y `CHECK (horas > 0)` en `Curso`, y un trigger en PostgreSQL (o validación transaccional) que verifique que `COUNT(*) WHERE curso_id = NEW.curso_id < curso.cupo` antes de permitir el `INSERT` en `Matricula`.

### 4. La configuración de Firebase (`apiKey`, etc.) es pública. ¿Por qué eso no compromete la base de datos? ¿Qué capa faltaría para frenar a alguien que usa esa config desde un script?
- **Por qué la `apiKey` pública no compromete la base**: En Firebase, la `apiKey` no es un secreto de autorización sino un identificador de proyecto para enrutar las peticiones hacia la infraestructura correcta. La seguridad de los datos reside en el servidor:
  1. SQL Connect **no acepta SQL arbitrario** desde el cliente; solo permite invocar por nombre las operaciones `.gql` precompiladas en el conector desplegado.
  2. Cada operación valida en el servidor su directiva `@auth` y extrae la identidad real (`auth.uid`, `auth.token.email`) del JWT firmado por Firebase Auth, no de parámetros manipulables.
- **Qué capa falta para frenar scripts automatizados (`Firebase App Check`)**:
  Aunque un script externo (como `scripts/atacar.mjs`) no puede violar las reglas de `@auth`, sí puede usar la `apiKey` pública para consumir cuota de lecturas públicas (`ListCursos`) o automatizar la creación masiva de cuentas en Firebase Auth (abuso de facturación / denegación de servicio). La capa que falta es **Firebase App Check** (con un proveedor de atestación como **reCAPTCHA Enterprise** en web): App Check exige que cada request incluya un token de atestación que prueba que la llamada proviene de nuestra aplicación web legítima corriendo en un navegador real y en nuestro dominio autorizado, bloqueando scripts de Node.js, `curl` o clientes no oficiales antes de que lleguen a la base.

### 5. Comparado con una API REST propia (`Express + pg`) y con Firestore Rules, ¿qué te da SQL Connect y qué perdés?
- **Frente a una API REST propia (`Express + pg`)**:
  - **Qué te da SQL Connect**: Eliminación de código repetitivo (boilerplate) de backend; generación automática de migraciones DDL de PostgreSQL a partir de `schema.gql`; prevención de inyección SQL por diseño (queries parametrizadas compiladas en el servidor); autorización declarativa co-localizada en cada operación (`@auth`); tipado extremo a extremo y despliegue sin mantener servidores Node.js propios (arquitectura *serverless* compatible con frontend estático).
  - **Qué perdés**: Flexibilidad para ejecutar lógica de negocio imperativa compleja antes o después de una consulta (por ejemplo, enviar un email transaccional, llamar a una pasarela de pagos externa, usar transacciones multi-paso con lógica condicional o integrar librerías de terceros en el mismo endpoint), además de cierto acoplamiento (*vendor lock-in*) a las directivas de Firebase Data Connect.
- **Frente a Firestore Security Rules**:
  - En **Firestore**, el modelo es NoSQL documental y el cliente arma las consultas dinámicamente desde el navegador, mientras las *Firestore Rules* evalúan permisos a nivel de documento/camino. Si una regla queda mal escrita o si se requiere cruzar varias colecciones con integridad referencial, el cliente tiene demasiada libertad de consulta y no existen *foreign keys* ni *joins* reales.
  - En **SQL Connect**, el modelo es **PostgreSQL relacional real** (con claves foráneas, claves compuestas y tipos estrictos) y la autorización es **a nivel de operación con nombre** (*stored queries* GraphQL): el cliente nunca decide qué tablas o columnas cruzar ni qué filtros aplicar, solo invoca el nombre de la operación autorizada.

### 6. ¿Por qué no alcanzó con la CSP de la clase 1 y por qué conviene listar dominios exactos en `connect-src`? (Análisis de producción y migración SQL)
- **Por qué no alcanzó con `connect-src 'self'` de la Clase 1**: En la Clase 1 los cursos estaban embebidos estáticamente en el código y la aplicación no hacía peticiones `fetch`/`XHR` a servicios externos. En la Clase 2, el navegador necesita comunicarse por red desde el cliente con tres servicios remotos de Firebase:
  1. `https://identitytoolkit.googleapis.com`: API de Firebase Auth para registro (`signUp`), login (`signInWithPassword`) y actualización de perfil (`update`).
  2. `https://securetoken.googleapis.com`: API de Firebase Auth para renovación/refresco de tokens JWT (`getIdToken(true)`), indispensable al registrar al alumno antes de insertar su fila en PostgreSQL.
  3. `https://firebasedataconnect.googleapis.com`: Endpoint de producción de Firebase SQL Connect para ejecutar las queries y mutations del conector.
- **Por qué listar dominios exactos y NO usar comodines como `https://*.googleapis.com`**:
  Bajo `*.googleapis.com` operan decenas de servicios públicos de Google Cloud ( entre ellos `https://storage.googleapis.com`, Google Drive API, Firebase Realtime Database o Cloud Functions de cualquier proyecto de terceros). Si un atacante lograra una inyección o comprometiera una dependencia, un comodín `https://*.googleapis.com` en `connect-src` le permitiría **exfiltrar datos sensibles** (tokens, PII) hacia un bucket de Cloud Storage controlado por el atacante (`storage.googleapis.com/bucket-atacante`) sin que el navegador lo bloquee. Listar únicamente los tres orígenes exactos aplica el principio de mínimo privilegio a nivel de red en el navegador.
- **Análisis de la migración SQL en el deploy (`dataconnect:sql:diff` / L7)**:
  Al ejecutar el deploy de SQL Connect, la herramienta compara el esquema declarativo (`schema.gql`) contra el catálogo de PostgreSQL en Cloud SQL y genera las sentencias DDL correspondientes: creación de las tablas `"public"."curso"`, `"public"."alumno"` (con `id VARCHAR PRIMARY KEY`) y `"public"."matricula"`, definiendo `PRIMARY KEY ("alumno_id", "curso_id")` y las restricciones `FOREIGN KEY ("alumno_id") REFERENCES "public"."alumno" ("id") ON DELETE CASCADE` y `FOREIGN KEY ("curso_id") REFERENCES "public"."curso" ("id") ON DELETE CASCADE`, garantizando la integridad referencial en la base de producción.