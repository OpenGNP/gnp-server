import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/user";
import { organizationRoutes } from "./routes/organization";
import { folderRoutes } from "./routes/folder";
import { formRoutes } from "./routes/form";
import { feedbackRoutes } from "./routes/feedback";
import { topicRoutes } from "./routes/topic";
import { analyticsRoutes } from "./routes/analytics";
import { eventRoutes } from "./routes/events";

import { databaseConfig } from "./config/database";
import { checkDatabase } from "./db/client";
import { env } from "./config/env";
import { errorMiddleware } from "./middleware/errorMiddleware";
import { loggerMiddleware } from "./middleware/loggerMiddleware";
import { apiDocs } from "./plugins/openapi";

const app = new Elysia()
  // X-Auth-Token carries renewed auth tokens (plugins/jwt.ts) — exposed so the
  // cross-origin dev client (localhost:5173 → :3000) can read it.
  .use(cors({ origin: env.CLIENT_URL, credentials: true, exposeHeaders: ["X-Auth-Token"] }))
  .use(loggerMiddleware)
  .use(errorMiddleware)
  .use(apiDocs)
  .get("/", () => "Backend is running", { detail: { tags: ["System"], summary: "Liveness check" } })
  .get(
    "/api/health",
    async ({ set }) => {
      const dbStatus = databaseConfig.isConfigured ? await checkDatabase() : { connected: false };
      if (!dbStatus.connected) set.status = 503;
      return {
        status: dbStatus.connected ? "ok" : "degraded",
        service: "gnp-backend",
        database: !databaseConfig.isConfigured
          ? "not configured"
          : dbStatus.connected
            ? "connected"
            : "unreachable",
      };
    },
    { detail: { tags: ["System"], summary: "Health check" } },
  )
  .group("/api", (api) =>
    api
      .use(authRoutes)
      .use(userRoutes)
      .use(organizationRoutes)
      .use(folderRoutes)
      .use(formRoutes)
      .use(eventRoutes)
      .use(feedbackRoutes)
      .use(topicRoutes)
      .use(analyticsRoutes),
  )
  .listen(env.PORT);

console.log(`Server running at http://localhost:${app.server?.port}`);
console.log(`API docs available at http://localhost:${app.server?.port}/docs`);

const dbStatus = await checkDatabase();
console.log(
  dbStatus.connected ? "Database connected" : `Database connection FAILED: ${dbStatus.error}`,
);