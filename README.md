# Kora by Kognoz

<p align="center">
  <img src="kognoz_Iogo.png" alt="Kognoz Logo" width="220"/>
</p>

<p align="center">
  <strong>Enterprise Client Delivery Tracker for Integrations, Implementations & AMS</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Architecture-Vanilla_JS_SPA-0e7490.svg" alt="Architecture"/>
  <img src="https://img.shields.io/badge/Backend-Vercel_Serverless-black.svg" alt="Backend"/>
  <img src="https://img.shields.io/badge/Database-Supabase_PostgreSQL-3ECF8E.svg" alt="Database"/>
  <img src="https://img.shields.io/badge/PWA-Installable-blue.svg" alt="PWA"/>
</p>

---

## 📌 Overview

**Kora** is an enterprise-grade client delivery and project governance platform purpose-built for consulting and system integration firms. Developed for **Kognoz**, Kora provides real-time visibility and end-to-end lifecycle tracking across three critical client delivery domains:

1. **🔗 Integrations Tracker** — Manage system interfaces, API integrations, milestone deadlines, overdue/staleness alerts, and status history.
2. **🚀 Implementation Tracker** — Track modular ERP/HRMS rollouts across a structured 9-phase lifecycle (BPU, CRP, UAT, Data Migration, Go-Live, Hypercare).
3. **🛠️ AMS & Support** — Monitor managed services, support tickets (L1–L4 criticality), hours consumption against retainers, and automated billing summaries.

---

## ✨ Key Features

### 📊 Portfolio Dashboard & Health Scorecards
- **Bento Grid Layout**: High-density executive overview summarizing real-time RAG (Red/Amber/Green) statuses, active delivery risks, and capacity metrics.
- **Daily Snapshots**: Automated tracking of historic RAG trends and portfolio progression.
- **Overdue & Staleness Detection**: Real-time alerts flagging items lacking recent activity or approaching critical deadlines.

### 👥 Role-Based Access Control (RBAC)
- **Roles**: `admin`, `editor`, `viewer`.
- **Admin "View As" Simulation**: Admins can safely preview the application under viewer/editor roles without modifying server-side privileges.
- **Granular Permissions**: Restricts sensitive destructive operations, user management, and system configuration to authorized roles.

### 🔒 Enterprise Security & Concurrency
- **Optimistic Concurrency Control (OCC)**: Version tracking prevents race conditions and accidental overwrites during concurrent edits.
- **Hardened Authentication**: Bcrypt password hashing (cost factor 12), brute-force IP/username rate-limiting, and Microsoft Entra SSO integration.
- **Immutable Audit Logging**: Every mutation records user, action, target entity, timestamp, and client metadata.
- **Secure File Storage**: Uploaded attachments (PDFs, spreadsheets, images, emails) are stored in private Supabase buckets with signed expiring URLs.

### 📑 Automated Multi-Format Reporting
- **Branded Presentation Export**: One-click generation of client-ready PowerPoint (`.pptx`) decks via PptxGenJS.
- **Document & Spreadsheet Export**: Automated PDF reports (via jsPDF + AutoTable) and Excel workbooks (`.xlsx` via SheetJS) matching corporate brand typography and palettes.

### 📱 Progressive Web App (PWA)
- **Installable**: Full web app manifest, custom favicon suite, and standalone display support across mobile and desktop.
- **Offline Aware**: Real-time connection monitoring with persistent banners to protect unsaved local state during network outages.

---

## 🛠️ Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────┐
│                   Client Browser                       │
│  Vanilla JS Single Page App (No Framework, Zero Build) │
│  • Custom Design System (styles.css)                   │
│  • Client-Side URL Routing & Browser History           │
│  • Reactive innerHTML Rendering Engines                │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS / REST
┌───────────────────────────▼────────────────────────────┐
│              Vercel Serverless Functions               │
│  /api/login · /api/read · /api/write · /api/upload...  │
│  • Session Verification · OCC Conflict Handling        │
│  • Rate Limiting & Input Validation                    │
└───────────────────────────┬────────────────────────────┘
                            │ PostgREST / REST API
┌───────────────────────────▼────────────────────────────┐
│                 Supabase PostgreSQL                     │
│  clients · users · audit_log · snapshots · storage     │
└────────────────────────────────────────────────────────┘
```

- **Frontend**: Modern Vanilla JavaScript (ES6+), HTML5, Custom CSS Design System (`styles.css`), Tailwind CSS.
- **Backend API**: Node.js Serverless Functions deployed on Vercel (`/api/*`).
- **Database & Storage**: Supabase PostgreSQL with PostgREST REST API and Supabase Storage.
- **Libraries**:
  - [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) — PowerPoint generation
  - [jsPDF](https://github.com/parallax/jsPDF) & [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) — PDF document export
  - [SheetJS (xlsx)](https://sheetjs.com/) — Excel data export
  - [bcryptjs](https://github.com/dcodeIO/bcrypt.js) — Password hashing

---

## 📁 Repository Structure

```
kora/
├── api/                       # Vercel Serverless Backend Functions
│   ├── _audit.js              # Audit trail helper
│   ├── _auth.js               # Session verification & authorization
│   ├── _cors.js               # CORS origin validation & headers
│   ├── _dualwrite.js          # Dual-write sync utilities
│   ├── _errors.js             # Sanitized error response handler
│   ├── _storage.js            # Supabase Storage client wrapper
│   ├── _throttle.js           # Rate limiting & brute-force defense
│   ├── _validate.js           # Schema & payload sanitization
│   ├── account.js             # User profile & credentials management
│   ├── audit.js               # Audit log querying endpoint
│   ├── auth-microsoft.js      # Microsoft Entra SSO authentication
│   ├── cron/
│   │   └── backup.js          # Daily automated database snapshot cron
│   ├── login.js               # Password authentication handler
│   ├── read.js                # Authenticated data retrieval
│   ├── settings.js            # Platform configuration & capacity weights
│   ├── snapshot.js            # Historical RAG capture
│   ├── upload.js              # File attachment upload & signed URL signer
│   └── write.js               # OCC mutation & write gateway
│
├── js/                        # Frontend Application Modules
│   ├── admin.js               # Admin dashboard, audit viewer, user manager
│   ├── ams.js                 # AMS & support tracking views & billing
│   ├── core.js                # Global state (S), routing, utilities, API clients
│   ├── dashboard.js           # Bento grid dashboard, RAG calculations, metrics
│   ├── events.js              # Central delegated event dispatcher & init
│   ├── export.js              # PPTX, PDF, and XLSX report generators
│   ├── implementation.js      # 9-phase implementation tracker & grids
│   ├── integrations.js        # Integrations management & milestone trackers
│   ├── modal.js               # Universal modal engine & interactive dialogs
│   └── shell.js               # Navigation shell, collapsible sidebar, layout
│
├── icons/                     # PWA app icons (192px, 512px, maskable)
├── favicon.svg                # Vector brand favicon
├── index.html                 # SPA entry point
├── manifest.json              # Web app manifest
├── sql_v2_migration.sql       # Normalized schema migration script
├── styles.css                 # Custom design tokens, utilities & dark theme
├── sw.js                      # PWA service worker
└── vercel.json                # Vercel routing rules & cron definitions
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`)
- A [Supabase](https://supabase.com) project with database & storage enabled

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yashwanthkrishna51-netizen/kora.git
   cd kora
   ```

2. **Install backend dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env.local` file in the root directory:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
   SESSION_SECRET=your-random-32-char-session-secret
   CRON_SECRET=your-random-cron-secret
   
   # Optional: Microsoft Entra SSO
   AZURE_CLIENT_ID=your-azure-client-id
   AZURE_CLIENT_SECRET=your-azure-client-secret
   AZURE_TENANT_ID=your-azure-tenant-id
   ```

4. **Run the local development server:**
   ```bash
   vercel dev
   ```
   Open `http://localhost:3000` in your browser.

---

## ⚙️ Environment Variables Reference

| Variable | Required | Description |
|---|:---:|---|
| `SUPABASE_URL` | **Yes** | URL of the Supabase project instance. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase Service Role API key for administrative database access. |
| `SESSION_SECRET` | **Yes** | Secret used to sign and verify user authentication tokens. |
| `CRON_SECRET` | **Yes** | Bearer secret authorizing Vercel Cron backup routines. |
| `AZURE_CLIENT_ID` | *Optional* | Microsoft Entra / Azure Application (client) ID for SSO. |
| `AZURE_CLIENT_SECRET` | *Optional* | Microsoft Entra / Azure Application client secret for SSO. |
| `AZURE_TENANT_ID` | *Optional* | Microsoft Entra / Azure Directory (tenant) ID for SSO. |

---

## 🚢 Deployment

Kora is optimized for deployment on **Vercel**:

1. Link your repository to a Vercel project:
   ```bash
   vercel
   ```
2. Set the environment variables in the **Vercel Project Dashboard** (Settings → Environment Variables).
3. Deploy to production:
   ```bash
   vercel --prod
   ```

---

## 📄 License

Internal proprietary software of **Kognoz Consulting**. All rights reserved.
