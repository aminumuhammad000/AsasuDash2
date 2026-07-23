# ASASU Commission OS

Premium, role-based commission operations platform for ASASU REALTY LTD. It turns payment schedules into searchable claim rows, calculates commission from trusted RSA values, prevents duplicate claims, supports disputes and partial approvals, and carries approved claims through finance settlement.

## Included workflows

- Smart Excel schedule inspection, preview, validation, and publication.
- Automatic branch/date detection and preservation of leading-zero account numbers.
- Real-time in-app notification when a schedule is published.
- Direct agent claim selection with a live basket—no claim workbook upload.
- Fixed 1% agent rate and server-validated 1.5%/2% sub-developer rates.
- Atomic duplicate lock per schedule row.
- Ownership disputes with review, rejection, resolution, and claim transfer.
- Admin verification queue with approve, reject, request-info, and partial approval.
- Finance payment transition and settlement export.
- Role-aware support tickets with priorities, threaded replies, staff status updates, and notifications.
- People, notification, payment, and audit views.
- Responsive light/dark interface with dedicated mobile client cards.

## Stack

- Web: React 19, TypeScript, Vite, Recharts, Lucide, Zustand, Socket.IO.
- API: Node.js, Express, TypeScript, Zod, Multer, ExcelJS, JWT RBAC, Socket.IO.
- Production data model: Prisma + PostgreSQL with multi-tenant organizations/branches and database-backed claim locks.
- Production scale path: Redis caching/queues, object storage, email/SMS/WhatsApp workers, and payment-provider integrations.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@asasurealty.com` | `Admin@2026` |
| Agent | `agent@asasurealty.com` | `Agent@2026` |
| Sub-Developer | `developer@asasurealty.com` | `Developer@2026` |

## Run the production build

```bash
npm ci
cp .env.example .env
npm run build
npm start
```

Open `http://localhost:4300`. The production API process serves both the web portal and `/api`, so the project can be deployed as one Node.js service.

For a hosting provider, use:

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Node.js: 20 or newer
- Required secret: set `JWT_SECRET` to a long random value
- Public origin: set `CLIENT_ORIGIN` to the deployed URL, for example `https://commission.example.com`
- Port: most providers inject `PORT` automatically

The bundled JSON adapter stores live data in `apps/api/data/store.json`. Attach a persistent disk to `apps/api/data` for a durable single-server deployment. For multi-server production, use the included Prisma/PostgreSQL model as described in the architecture document.

## Verify

```bash
npm run typecheck
npm run build
DATABASE_URL='postgresql://asasu:asasu@localhost:5432/asasu' npx prisma validate --schema apps/api/prisma/schema.prisma
```

The JSON data adapter is intentionally retained for an immediate self-contained demo. The validated Prisma schema is the production persistence contract.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for workbook findings, duplicate-lock guarantees, data design, authorization, and scale strategy.
