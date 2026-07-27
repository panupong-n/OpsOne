# OpsOne — Operations One Platform

Internal operations platform: staff attendance & field-visit tracking, IT asset
register and preventive maintenance, project management, ISO survey/assessment,
a Training & online-exam system, and HR intake — behind TENCYBER SSO.

> **Developer:** Panupong Nijjaboon — sole author and maintainer.

---

## Tech stack

**Frontend** — React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · React Router 7 ·
TanStack Query · Framer Motion · Recharts / ApexCharts · dnd-kit · lucide-react ·
sonner.

**Backend** — Node.js (ESM) · Express 5 · PostgreSQL (`pg`) · nodemailer (SMTP) ·
multer + sharp (uploads/image compression).

**Auth** — TENIX-One SSO (OIDC). Canonical roles: `SUPER_ADMIN`, `STAFF`,
`INTERN` (fail-closed: an unknown role is treated as `INTERN`, never admin).

**Deploy** — PM2 + nginx (see `deploy/`).

---

## Modules

| Area | Route(s) | Notes |
|------|----------|-------|
| Dashboard | `/dashboard` | Attendance / assets / team-workload summary |
| Tasks & Calendar | `/tasks` | Assignments, field-visit & leave logging |
| IT Assets | `/assets` | Asset register, holders, transfers |
| Maintenance | `/assets/maintenance` | Preventive-maintenance rounds per asset |
| Project Management | `/pm` | Kanban · Gantt · analytics |
| Survey (ISO) | `/survey/*` | Build, assign, track, report |
| Training & Exam | `/training/*`, `/exam` | Question bank, exams, code-gated public exam taker |
| HR Intake | `/hr/intake` | Admin-only intake monitor |
| Support Tickets | `/tickets` | **Disabled** via `src/config/features.ts` (Zammad offline) |

Public / unauthenticated routes: `/exam`, `/survey/fill/:token`,
`/attendance/daily`, and task/preview share links (`/v/...`).

---

## Project structure

```
.
├── src/                 # React app
│   ├── pages/           # Route pages (survey/, training/, maintenance/ subfolders)
│   ├── components/      # Shared UI (settings/, ui/, charts/, common/)
│   ├── layout/          # AppLayout, header, sidebar
│   ├── context/         # Auth, Theme, Sidebar providers
│   ├── lib/             # permissions, holidays, teams, auth, avatar …
│   └── config/          # Feature flags
├── server.js            # Express API + static server (single file)
├── migrations/          # SQL migrations + seed scripts (+ exam seed JSON)
├── deploy/              # nginx.conf, ecosystem.config.example.cjs (PM2 template)
├── docs/                # Architecture, DB schema, auth flow, API integration
├── public/              # Static assets served as-is
└── dist/                # Vite build output (generated)
```

---

## Local development

Requirements: Node.js 22+, PostgreSQL.

```bash
npm install
cp .env.example .env          # fill in SSO client id, etc.
npm run dev                   # Vite dev server (frontend)
node server.js                # API + static (separate terminal)
```

Build the frontend:

```bash
npm run build                 # tsc -b && vite build  → dist/
npm run lint
```

---

## Configuration

Frontend build-time vars live in `.env` (see `.env.example`). Server runtime
secrets (DB, SMTP, Zammad, allowed origins) are supplied by PM2 through
`ecosystem.config.cjs`.

> `ecosystem.config.cjs` is **gitignored** because it holds real secrets. Start
> from the template: `cp deploy/ecosystem.config.example.cjs ecosystem.config.cjs`
> then fill in the values. Never commit real passwords or tokens.

---

## Database migrations

Idempotent — the server runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on
startup, so most schema changes apply automatically. One-off seeds and SQL live
in `migrations/`:

```bash
node migrations/seed_training_comptia.cjs     # seed the CompTIA question bank
node migrations/seed_ma_checks.cjs            # seed maintenance rounds
```

---

## Deployment (production)

```bash
npm run build
cp deploy/ecosystem.config.example.cjs ecosystem.config.cjs   # first time; then edit
pm2 start ecosystem.config.cjs
pm2 restart opsone --update-env
```

nginx reverse-proxy config: `deploy/nginx.conf`.

---

## Further docs

- [docs/system_overview.md](docs/system_overview.md) — architecture overview
- [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) — schema reference
- [docs/AUTH_FLOW.md](docs/AUTH_FLOW.md) — TENCYBER SSO flow
- [docs/PROJECT_MANAGEMENT.md](docs/PROJECT_MANAGEMENT.md) — PM module details

---

© Panupong Nijjaboon. Internal use.
