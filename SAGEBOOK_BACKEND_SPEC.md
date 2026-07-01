# Sagebook Backend & Test Shell Architecture Specification

This document serves as the absolute source of truth for the implementation of the Sagebook backend engine. Sagebook is an AI-driven, multimodal multi-currency personal wealth and net-worth tracking ledger.

---

## 1. System Requirements & Environment Configuration

### Global Settings
- **Target OS Environment:** Windows 11 (ARM64 on Surface Pro)
- **Node Version Manager:** fnm (Fast Node Manager)
- **Primary Runtime:** Node.js (Latest LTS) / TypeScript
- **Database Engine:** PostgreSQL (Managed via Supabase)
- **AI Processing Layer:** Gemini 1.5 Flash via `@google/genai`

### Directory Layout Blueprint
```text
sagebook/
├── SAGEBOOK_BACKEND_SPEC.md  # This document
├── backend/
│   └── supabase/
│       ├── config.toml
│       ├── functions/
│       │   └── process-media/
│       │       └── index.ts    # Main Edge Function (Hono + Gemini)
│       └── migrations/
│           └── 20260616000000_init_ledger.sql
└── test-shell/
    ├── index.html              # Barebones HTML Testing Harness
    ├── package.json
    └── main.ts                 # Basic client orchestration logic