# Anonymizer Core

Anonymous AI Mediation Platform — Phase 1: Proof of Concept

## Overview

Anonymizer Core is an enterprise AI mediation platform that strips Personally Identifiable Information (PII) and corporate identifiers from prompts before routing them to external AI providers. The platform ensures zero-knowledge anonymity while providing a premium, cyber-secure glassmorphism interface.

## Tech Stack

- **Frontend:** Next.js 16 + React 19 + Tailwind CSS v4 + Framer Motion + Lucide Icons
- **Backend:** FastAPI (Python) + python-jose + httpx
- **Database:** PostgreSQL via Supabase
- **Auth:** Supabase Auth (JWT-based)
- **AI Provider:** OpenAI API (configurable)

## Project Structure

```
OP-Maskin/
├── frontend/                 # Next.js application
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/mediate/ # API proxy route to backend
│   │   │   ├── console/     # Main chat workspace
│   │   │   ├── login/       # Authentication page
│   │   │   ├── globals.css  # Design system tokens
│   │   │   └── layout.tsx   # Root layout with fonts
│   │   ├── lib/
│   │   │   └── supabase.ts  # Supabase client
│   │   └── middleware.ts    # Auth route guards
│   └── .env.local           # Frontend environment variables
├── backend/                  # FastAPI application
│   ├── middleware/
│   │   ├── auth.py          # JWT verification (Supabase)
│   │   └── anonymizer.py    # PII redaction engine
│   ├── main.py              # FastAPI app + /api/v1/mediate
│   ├── schema.sql           # PostgreSQL DDL
│   ├── requirements.txt     # Python dependencies
│   └── .env                 # Backend environment variables
├── DESIGN.md                 # Design system specification
└── README.md                 # This file
```

## Quick Start

### Prerequisites

- Node.js 20+ and npm
- Python 3.11+
- Supabase account (free tier)
- OpenAI API key

### 1. Frontend Setup

```bash
cd frontend
npm install
```

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
BACKEND_URL=http://localhost:8000
```

```bash
npm run dev
```

Frontend runs on `http://localhost:3000`

### 2. Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

Create `.env`:

```env
SUPABASE_JWT_SECRET=your-super-secret-jwt-token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
DATABASE_URL=postgresql://postgres:...@db.supabase.co:5432/postgres
OPENAI_API_KEY=sk-your-openai-key
```

```bash
python main.py
```

Backend runs on `http://localhost:8000`

### 3. Database Setup

Run the DDL in `backend/schema.sql` via the Supabase SQL Editor to create:
- `tenants` — organization isolation
- `user_profiles` — user metadata linked to Supabase Auth
- `tenant_usage_metrics` — anonymized token usage (no plain text stored)

## Key Features (Phase 1)

- **Glassmorphism Auth Page:** Animated login with terminal-style status readout
- **Secure Chat Console:** Sidebar with system status, message stream, real-time input
- **PII Redaction Engine:** Regex-based anonymization (emails, IPs, SSNs, phones, credit cards)
- **JWT Auth Middleware:** Supabase token verification on every API call
- **Zero-Logging Architecture:** No plain-text prompts stored in database
- **Framer Motion Animations:** Smooth page transitions and message reveals

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Service health check |
| `/api/v1/mediate` | POST | Bearer JWT | Anonymize + forward prompt to AI |

## Phase 2 Roadmap

- NLP-based PII detection (Microsoft Presidio)
- Organization-level RBAC
- Analytics dashboard (token usage, costs)
- Multi-model support (GPT-4, Claude, etc.)
- SOC2/GDPR compliance documentation

## License

Encrypted by Default.
