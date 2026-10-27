# Reflexión y Evidencia — Práctica CI/CD con Firebase Hosting y Hardening HTTP

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

