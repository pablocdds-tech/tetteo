<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Base44 Development Environment

### Stack
Next.js 16.3.0 (Turbopack) · TypeScript · PostgreSQL 16 · Prisma 7 (multi-file schema) · Auth.js v5 (next-auth beta) · Tailwind v4.

### Running the app
```bash
docker compose -f docker-compose.base44.yml up -d
```
- `db` — PostgreSQL (user/pass/db: `tetteo`)
- `setup` — one-shot: `npm install` → `prisma generate` → `prisma migrate deploy` → `tsx prisma/seed.ts`
- `web` — `next dev -H 0.0.0.0 -p 3000` (live-reload via bind-mount)

### Key details
- **Prisma schema** is multi-file in `prisma/schema/` (not a single `schema.prisma`). Migrations live in `prisma/schema/migrations/`. Config is in `prisma.config.ts`, which loads `.env.local` (absent in Docker — `DATABASE_URL` comes from compose `environment:`).
- **Middleware** is `src/proxy.ts` (renamed from `middleware.ts` in Next.js 16). It gates all routes except `/login`, `/_next/*`, and `api/auth`.
- **Auth**: Auth.js v5 with Credentials provider. `AUTH_SECRET` is required at boot (auto-generated dev placeholder in `/run/base44/app.env`).
- **Seed** creates an admin user (`pablocdds@gmail.com`) with a random password written to `credenciais-primeiro-acesso.txt` (gitignored).
- **`next.config.ts`** has `allowedDevOrigins` set from `BASE44_PUBLIC_HOST_SUFFIX` so the preview origin can access dev assets/HMR.
- **`.env.base44-defaults`** holds placeholder values for all optional env vars (WhatsApp/Evolution, Gemini, Compras, etc.) — the app boots without them; external integrations show "Configuração pendente" until real values are provided via `/run/base44/app.env`.

### External integrations (optional, not needed for boot)
Evolution API (WhatsApp), Google Gemini (AI text), OpenClaw (assistente privado). All are empty by default — the app degrades gracefully.
