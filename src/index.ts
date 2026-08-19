import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/user";
import { databaseConfig } from "./config/database";
import { env } from "./config/env";
import { errorMiddleware } from "./middleware/errorMiddleware";
import { loggerMiddleware } from "./middleware/loggerMiddleware";

const app = new Elysia()
  .use(cors())
  .use(loggerMiddleware)
  .use(errorMiddleware)
  .get("/", () => "Backend is running", { detail: { tags: ["System"], summary: "Liveness check" } })
  .get(
    "/api/health",
    () => {
      return {
        status: "ok",
        service: "gnp-backend",
        database: databaseConfig.isConfigured ? "configured" : "not configured",
      };
    },
    { detail: { tags: ["System"], summary: "Health check" } },
  )
  .group("/api", (api) =>
    api
      .use(authRoutes)
      .use(userRoutes)
  )
  .listen(env.PORT);

console.log(`Server running at http://localhost:${app.server?.port}`);
console.log(`API docs available at http://localhost:${app.server?.port}/docs`);
