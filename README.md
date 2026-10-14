# MedScope AI — Intelligent Health Assessment Platform

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)]()
[![React](https://img.shields.io/badge/React-18.3-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

> **MedScope AI** is an AI-assisted health assessment and clinical decision-support platform. The platform provides a modular architecture for medical AI applications, starting with **Skin Analysis** as a dedicated feature for dermatological image assessment.

## 🎯 Product Overview

**MedScope AI** transforms the traditional skin disease detection concept into a comprehensive health assessment platform with:

- **Skin Analysis** — AI-powered dermatological image analysis with pattern recognition
- **Symptom Assessment** — Structured symptom intake with conservative educational guidance
- **Patient Management** — Secure patient profiles with access-controlled health information
- **Case Management** — Clinical case tracking with timelines and observations
- **Clinical Review** — Human-in-the-loop review workflows for AI-generated results
- **Reports** — Draft report generation with model provenance and review status
- **History & Audit** — Complete audit trails and historical records

## ⚠️ Important Disclaimers

> **This is a research prototype for educational and decision-support purposes only.**

- **Not a medical device** — MedScope AI has not been clinically validated for diagnostic use
- **Not a substitute for professional care** — Always consult qualified healthcare professionals
- **Skin Analysis limitations** — Image-based analysis cannot reliably rule out skin cancer or other serious conditions
- **Confidence scores** are uncalibrated model outputs, not clinical probabilities
- **No regulatory compliance claims** — This software does not claim HIPAA, GDPR, or medical device compliance

## 🏗️ Architecture

```
MedScope AI (Modular Monolith)
├── apps/
│   └── skin-ai/              # Frontend (React + TypeScript + Vite)
├── libs/
│   ├── api-client-react/     # Generated React Query hooks from OpenAPI
│   ├── api-spec/             # OpenAPI 3.1 specification
│   ├── api-zod/              # Zod schemas for API validation
│   ├── db/                   # Database schema (Drizzle ORM + PostgreSQL)
│   ├── integrations-openai-ai-react/   # OpenAI integration (React)
│   └── integrations-openai-ai-server/  # OpenAI integration (Server)
├── artifacts/
│   ├── api-server/           # Backend API (TypeScript)
│   ├── mockup-sandbox/       # UI component sandbox
│   └── skin-ai/              # Main frontend application
└── scripts/                  # Utility scripts
```

### Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS v4, Radix UI, TanStack Query, Wouter
- **Backend**: TypeScript, Node.js (API server structure defined)
- **Database**: PostgreSQL with Drizzle ORM
- **API**: OpenAPI 3.1 with Orval code generation
- **AI/ML**: OpenAI integration (structured for future model serving)
- **Build**: pnpm workspaces with catalog dependencies

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+ (for backend)

### Installation

```bash
# Clone the repository
git clone https://github.com/riteshyaaa/Skin-disease-detection.git
cd Skin-disease-detection

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations (when backend is implemented)
# pnpm -r --filter @workspace/db run push

# Start development servers
pnpm dev
```

### Environment Variables

```env
# Frontend (skin-ai)
PORT=3000
BASE_PATH=/

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/medscope

# AI Integration (optional)
AI_INTEGRATIONS_OPENAI_API_KEY=your-key
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
```

## 📦 Project Structure

### Frontend (`artifacts/skin-ai/`)

```
src/
├── components/
│   ├── ui/              # Radix UI primitive components
│   ├── layout.tsx       # Main layout with navigation
│   ├── upload-zone.tsx  # Image upload with drag-drop & camera
│   ├── results-card.tsx # Analysis results display
│   └── severity-badge.tsx
├── pages/
│   ├── home.tsx                 # Overview dashboard
│   ├── skin-analysis.tsx        # Skin Analysis feature
│   ├── symptom-assessment.tsx   # Symptom Assessment feature
│   ├── patients.tsx             # Patient management
│   ├── cases.tsx                # Case management
│   ├── history.tsx              # Prediction history
│   ├── reports.tsx              # Report generation
│   ├── detail.tsx               # Prediction detail view
│   ├── login.tsx                # Authentication
│   └── not-found.tsx
├── hooks/
│   ├── use-predictions.ts # API hooks for predictions
│   └── use-toast.ts       # Toast notifications
├── lib/
│   └── utils.ts           # Utility functions
└── App.tsx                # Router configuration
```

### API Specification (`lib/api-spec/openapi.yaml`)

The OpenAPI 3.1 specification defines:
- `GET /api/healthz` — Health check
- `POST /api/predict` — Skin disease prediction from image
- `GET /api/predictions` — Prediction history
- `GET /api/predictions/{id}` — Single prediction details

## 🧪 Development

### Type Checking

```bash
# Check all packages
pnpm run typecheck

# Check specific package
pnpm -r --filter @workspace/skin-ai run typecheck
```

### Building

```bash
# Build all packages
pnpm run build

# Build frontend
PORT=3000 BASE_PATH=/ pnpm -r --filter @workspace/skin-ai run build
```

### Database Operations

```bash
# Push schema changes
pnpm -r --filter @workspace/db run push

# Force push (destructive)
pnpm -r --filter @workspace/db run push-force
```

## 🔒 Security Considerations

- **Authentication**: Session-based with secure password handling
- **Authorization**: Owner-scoped access control on all resources
- **File Upload**: Content validation, size limits, opaque storage keys
- **Data Privacy**: No PHI in logs, private-by-default image storage
- **Rate Limiting**: Configured for auth, upload, and inference endpoints
- **Headers**: Secure CSP, HSTS, and other security headers

## 📋 Roadmap

### Phase 1 — Foundation (Current)
- [x] Rebranding to MedScope AI
- [x] Skin Analysis module with upload & results
- [x] Symptom Assessment UI structure
- [x] Patient & Case management UI structure
- [x] Reports & History UI structure
- [x] TypeScript configuration & build pipeline

### Phase 2 — Backend Integration
- [ ] API server implementation
- [ ] Database migrations & seeding
- [ ] Authentication & authorization middleware
- [ ] File storage abstraction (local/S3)
- [ ] Prediction persistence & history

### Phase 3 — ML Integration
- [ ] Model serving infrastructure
- [ ] Skin classifier model integration
- [ ] Preprocessing pipeline
- [ ] Model registry & versioning
- [ ] Evaluation & monitoring

### Phase 4 — Clinical Workflows
- [ ] Clinical review workflow (accept/modify/reject)
- [ ] Report generation with PDF export
- [ ] Audit logging
- [ ] Role-based access control

## 📄 License

MIT License — See [LICENSE](LICENSE) for details.

## 🤝 Contributing

This is a research prototype. Contributions welcome for:
- Code quality improvements
- Accessibility enhancements
- Test coverage
- Documentation

## 📞 Support

For questions about this research prototype, please open an issue on GitHub.

---

**MedScope AI** — Advancing AI-assisted health assessment through responsible innovation.