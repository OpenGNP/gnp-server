export const env = {
  PORT: Number(Bun.env.PORT ?? 3000),
  JWT_SECRET: Bun.env.JWT_SECRET ?? "dev-secret",
  DATABASE_URL: Bun.env.DATABASE_URL ?? "",
  NODE_ENV: Bun.env.NODE_ENV ?? "development",
  CLIENT_URL: Bun.env.CLIENT_URL ?? "http://localhost:5173",
  // Object storage for uploaded assets (form cover images). The bucket is kept
  // private — nothing is ever handed to the browser as a direct MinIO URL, every
  // read goes through the API's own accessType checks (see minio.ts).
  MINIO_ENDPOINT: Bun.env.MINIO_ENDPOINT ?? "",
  MINIO_PORT: Number(Bun.env.MINIO_PORT ?? 9000),
  MINIO_USE_SSL: Bun.env.MINIO_USE_SSL === "true",
  MINIO_ACCESS_KEY: Bun.env.MINIO_ACCESS_KEY ?? "",
  MINIO_SECRET_KEY: Bun.env.MINIO_SECRET_KEY ?? "",
  MINIO_BUCKET: Bun.env.MINIO_BUCKET ?? "gnp-uploads",
} as const;
