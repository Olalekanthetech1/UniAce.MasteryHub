# UniAce Mastery Hub: Database Architecture FAQ & Stage 5B Specification

## Executive Overview & Architectural Q&A

This document directly addresses the four strategic questions regarding the **Neon PostgreSQL database integration**, the **Admin Dashboard governance interface**, the **credential configuration security model**, and the **authoritative division of roles between Firestore and Neon**.

---

## 1. Clear Answers to Your Four Key Questions

### Question 1: In which stage will I be able to add the Neon Database URL connection string to `.env` or related?

**Answer: Stage 5B (Pilot & Connection Verification Stage).**

- **Why Stage 5B**:
  - In Stage 5A (just completed), we built the strongly typed schema models, feature flags, repository abstraction layers, and multi-instance cache in TypeScript without requiring an active external database connection.
  - In **Stage 5B**, before running the pilot suites, you will provide the Neon connection string in your server environment:
    ```bash
    # .env
    DATABASE_URL="postgresql://[user]:[password]@[endpoint].neon.tech/uniace_db?sslmode=require"
    ```
  - An environment declaration template will be placed in `.env.example`:
    ```bash
    # .env.example
    DATABASE_URL=postgresql://user:password@ep-xyz.neon.tech/uniace_db?sslmode=require
    ```
  - In Stage 5B, an isolated connection probe script (`scripts/test-neon-connection.ts`) will test the TCP connection, SSL handshake, serverless scale-to-zero wake-up latency, and connection pooler (pgBouncer) parameters before any data migration begins.

---

### Question 2: Will you update the Admin Dashboard too, probably by adding a new tab or recommend?

**Answer: Yes — Expanded within the existing dedicated `'db-accounting'` (Database & Accounting) tab.**

- **Recommendation**:
  - In Stage 3B–4, we already constructed the dedicated **`'db-accounting'` tab** (`src/components/admin/DatabaseAccountingTab.tsx`) mounted inside `AdminDashboard.tsx`.
  - Rather than fragmenting the admin interface with multiple competing database tabs, we will enhance `'db-accounting'` with a dedicated **"Relational & Migration Control Console"** sub-section.
- **What will be displayed in the Admin Dashboard**:
  1. **Live Connection Health**: Indicator showing Neon status (`Connected` / `Disconnected` / `Awake`), ping latency (e.g. `18ms`), and SSL status.
  2. **Masked Connection String**: Displays sanitized URL for verification without exposing passwords (e.g., `postgresql://uniace_admin:••••••••@ep-cool-fog-123.neon.tech/uniace_db`).
  3. **Traffic Distribution Meter**: Real-time visualization of read/write operations routed to Firestore vs. Neon PostgreSQL.
  4. **Entity Migration Progress**: Real-time verification status for each entity (Users, Courses, Lessons, Progress, Quizzes) showing count parity and checksum validation.
  5. **Feature Flag Status**: Read-only display of active migration flags with audited, confirmation-gated toggle controls for authorized administrators.

---

### Question 3: Will I also be able to configure the Database URL in the Admin Dashboard?

**Answer: Recommended via server environment variables (`.env`) for production security, with a secure encrypted option in Admin Settings if required.**

- **The Security & Engineering Baseline**:
  - In modern full-stack web engineering, master database credentials contain full read/write root passwords.
  - Exposing an unencrypted browser input for `DATABASE_URL` creates serious security risks (vulnerability to browser extensions, XSS attacks, accidental exposure in screen shares, and storing secrets in client bundles).
  - Standard production practice is to configure `DATABASE_URL` via the container's environment variables (`.env` or Cloud Run Secret Manager).
- **The Safe Dual-Path Solution**:
  1. **Primary Method (Recommended)**: Set `DATABASE_URL` in `.env`. The Admin Dashboard reads and displays the connection status, host, database name, and masked credentials.
  2. **Admin Console Configuration (If Desired)**: The Admin Dashboard can allow updating the connection string, provided it is:
     - Sent via an authenticated, admin-only HTTPS POST endpoint (`/api/admin/system/database-config`).
     - Stored server-side in encrypted system settings (`system_settings/api_keys`), completely hidden from client bundles.
     - Protected by an Admin Re-Authentication / PIN confirmation step.

---

### Question 4: After all the implementation, which will be PRIMARY between Firestore and Neon Database, and what will be the role of each?

**Answer: Neon PostgreSQL becomes the PRIMARY database for all high-throughput application data, while Firebase/Firestore retains a specialized role for Authentication and real-time WebSocket state.**

Here is the exact division of responsibilities:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                 UNIACE MASTERY HUB                               │
└────────────────────────┬─────────────────────────────────┬───────────────────────┘
                         │                                 │
                         ▼                                 ▼
       ┌───────────────────────────────────┐    ┌──────────────────────────────────┐
       │     NEON POSTGRESQL (PRIMARY)     │    │    FIREBASE / FIRESTORE (ROLE)   │
       ├───────────────────────────────────┤    ├──────────────────────────────────┤
       │ 1. Course Catalog & Curricula     │    │ 1. Firebase Authentication       │
       │    • Courses, Modules, Lessons    │    │    • User ID, tokens, OAuth      │
       │    • STEM Formulas & Proofs       │    │    • Passwordless auth & JWTs    │
       │                                   │    │                                  │
       │ 2. Student Progress & Scaling     │    │ 2. Real-Time Presence / WS       │
       │    • user_study_batches (Atomic)  │    │    • Live study room roster      │
       │    • user_lesson_completions      │    │    • Ephemeral typing indicators │
       │    • user_course_progress         │    │                                  │
       │                                   │    │ 3. Historical Financial Baseline │
       │ 3. Assessments & Integrity        │    │    • Immutable legacy records    │
       │    • course_quizzes & versions    │    │    • Transitional Spark escrow   │
       │    • user_quiz_attempts (Scored)  │    │                                  │
       │                                   │    └──────────────────────────────────┘
       │ 4. Background Job Queues          │
       │    • course_generation_jobs       │
       │    • Worker leases & claims       │
       │                                   │
       │ 5. Cross-DB Transactional Outbox  │
       │    • transactional_outbox         │
       │    • Exactly-once Spark rewards   │
       └───────────────────────────────────┘
```

#### Detailed Breakdown of Roles:

1. **Neon PostgreSQL — The Primary Workhorse**:
   - **Why it is Primary**: Relational PostgreSQL completely **eliminates Firestore's 20,000 daily write quota limit** (`429 RESOURCE_EXHAUSTED`).
   - When thousands of students read lessons, submit quiz answers, or push progress batches every 60 seconds, **all of those writes and queries execute in Neon PostgreSQL**.
   - PostgreSQL provides atomic multi-row transactions, row-level locking (`FOR UPDATE SKIP LOCKED`) for background AI generation workers, composite foreign keys, and sub-millisecond query execution.
2. **Firebase / Firestore — Specialized Auth & Real-Time Sync**:
   - **Authentication**: Firebase Authentication continues to manage user sign-up, Google OAuth, and client session tokens.
   - **Low-Frequency / Real-Time Collaboration**: Ephemeral presence (who is online in a study room) and live WebSockets leverage Firebase, where document writes are minimal.
   - **Transitional Financial Escrow**: Spark pre-authorization and settlements remain grounded in Firestore's transaction engine until the full financial ledger migration is independently certified.
3. **The Anti-Split-Brain Invariant**:
   - There is **no permanent dual-write**.
   - Every individual entity has **exactly one authoritative primary source of truth**.
   - Courses, progress, quizzes, and generation jobs belong **100% to Neon PostgreSQL**.
   - Auth and session tokens belong **100% to Firebase**.

---

## 2. Updated Roadmap & Execution Plan

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 5A (COMPLETED & VERIFIED)                                                  │
│ • Relational models & types (src/types/databaseSchema.ts).                       │
│ • Feature flags (server/config/features.ts) disabled by default.                 │
│ • Repository layers: courseRepository, progressRepository, jobQueueRepository.   │
│ • Bounded catalog cache (server/cache/catalogCache.ts) with byte limits.         │
│ • All tests & lint checks passing (zero errors).                                 │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼ [Next Milestone for Review]
┌──────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 5B: Connection Setup & Controlled Pilots                                   │
│ 1. Configure DATABASE_URL in .env and .env.example.                              │
│ 2. Connection probe script (scripts/test-neon-connection.ts) for pool & SSL.      │
│ 3. Update Admin Dashboard ('db-accounting' tab) with Neon Connection Status Card.│
│ 4. Pilot 1: Generation Job Queue failure recovery & checkpoint resumption.       │
│ 5. Pilot 2: Normalized student progress batch deduplication sandbox test.        │
│ 6. Pilot 3: Cross-database transactional outbox relay to Firestore ledger.       │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼ [Formal User Authorization Gate]
┌──────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 5C: Controlled Entity Migration & Cutover                                  │
│ 1. Entity-by-entity data migration (Courses -> Lessons -> Progress -> Quizzes).  │
│ 2. Parity & checksum verification across all records.                            │
│ 3. Switch feature flags: ENABLE_POSTGRES_CATALOG = true, PROGRESS = true.        │
│ 4. Decommission course subcollections from Firestore. Zero quota consumed.       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Immediate Action

This explanation and roadmap are now incorporated into `implementation_plan.md`.
When you are ready, we will proceed with **Stage 5B** by adding the `DATABASE_URL` configuration template and building the connection probe and Admin Dashboard monitoring card.
