export const env = {
  PORT: Number(Bun.env.PORT ?? 3000),
  JWT_SECRET: Bun.env.JWT_SECRET ?? "dev-secret",
  DATABASE_URL: Bun.env.DATABASE_URL ?? "",
} as const;
