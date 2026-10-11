# UniAce Mastery Hub — Revised Engineering & Verification Plan

This document incorporates all user feedback regarding precise verification metrics, zero-fallback definitions, resilient provider failover, spark escrow integrity, and trust features.

---

## 1. Precise "Zero-Fallback" Definition & Resilience Policy
- **Banned**: Hardcoded fallback strings, simulated LLM replies, mock credit balances, and static quiz arrays when providers are down.
- **Allowed & Encouraged (Resilience)**: Multi-provider failover (`groq` -> `gemini_direct` -> `mistral_direct` -> `cohere` -> `huggingface` -> `openrouter_free` -> `nvidia`). Failover is core architectural resilience, NOT a fallback in the negative sense. When all providers fail, return authentic HTTP status codes (503 Service Unavailable / 429 Rate Limited) with clear user retry actions instead of fake answers.

---

## 2. Quantitative Accuracy & Golden Set Evaluation
- **Golden Set Harness**: A test suite of 150 benchmark academic questions across Mathematics, Physics, Computer Science, and Chemistry with verified ground-truth answers and LaTeX proofs.
- **Pass Criterion**: Models must score $\ge 90\%$ factual and mathematical correctness across benchmark runs.

---

## 3. Pass/Fail Criteria per Component

| Component / Subsystem | Verification Criterion | Pass / Fail Condition |
|-----------------------|------------------------|------------------------|
| **Spark Escrow Ledger** | Pre-auth & Settle | 100% of failed/aborted streams refund unused pre-authorized sparks within 2 seconds. Idempotency keys prevent double-charging. |
| **Stream Abort & Disconnect** | Network Drop Handling | Client disconnect or tab close triggers server-side stream cancellation and immediate spark refund. |
| **Math Rendering & CAS** | KaTeX & Verification | Zero unescaped math blocks; complex derivations checked via SymPy/backend validation. |
| **CI Guard Against Mocks** | Static Analysis | Static linter rule / grep fails build if strings like `"mock response"`, `"placeholder reply"`, or hardcoded AI fallback arrays appear in production code. |
| **Firestore Security Rules** | Emulator Test Suite | Client attempts to write directly to `users/{uid}.ai_sparks` or `role` are rejected with permission-denied. |
| **Prompt-Injection Defense** | RAG / Vision Shield | Uploaded notes and documents are scrubbed for hidden instructions (`ignore previous instructions`, `reveal system prompt`). |
| **Student Trust & Telemetry** | Model Attribution | UI displays "Answered by Groq (llama-3.3-70b)" and provides a "Report Wrong Answer" button feeding the golden eval set. |

---

## 4. Architecture Enhancements

1. **Append-Only Spark Ledger**: Every spark transaction logs an immutable ledger entry with idempotency keys (`idempotency_token`).
2. **Circuit Breakers & Provider Health**: Real-time health metrics per provider stored in Firestore `system_settings/api_keys` with automatic degradation and recovery.
3. **Cost vs. Spark Margin Tracking**: Logging actual API token costs against charged sparks for financial auditing.
