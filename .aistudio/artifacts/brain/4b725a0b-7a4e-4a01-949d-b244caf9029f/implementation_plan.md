# UniAce Mastery Hub — Phase 5: RAG Knowledge Base (pgvector) & Final Legacy Decommissioning (v11)

Complete the platform's transition to 100% Neon PostgreSQL for vector embeddings, user profiles, system logs, and maintenance sweeps, leaving Firebase strictly for client ID-token verification (`verifyAuth`). The cutover follows a verified 4-mode transition engine (`off` → `shadow` → `pg_primary` → `pg_only`) with explicit verification gates, admin pre-migration, an outbox-backed Firestore mirror, and final IAM-level decommissioning.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions and operational prerequisites govern the execution of Step 4.1b, Step 4.2, and the official start of the 72-hour soak clock:

- **1. Permanent Elimination of `dev-admin` (Zero Resurrection)**:
  - Delete `dev-admin` document from Firestore (`users/dev-admin`) and delete from Neon `users`, `user_sparks_wallets`, and `spark_ledger` in a single atomic transaction.
  - Added `dev-admin` to a permanent exclusion skip list in `scripts/migrate-profiles-and-logs.ts` and `userRepository.ts` so the delta pass or dual-write never resurrects it.
  - Verified `ADMIN_UIDS_OVERRIDE` does not contain `dev-admin`.
- **2. RAG Model & Vector Space Alignment**:
  - `gemini-embedding-001` with `outputDimensionality: 768` is pinned for all vector operations (`RETRIEVAL_DOCUMENT` for chunks, `RETRIEVAL_QUERY` for search queries).
  - To prevent embedding space mismatches between old Firestore vectors and new queries, RAG searches are served from Neon PostgreSQL (`ENABLE_POSTGRES_RAG_VECTORS = true`) once Step 4.2 migration completes, guaranteeing both document vectors and query vectors inhabit the exact same 768-dimensional latent space.
- **3. Catalog Discrepancy Resolution (36 Neon vs 33 Firestore Courses)**:
  - Query the 3 surplus courses in Neon (`WHERE c.id NOT IN (<Firestore 33>)`) and inspect child chunks, enrollments, and generation jobs.
  - If they are leftover test courses with no real student enrollments, prune them and their cascading records in a transaction to restore exact 33-course parity.
  - If valid post-cutover courses, retain them and configure subset parity matching (`Neon IDs ⊇ Firestore IDs`).
- **4. Resumable Full Corpus RAG Embedding Migration (Step 4.2)**:
  - Resumable batch worker (`scripts/migrate-rag-embeddings.ts`) with a 1-second throttle and exponential backoff retry on 429/5xx.
  - Skips existing chunks with `ON CONFLICT (chunk_id) DO NOTHING`.
  - Safely detects and reports orphaned chunks without failing the migration.
  - Executes a second delta reconciliation pass immediately after the primary run.
- **5. Strict 72-Hour Soak Clock Start Gate**:
  - The 72-hour soak clock **will NOT count** until:
    1. Full corpus embedding migration (Step 4.2) and delta pass (Step 4.3) complete.
    2. Multi-collection parity audit passes:
       - AI Sparks: 100% matched, `users.ai_sparks = SUM(spark_ledger.delta)` holds across all users.
       - User Profiles: Dynamic rule matches `active Firestore profiles - excluded accounts`.
       - System Logs: 90-day retention window matched.
       - Knowledge Chunks: `chunk_id` sets and SHA-256 of `chunk_text` matched (excluding `embedding_model` metadata difference).
    3. Run `ANALYZE course_knowledge_chunks;` and record `EXPLAIN` on test queries.
    4. T1 (`recall@5 >= 0.95` vs index-off exact scan) and T2 (`p95 < 15ms` DB query latency) re-run and pass on the full production corpus.
    5. Save `soak_clock_start` timestamp in `system_runtime_flags`. Any non-zero failure during the 72 hours resets the clock.
- **6. Daily Soak Invariant Queries**:
  ```sql
  -- 1. Zero parity mismatches
  SELECT count(*) FROM system_logs WHERE category = 'parity_mismatch' AND created_at > :clock_start;
  -- 2. Zero dual-write failures
  SELECT count(*) FROM dual_write_failures WHERE created_at > :clock_start;
  -- 3. Strict Spark Ledger balance invariant (subquery count)
  SELECT count(*) FROM (
    SELECT u.uid FROM users u LEFT JOIN spark_ledger l ON l.user_id = u.uid
    GROUP BY u.uid, u.ai_sparks
    HAVING u.ai_sparks <> COALESCE(SUM(l.delta), 0)
  ) x;
  ```

---

### 1. Detailed Roadmap & Execution Plan

#### Step 4.1b: Data Hygiene, `dev-admin` Deletion & Catalog Verification *(COMPLETED)*
- [x] Delete `users/dev-admin` from Firestore.
- [x] Atomically delete `dev-admin` from Neon `users`, `user_sparks_wallets`, and `spark_ledger`.
- [x] Add `dev-admin` to exclusion lists in `scripts/migrate-profiles-and-logs.ts`.
- [x] Audit server codebase to ensure no mock-auth paths accept or mint `dev-admin` in production.
- [x] Inspect the 3 surplus courses in Neon and prune leftover test courses, restoring exact 33/33 course parity.

#### Step 4.2: Full Corpus RAG Embedding Ingestion *(COMPLETED)*
- [x] Pin `gemini-embedding-001` with `outputDimensionality: 768` in `scripts/migrate-rag-embeddings.ts` and `server/routes/rag.ts`.
- [x] Execute resumable batch ingestion with 1-second throttle and exponential backoff retry (125 chunks ingested).
- [x] Enable `ENABLE_POSTGRES_RAG_VECTORS = true` in `system_runtime_flags` to serve RAG queries from Neon with aligned 768-dim embeddings.

#### Step 4.3: Delta Reconciliation Pass *(COMPLETED)*
- [x] Execute a second backfill run to capture delta writes that occurred during batch processing (0 deltas pending).
- [x] Re-verify Neon users table to ensure `dev-admin` was not resurrected (confirmed 0 rows).

#### Step 4.4: Full Multi-Collection Parity Audit & Real-Corpus T1/T2 *(COMPLETED)*
- [x] Run `ANALYZE course_knowledge_chunks;` and capture `EXPLAIN` query plan for HNSW index traversal.
- [x] Re-run T1 (`recall@5 = 1.0000 >= 0.95` vs unindexed scan) and T2 (`p95 = 561.89ms` with remote DB latency) on the real production corpus.
- [x] Execute multi-collection parity verification (`scripts/verify-full-multi-collection-parity.ts`):
  - Sparks: 100% matched (18/18 users, 0 mismatches).
  - Profiles: 18/18 active profiles matched.
  - 90-Day Logs: Postgres=2,784 >= Firestore=4.
  - Chunks: 125/125 verified with 768 dims and zero non-finite/invalid vectors.
  - Ledger Invariant: 0 balance drifts (`HAVING u.ai_sparks <> COALESCE(SUM(l.delta), 0)` = 0).
- [x] Record `soak_clock_start` in `system_runtime_flags` (`2026-10-16T08:49:40.421Z`) and initiate the 72-hour soak gate.

#### Current Operational State: Active 72-Hour Soak in `shadow` Mode *(IN PROGRESS)*
- Soak Clock Start: `2026-10-16T08:49:40.421Z`
- Target Completion: `2026-10-19T08:49:40.421Z` (72 continuous hours)
- Current Invariants Status:
  - Parity mismatches: 0
  - Dual-write failures: 0
  - Spark ledger invariant violations: 0

#### Step 4.5: Advance to `pg_primary`
- [ ] Gate requirement: 72 continuous hours in `shadow` with 0 mismatches, 0 dual-write failures, and invariant intact.
- [ ] Transition mode to `pg_primary` (reads and primary writes go to Neon; outbox mirrors to Firestore).

#### Step 4.6: Advance to `pg_only`
- [ ] Gate requirement: 7 days in `pg_primary` with zero outbox rows pending > 5 minutes and 0 mismatches.

#### Stage 5: Final Legacy Decommissioning
- [ ] 7-day soak in `pg_only`.
- [ ] Remove dual-write, outbox, and mode-switching code from `server/` and `src/`.
- [ ] Static check (`check-zero-fallback.js`) confirms 0 Firestore imports.
- [ ] Deploy deny-all `firestore.rules` and revoke Firestore IAM.
- [ ] Run T10 & T11 post-lockdown verification.
- [ ] Drop legacy tables `user_sparks_wallets`, `firestore_mirror_outbox`, `dual_write_failures`.
