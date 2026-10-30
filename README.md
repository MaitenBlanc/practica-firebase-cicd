# Catálogo de Cursos — Plataforma Serverless con Next.js y Firebase

Aplicación web de catálogo académico, inscripciones y reseñas en tiempo real construida con **Next.js 16 (Static Export)** y el ecosistema **Firebase** bajo el plan gratuito **Spark**.

El proyecto integra dos modelos de persistencia complementarios (**relacional con PostgreSQL / SQL Connect** para inscripciones con integridad referencial, y **documental en tiempo real con Cloud Firestore** para reseñas en vivo), protegidos mediante **Content Security Policy (CSP)**, directivas `@auth` en GraphQL, **Firestore Security Rules** con validación de esquema por lista blanca y pipelines de **CI/CD en GitHub Actions**.

- **Producción**: <https://practica-firebase-cicd-33d61.web.app>
- **Evidencia y reflexiones técnicas**: [`REFLEXION.md`](./REFLEXION.md)

---

## Evolución del Proyecto por Prácticas

| Práctica | Eje Técnico | Estado |
|---|---|---|
| **Práctica 1** | **CI/CD y Hardening HTTP**: Pipelines en GitHub Actions (Preview Channels por PR + Deploy a `live`), caché inmutable y cabeceras de seguridad (`CSP`, `HSTS`, `X-Frame-Options`, `Permissions-Policy`, `COOP`). | ✅ Completada |
| **Práctica 2** | **Firebase Auth + SQL Connect (PostgreSQL)**: Autenticación email/contraseña, esquema relacional (`Curso`, `Alumno`, `Matricula` con clave primaria compuesta), operaciones GraphQL autorizadas con `@auth` y auditoría automatizada contra vulnerabilidades IDOR/fuga de PII. | ✅ Completada |
| **Práctica 4** | **Cloud Firestore en Tiempo Real y Security Rules**: Subcolecciones `cursos/{cursoId}/resenas/{uid}`, suscripciones en vivo (`onSnapshot`), consultas de agregación (`count`, `average`), índice compuesto declarativo, reglas de seguridad y suite de tests unitarios contra el emulador. | ✅ Completada |

---

## Arquitectura General

```text
┌───────────────────────────────────────────────────────────────────────────────────┐
│                         Navegador (Next.js 16 Export Estático)                    │
│   • Firebase Hosting CDN + Headers de Seguridad (CSP estricta, HSTS, nosniff)     │
│   • Estado de sesión reactivo (useUsuario) + Caché local de Firestore             │
└───────────────┬───────────────────────────────┬───────────────────────────────────┘
                │                               │
                │ 1. Operaciones GraphQL        │ 2. Lecturas, escrituras y
                │    precompiladas + JWT        │    listeners WebChannel (onSnapshot)
                ▼                               ▼
┌───────────────────────────────┐ ┌─────────────────────────────────────────────────┐
│     Firebase SQL Connect      │ │                 Cloud Firestore                 │
│  • Conector: dataconnect/     │ │  • Subcolección: cursos/{cursoId}/resenas/{uid} │
│  • Autorización: @auth        │ │  • Seguridad: firestore.rules (lista blanca,    │
│    (PUBLIC, USER, NO_ACCESS)  │ │    identidad uid, serverTimestamp inmutable)    │
│  • Expresiones: auth.uid      │ │  • Índices: firestore.indexes.json              │
└───────────────┬───────────────┘ └─────────────────────────────────────────────────┘
                ▼
┌───────────────────────────────┐
│   PostgreSQL (Cloud SQL /     │
│   PGlite en emulador local)   │
│  • Tablas: curso, alumno,     │
│    matricula (PK compuesta)   │
└───────────────────────────────┘
```

### Por qué coexisten SQL Connect y Cloud Firestore

| Caso de uso en la app | Motor elegido | Justificación |
|---|---|---|
| **Catálogo e inscripciones a cursos** | **SQL Connect (PostgreSQL)** | Requiere esquema fijo, claves foráneas (`ON DELETE CASCADE`), unicidad garantizada por clave compuesta `(alumno_id, curso_id)` y operaciones cerradas definidas en el servidor. |
| **Reseñas y calificaciones en vivo** | **Cloud Firestore (NoSQL)** | Requiere sincronización instantánea entre navegadores (`onSnapshot`), compensación de latencia local (`hasPendingWrites`) y modelo jerárquico por subcolección donde el ID del documento (`{uid}`) garantiza una única reseña por usuario y curso. |

---

## Estructura del Repositorio

```text
├── .github/workflows/
│   ├── firebase-hosting-pull-request.yml  # CI + Preview Channel efímero (3d) + Gate de headers HTTP
│   └── firebase-hosting-merge.yml         # CD a producción (canal live, environment production)
├── app/
│   ├── components/
│   │   ├── CatalogoSql.tsx                # Catálogo conectado a SQL Connect + alta de inscripción
│   │   ├── FiltroCursos.tsx               # Buscador por texto, filtro por nivel y tarjetas de curso
│   │   ├── EstadoSesion.tsx               # Barra de estado de autenticación
│   │   └── ResenasCurso.tsx               # Formulario, resumen (count/average) y lista en vivo (Firestore)
│   ├── cursos/page.tsx                    # Página del catálogo de cursos
│   ├── ingresar/page.tsx                  # Login y registro con Firebase Auth + upsert de Alumno
│   └── mis-inscripciones/page.tsx         # Listado de inscripciones del alumno y baja
├── dataconnect/
│   ├── schema/schema.gql                  # Modelo relacional PostgreSQL (Curso, Alumno, Matricula)
│   ├── cursos/queries.gql                 # Queries GraphQL (ListCursos, MisInscripciones, ListAlumnos)
│   ├── cursos/mutations.gql               # Mutations GraphQL (RegistrarAlumno, Inscribirme, DarmeDeBaja)
│   └── seed_data.gql                      # Datos semilla para el emulador y producción
├── lib/
│   ├── firebase.ts                        # Inicialización de Firebase App, Auth y Data Connect
│   ├── sqlconnect.ts                      # Cliente del SDK generado para SQL Connect
│   ├── resenas.ts                         # Capa de acceso a Firestore (setDoc, deleteDoc, onSnapshot, agregaciones)
│   └── useUsuario.ts                      # Hook de suscripción al usuario autenticado
├── scripts/
│   ├── check-headers.mjs                  # Verificación automatizada de cabeceras HTTP y caché
│   ├── seed.mjs                           # Carga inicial de datos en el emulador de SQL Connect
│   └── atacar.mjs                         # Auditoría de seguridad contra las operaciones de SQL Connect
├── tests/
│   └── reglas.test.mjs                    # 10 tests automatizados de Firestore Security Rules
├── firebase.json                          # Configuración de Hosting, CSP, Firestore, Data Connect y Emuladores
├── firestore.rules                        # Reglas declarativas de seguridad de Cloud Firestore
├── firestore.indexes.json                 # Índices compuestos declarados como código
└── REFLEXION.md                           # Evidencias de auditoría, capturas y respuestas de todas las prácticas
```

---

## Requisitos Previos

- **Node.js 24 LTS** (requerido por `@firebase/rules-unit-testing@6` y el runner nativo `node --test`).
- **Java 21+** (requerido para ejecutar el emulador local de Cloud Firestore).

---

## Ejecución en Desarrollo Local (Emulator Suite)

En modo desarrollo (`NODE_ENV=development`), la aplicación se conecta automáticamente a los emuladores locales sin consumir cuota de producción:

- **Auth Emulator**: `127.0.0.1:9099`
- **Firestore Emulator**: `127.0.0.1:8080`
- **Data Connect (PostgreSQL / PGlite)**: `127.0.0.1:9399`
- **Emulator UI**: <http://127.0.0.1:4000>

### Pasos para levantar el entorno

1. **Instalar dependencias:**
   ```bash
   npm install
   ```
2. **Terminal 1 — Iniciar emuladores (Auth + SQL Connect + Firestore):**
   ```bash
   npm run emulators
   ```
3. **Terminal 2 — Poblar cursos iniciales en el emulador SQL (solo la primera vez):**
   ```bash
   npm run seed
   ```
4. **Terminal 2 — Iniciar servidor de desarrollo de Next.js:**
   ```bash
   npm run dev
   ```
   Abrir <http://localhost:3000/cursos>.

---

## Scripts de Verificación, Seguridad y Testing

| Comando | Descripción |
|---|---|
| `npm run typecheck` | Verifica tipos de TypeScript (`tsc --noEmit`) sin emitir archivos. |
| `npm run test:reglas` | Levanta un emulador efímero de Firestore y ejecuta los 10 tests de seguridad en `tests/reglas.test.mjs`. |
| `npm run atacar` | Ejecuta la auditoría de seguridad contra el emulador de SQL Connect verificando protección contra IDOR y acceso no autorizado. |
| `node scripts/check-headers.mjs <URL>` | Audita las cabeceras HTTP de seguridad (`CSP`, `HSTS`, `X-Frame-Options`, etc.) y directivas `Cache-Control` contra una URL desplegada. |
| `npm run build` | Genera la exportación estática de producción en `out/`. |

---

## Despliegue a Producción

1. **Reglas e índices de Firestore:**
   ```bash
   npx firebase deploy --only firestore:rules,firestore:indexes
   ```
2. **Esquema y conectores de SQL Connect:**
   ```bash
   npx firebase deploy --only dataconnect
   ```
3. **Frontend y cabeceras de Hosting (vía CI/CD):**
   - Al abrir un **Pull Request**, el workflow `.github/workflows/firebase-hosting-pull-request.yml` compila la app, publica un **Preview Channel** con vencimiento de 3 días y ejecuta `scripts/check-headers.mjs` como *quality gate*.
   - Al hacer **merge a `main`**, el workflow `.github/workflows/firebase-hosting-merge.yml` despliega automáticamente al canal `live` de producción.
