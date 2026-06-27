# TournamentOS SaaS Platform 🏆🛡️

Welcome to **TournamentOS**, a highly resilient, event-driven SaaS platform for orchestrating gaming tournaments, managing teams, scoring matches, and displaying live overlays. 

This repository is organized as a monorepo consisting of a NestJS API backend and a Next.js App Router frontend dashboard.

---

## 📁 Repository Structure

```tree
TournamentOS/
├── apps/
│   ├── api/          # NestJS API Backend (Prisma, Postgres, Redis)
│   └── web/          # Next.js Frontend Dashboard (Tailwind CSS, shadcn/ui)
├── db-services/      # (Git Ignored) Portable database & cache binaries
├── package.json      # Monorepo dependencies and workspaces
└── README.md         # Main project documentation
```

---

## 🚀 Key Architecture & Resiliency Features

This platform is built beyond standard "student project" designs and implements production-level distributed consistency controls:

1. **Versioned Freeze Governance (Self-Healing)**
   - Allows operators to lock registration, scoring, and matchmaking scopes.
   - Prevents concurrent modifications across distributed nodes using audit versions.
   - Features **inline self-healing auto-expiry** checks: if a worker goes down, any client-facing transaction will lazily auto-expire the freeze if the expiration duration is met.

2. **Standings Worker Queue with Jitter & DLQ**
   - Scoring mutations queue standings updates to run asynchronously in the background.
   - Features staged exponential retry backoff with randomized **Jitter** (e.g., 5s ± 2s) to prevent thundering herd problems when downstream operations fail.
   - Includes a **Dead Letter Queue (DLQ)**: failed jobs are saved to the database after 3 retries, exposing a manual admin replay endpoint for operability.

3. **Telemetry & Metrics**
   - Prometheus metrics integrated into major operations (standings latency, queue depth, freeze audits).

---

## 🛠️ Local Development Setup

To run TournamentOS completely locally on Windows:

### 1. Prerequisite Services (Postgres & Redis)
The workspace includes portable, sandboxed instances of PostgreSQL and Redis located under the `db-services/` directory:
- **Redis** is listening on `localhost:6379`.
- **PostgreSQL** is listening on `localhost:5432` (with database `tournamentos`).

To restart or launch them manually:
```powershell
# Start Redis
.\db-services\redis\redis-server.exe .\db-services\redis\redis.windows.conf

# Start PostgreSQL
.\db-services\pgsql\bin\postgres.exe -D .\db-services\pgsql\data
```

### 2. Install Dependencies
Run from the root directory:
```bash
npm install
```

### 3. Sync Database Schema
Sync your PostgreSQL database tables with the Prisma ORM schema:
```bash
cd apps/api
npx prisma db push
```

### 4. Run the Dev Servers
From the root directory, run both servers concurrently:
```bash
# Start backend API (runs on port 3001)
npm run dev:api

# Start frontend Web Dashboard (runs on port 3000)
npm run dev:web
```

---

## 🔗 Output Links

Once running, access the local endpoints:
- **Frontend Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Backend API Server**: [http://localhost:3001](http://localhost:3001)
- **API Swagger Documentation**: [http://localhost:3001/api/docs](http://localhost:3001/api/docs)
