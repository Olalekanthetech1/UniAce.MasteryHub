# UniAce Mastery Hub

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs)](https://nodejs.org/)
[![Firebase](https://img.shields.io/badge/Firebase-Authentication%20%26%20Firestore-FFCA28?logo=firebase)](https://firebase.google.com/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-4169E1?logo=postgresql)](https://www.postgresql.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

UniAce Mastery Hub is an AI-assisted university learning platform. It is designed to help students understand course material, practise concepts, assess their understanding, revise, and prepare for examinations. It complements lecturers, tutors, and student learning communities; it is not intended to replace them.

The platform combines a React application, an Express API, Firebase Authentication, Firestore, and PostgreSQL-backed academic data. Course content and academic availability are governed by persisted institutional and administrator-controlled data rather than frontend-only assumptions.

---

## Contents

- [Core capabilities](#core-capabilities)
- [Academic content model](#academic-content-model)
- [Academic levels and course availability](#academic-levels-and-course-availability)
- [Architecture and data responsibilities](#architecture-and-data-responsibilities)
- [API reference: academic availability](#api-reference-academic-availability)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Local development](#local-development)
- [Environment configuration](#environment-configuration)
- [Build, tests, and deployment](#build-tests-and-deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Core capabilities

### Learning and academic support
- Course-oriented learning experiences for university students.
- AI-assisted explanations and academic help.
- Guided practice, quizzes, revision, and examination preparation.
- Mathematical notation and technical learning content.
- Multi-provider AI integrations, depending on configured credentials and provider availability.

### Course and curriculum administration
- Course lifecycle management with separate draft, review, published, and archived states.
- Course scope targeting for global, faculty, or department audiences.
- Administrator tools for managing academic catalog visibility independently of course publication.
- Audit records for academic availability changes.

### Student access controls
- Student-facing catalog visibility is checked by the backend.
- Course access continues to enforce the student's academic profile, level, semester, department/faculty mapping, and configured course scope.
- Hidden or unconfigured availability is treated as unavailable rather than being assumed to be accessible.

---

## Academic content model

Academic lessons support validated, typed content blocks rather than relying on one unstructured lesson string. The current block schema includes:

| Block type | Intended use |
|---|---|
| `explanation` | Conceptual and descriptive teaching |
| `mathematical_derivation` | Step-by-step mathematical reasoning |
| `engineering_diagram` | Technical diagrams and their supporting content |
| `worked_example` | Given data, method, steps, and a result |
| `interactive_simulation` | Constrained, validated mathematical simulations |
| `knowledge_check` | A reference to a learning activity or assessment |
| `structured_block` | Extensible structured content for discipline-specific needs |

The schema validates block structure, identifiers, and knowledge-check references. Simulation expressions are restricted to an allowlisted arithmetic/function model; they are not arbitrary executable code.

The structured block format is intentionally extensible so that different disciplines can represent their content without forcing every subject into one generic module template.

---

## Academic levels and course availability

Academic availability is separate from the course publication lifecycle. Publishing a course does not, by itself, make it accessible to students.

### Availability states

| State | Student catalogue | Direct course access |
|---|---|---|
| **Live** | Visible when the student's profile and course targeting match | Allowed only when both the course and its academic level are Live and all existing access checks pass |
| **Coming Soon** | Visible as a locked/upcoming item | Blocked |
| **Hidden** | Omitted from student-facing level/course listings | Blocked; hidden course access is returned as Not Found |

Both the academic level and the individual course must be Live before a student can open the course. Existing profile, department/faculty, course-scope, level, and semester checks still apply.

### Administrator controls

The Admin Dashboard includes:

- **Academic Level Availability:** view configured levels, change each level's state, and add future levels.
- **Course Student Access:** set each course's student visibility to Live, Coming Soon, or Hidden.
- **Availability overview:** see per-level published, student-live, and locked/hidden counts, with a warning when a level is Live but has no student-live courses.
- **Availability audit history:** review recent state changes, including the actor and timestamp.

Only authenticated administrators can use the admin availability endpoints. Availability controls do not delete course content, student progress, or change the course's draft/review/published/archived lifecycle state.

### Initial database defaults

On the first successful academic-availability schema setup, the system inserts these defaults only when the level key does not already exist:

| Academic level | Initial availability |
|---|---|
| 100 Level | Live |
| 200 Level | Coming Soon |
| 300 Level | Coming Soon |
| 400 Level | Coming Soon |
| 500 Level | Coming Soon |

Existing level settings are not overwritten by these default inserts.

For existing course rows whose student visibility has not yet been set, the additive migration preserves visibility for courses already in the `published` lifecycle state by setting them to Live. Other lifecycle states are initialized as Hidden. Newly created courses default to Hidden until an administrator explicitly changes student availability.

### Database migration behavior

The availability service creates or updates the following PostgreSQL structures:

- `academic_level_availability` — persisted level labels, ordering, and availability.
- `courses.student_visibility` — independent student-facing availability for each course.
- `academic_availability_audit` — records availability state changes.
- Supporting indexes and database constraints for valid availability states.

The migration is additive, transaction-protected, and serialized with a PostgreSQL advisory transaction lock. It is invoked by the academic-availability service when that functionality is first used; it is not evidence that a hosted production database has already been migrated.

**Operational requirement:** configure `DATABASE_URL` for the API runtime. Verify the database connection and successful migration in the target environment before relying on the availability controls there.

---

## Architecture and data responsibilities

| Layer | Responsibility |
|---|---|
| React + TypeScript + Vite | Student and administrator interfaces |
| Express API on Node.js | Authenticated application APIs and server-side access enforcement |
| Firebase Authentication | User identity and authentication |
| Firebase Firestore | Existing application data and Firebase-backed functionality |
| PostgreSQL | Relational course/catalog data and academic availability records |
| AI provider integrations | AI-assisted learning features, subject to configured provider credentials and service availability |

PostgreSQL connectivity is configured through `DATABASE_URL`. The `ENABLE_POSTGRES_CATALOG` flag controls the PostgreSQL catalog path. Other PostgreSQL feature flags are listed in `.env.example`; enable them only when the corresponding feature and data path have been configured and verified.

---

## API reference: academic availability

All routes below require Firebase-authenticated requests. Routes under `/api/admin` additionally require administrator authorization.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/academic-levels` | Return student-visible academic levels; Hidden levels are omitted |
| GET | `/api/admin/academic-levels` | Return all configured levels and their states |
| POST | `/api/admin/academic-levels` | Add an academic level |
| PATCH | `/api/admin/academic-levels/:levelKey` | Update a level's availability, label, or ordering |
| PATCH | `/api/admin/courses/:id/availability` | Update a course's student visibility |
| GET | `/api/admin/academic-availability/audit` | Return recent availability audit records |

### Example request bodies

Add a level:

```json
{
  "levelKey": "600",
  "label": "600 Level",
  "availability": "hidden",
  "sortOrder": 600
}
```

Change a level's availability:

```json
{
  "availability": "live"
}
```

Change a course's student visibility:

```json
{
  "availability": "coming_soon"
}
```

The accepted availability values are `live`, `coming_soon`, and `hidden`. New levels default to Hidden when availability is omitted. The audit endpoint accepts an optional `limit` query parameter.

---

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS, Lucide React |
| Backend | Node.js, Express, TypeScript, WebSocket/SSE-related services |
| Authentication | Firebase Authentication, Firebase Admin SDK |
| Data | Firebase Firestore, PostgreSQL, `pg` connection pool |
| Academic content and validation | Zod, Math.js, Mermaid |
| AI integrations | Google GenAI, Groq, Mistral, Cohere, Hugging Face, NVIDIA, OpenRouter (configured providers only) |
| Build and deployment | Bun, Vite, esbuild, Docker; hosting configuration is environment-specific |

Versions above describe the current repository dependencies/configuration, not a promise that every optional integration is enabled in every deployment.

---

## Repository structure

```text
UniAce.MasteryHub/
├── .github/
│   └── workflows/             # CI quality checks
├── public/                    # Static assets and PWA resources
├── server/
│   ├── repositories/          # Database repositories
│   ├── routes/                # Express API routes
│   ├── services/              # Academic availability, course access, and domain services
│   ├── postgresPool.ts        # PostgreSQL connection pool and health checks
│   └── providers.ts           # AI provider integrations/routing
├── src/
│   ├── components/            # Student and administrator interfaces
│   │   └── admin/             # Administrator management components
│   ├── services/              # Frontend API/service clients
│   ├── shared/                # Shared schemas and academic content validation
│   ├── types/                 # TypeScript types and database models
│   └── utils/                 # Shared utilities
├── tests/                     # Automated tests
├── server.ts                  # Express application entry point
├── package.json               # Dependencies and scripts
├── bun.lock                   # Locked Bun dependencies
├── tsconfig.json              # TypeScript configuration
├── Dockerfile                 # Container build definition
└── vite.config.ts              # Vite configuration
```

---

## Local development

### Prerequisites

- Node.js 22 (matches the repository's GitHub Actions quality workflow).
- Bun (used by CI and the committed lockfile).
- Firebase project credentials for authenticated application functionality.
- PostgreSQL connection string for PostgreSQL-backed catalog and academic-availability functionality.
- Credentials for any AI/payment/messaging integrations you intend to exercise locally.

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/Olalekanthetech1/UniAce.MasteryHub.git
   cd UniAce.MasteryHub
   ```

2. Install the locked dependencies:

   ```bash
   bun install --frozen-lockfile
   ```

3. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

4. Add the credentials and configuration required for the features you intend to run. Do not commit `.env` or real secrets.

5. Start the development server:

   ```bash
   bun run dev
   ```

The development script starts the Express server and Vite middleware. The default application port is 3000 unless overridden by the runtime configuration.

---

## Environment configuration

The repository's `.env.example` is the canonical list of supported environment variable names. It includes configuration for Firebase, PostgreSQL, AI providers, administrator accounts, Paystack, email, and optional messaging integrations.

Important variables include:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string; required for PostgreSQL-backed academic availability |
| `ENABLE_POSTGRES_CATALOG` | Enables the PostgreSQL catalog read path |
| `ENABLE_POSTGRES_GENERATION_JOBS` | Feature flag for PostgreSQL-backed generation jobs |
| `ENABLE_POSTGRES_PROGRESS` | Feature flag for PostgreSQL-backed progress functionality |
| `ENABLE_POSTGRES_SHADOW_WRITE` | Feature flag for the PostgreSQL shadow-write path |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin service-account configuration |
| `ADMIN_EMAILS` | Administrator email configuration |
| `GROQ_API_KEY`, `COHERE_API_KEY`, `MISTRAL_API_KEY`, `HUGGINGFACE_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY` | Optional AI provider credentials, depending on the active provider configuration |
| `PAYSTACK_SECRET_KEY` | Paystack server-side integration credential |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL` | Outbound email configuration |

Do not place private keys or service-account JSON in source files, frontend variables, commits, or public issue comments. Only expose values prefixed with `VITE_` when they are explicitly designed to be public client-side configuration.

---

## Build, tests, and deployment

### Automated quality checks

Run the same core commands used by the repository's quality workflow:

```bash
# Unit tests
bun run test

# TypeScript validation
bun run lint

# Production build (also runs TypeScript validation)
bun run build
```

GitHub Actions runs the quality workflow for pull requests targeting `main`, pushes to `main` and `feature/**` branches, and manual workflow dispatches. The workflow executes unit tests, TypeScript validation, and the production build.

### Production build and start

```bash
bun run build
bun run start
```

The build produces the Vite client bundle and bundles the Express server into `dist/server.js`. Supply all required runtime environment variables through the hosting platform or deployment secret manager.

### Docker

A Dockerfile is included for container-based deployment:

```bash
docker build -t uniace-mastery-hub .
docker run -p 3000:3000 --env-file .env uniace-mastery-hub
```

Deployment configuration, environment secrets, database connectivity, and migration execution must be verified in the target hosting environment. Merging code into `main` does not by itself confirm that a production deployment has completed or that a production database migration has run.

---

## Contributing

1. Create a focused feature branch from `main`.
2. Make changes that follow the existing TypeScript and service boundaries.
3. Add or update tests for behavior changes.
4. Run `bun run test`, `bun run lint`, and `bun run build`.
5. Open a pull request against `main`, describing the behavior, relevant migration impact, and verification performed.

Avoid presenting mock data, fabricated academic references, static success fallbacks, or unverified external operations as real results. When an operation depends on live data or a configured service, handle unavailable or unverified states explicitly.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
