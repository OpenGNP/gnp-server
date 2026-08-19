# gnp-server

Backend API for **GNP**, a feedback platform: form authoring, response collection, AI-derived topics/points, and analytics. Built with [Elysia](https://elysiajs.com) on [Bun](https://bun.com), backed by PostgreSQL via [Drizzle ORM](https://orm.drizzle.team).

## Tech stack

- **Runtime:** Bun
- **Framework:** Elysia (`@elysiajs/cors`, `@elysiajs/jwt`, `@elysiajs/openapi`)
- **Database:** PostgreSQL, accessed with `drizzle-orm` / `postgres`, migrations via `drizzle-kit`
- **Validation:** Zod

## Getting started

Install dependencies:

```bash
bun install
```

Create a `.env` file in this directory (Bun loads it automatically):

```bash
PORT=3000
JWT_SECRET=change-me
DATABASE_URL=postgres://user:password@localhost:5432/gnp
NODE_ENV=development
CLIENT_URL=http://localhost:5173
```

Run the dev server (watches for changes):

```bash
bun run dev
```

Or run it without the watcher:

```bash
bun run start
```

The server logs its URL and API docs link on startup, e.g.:

```
Server running at http://localhost:3000
API docs available at http://localhost:3000/docs
```

## Environment variables

| Variable       | Default                   | Description                                                        |
| -------------- | -------------------------- | -------------------------------------------------------------------- |
| `PORT`         | `3000`                     | Port the server listens on                                          |
| `JWT_SECRET`   | `dev-secret`                | Secret used to sign/verify auth JWTs — set a real value outside dev |
| `DATABASE_URL` | `""`                        | PostgreSQL connection string                                        |
| `NODE_ENV`     | `development`               | Runtime environment                                                  |
| `CLIENT_URL`   | `http://localhost:5173`     | Allowed CORS origin (credentials enabled)                            |

## Database

Schema lives in [src/db/schema.ts](src/db/schema.ts), managed with Drizzle Kit ([drizzle.config.ts](drizzle.config.ts)).

```bash
bun run generate   # generate a migration from schema changes
bun run push       # push schema directly to the database (no migration files)
bun run pull       # introspect an existing database into the schema
bun run seed       # populate the database with mock data
```

## Project structure

```
src/
  config/       env and database config
  controllers/  request orchestration per resource
  services/     business logic and DB queries
  routes/       Elysia route definitions, grouped under /api
  validators/   Zod request schemas
  middleware/   auth, error handling, logging
  plugins/      JWT and OpenAPI plugin setup
  db/           Drizzle schema, relations, generated SQL migrations
  seed/         database seed script
  utils/        shared helpers (cookies, errors, responses, params, password)
```

## Authentication

Auth is JWT-based (`@elysiajs/jwt`), issued by `/api/auth/login` or `/api/auth/register`. The token is returned in the response body **and** set as an httpOnly cookie, so clients can use either:

- `Authorization: Bearer <token>` header (API clients, the docs "Authorize" button)
- The httpOnly auth cookie (browser clients)

## API overview

Interactive OpenAPI docs (Scalar UI) are served at **`/docs`** once the server is running. All routes below are mounted under `/api`.

| Resource          | Prefix                | Notes                                                             |
| ------------------ | ---------------------- | ------------------------------------------------------------------ |
| Auth               | `/api/auth`            | `register`, `login`, `logout`                                     |
| Users              | `/api/users`            | Current user, organization members                                 |
| Organizations      | `/api/orgs`             | Public list, used at registration                                  |
| Folders            | `/api/folders`          | Group forms, owned by an admin                                     |
| Forms              | `/api/forms`            | Authoring, fields/options, public respondent view                  |
| Feedback           | `/api/feedback`         | Submitting and reviewing form responses                            |
| Topics             | `/api/topics`           | AI-derived canonical topics and trends                             |
| Analytics          | `/api/analytics`        | Aggregate dashboards over an admin's forms                         |

Also available outside `/api`:

- `GET /` — liveness check
- `GET /api/health` — health check, reports whether `DATABASE_URL` is configured
- `GET /docs` — OpenAPI documentation

Most endpoints require authentication (Bearer token or auth cookie). A few are intentionally public or optionally authenticated:

- `GET /api/forms/:id/public` — respondent-facing view of a form (enforces the form's status/access type)
- `POST /api/feedback` — submit a response; an optional Bearer token enables org/allowed-user checks and one-response-per-person enforcement
- `GET /api/orgs` — organization list for the registration form

## Data model

The schema centers on **organizations → users → folders → forms → fields/options → submissions → answers**, plus an AI pipeline layer that turns answers into **points**, clusters them into **canonical topics**, and tracks **topic trends** over time. See [src/db/schema.ts](src/db/schema.ts) for the full table definitions.
