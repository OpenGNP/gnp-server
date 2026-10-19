import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../config/env";
import * as relations from "./relations";
import * as schema from "./schema";

/** The raw postgres.js client — for LISTEN (lib/formEvents.ts); queries go through `db`. */
export const queryClient = postgres(env.DATABASE_URL);

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
