// gnp-server/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/db",
  dialect: "postgresql",
  schemaFilter: ["test"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});