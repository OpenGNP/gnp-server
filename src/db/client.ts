import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../config/env";
import * as relations from "./relations";
import * as schema from "./schema";

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient, { schema: { ...schema, ...relations } });

export async function checkDatabase(): Promise<{ connected: boolean; error?: string }> {
  try {
    await queryClient`select 1`;
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export * from "./schema";
