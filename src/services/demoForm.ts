import { and, eq } from "drizzle-orm";

import { db, forms, users } from "../db/client";
import { notFound } from "../utils/errors";

/**
 * The public /demo's form: sample answers (src/seed/demoSeed.ts) analysed by the real AI.
 * Its owner's .invalid address can't receive mail, so nobody can sign in as it.
 */
export const DEMO_OWNER_EMAIL = "demo@opengnp.invalid";
export const DEMO_FORM_TITLE = "Staff pulse survey";

/** The demo form, read as its owner sees it (`adminId` passes every access check). */
export async function getDemoForm() {
  const [form] = await db
    .select({ id: forms.id, adminId: forms.adminId })
    .from(forms)
    .innerJoin(users, eq(users.id, forms.adminId))
    .where(and(eq(users.email, DEMO_OWNER_EMAIL), eq(forms.formTitle, DEMO_FORM_TITLE)))
    .limit(1);
  if (!form) throw notFound("The demo isn't set up yet. Run `bun run seed:demo`.");
  return form;
}
