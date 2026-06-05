import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => "Backend is running")
  .get("/api/health", () => {
    return {
      status: "ok",
      service: "gnp-backend",
    };
  })
  .listen(3000);

console.log(`Server running at http://localhost:${app.server?.port}`);