import { eq } from "drizzle-orm";

import { db, forms } from "../db/client";
import { forbidden, notFound } from "../utils/errors";

/**
 * What a request needs to do with a form:
 * - `view`: read it — the editor's read view, its dashboard and analytics, its responses.
 * - `edit`: change its content — fields, options, settings, cover image.
 * - `manage`: owner-only actions — deleting it (and, later, sharing it).
 */
export type FormAccessLevel = "view" | "edit" | "manage";

/**
 * Whether `userId` may act on `form` at `level`. The one rule for form access — every
 * form endpoint goes through here (directly or via `requireFormAccess`), so adding
 * collaborator roles later is a change in this function, not a hunt through services.
 * Today only the owner has access, at every level.
 */
export function canAccessForm(form: { adminId: number }, userId: number, level: FormAccessLevel): boolean {
  void level;
  return form.adminId === userId;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A form reference from an admin URL → its ids, for a viewer with `view` access. Takes
 * the `urlId` the app's URLs use, or a numeric id (links made before urlId existed),
 * so the client can redirect those to the urlId form.
 */
export async function resolveFormRef(ref: string, userId: number) {
  const where = UUID_PATTERN.test(ref)
    ? eq(forms.urlId, ref)
    : /^[1-9]\d*$/.test(ref)
      ? eq(forms.id, Number(ref))
      : null;
  if (!where) throw notFound("Form not found");

  const [form] = await db
    .select({ id: forms.id, urlId: forms.urlId, adminId: forms.adminId })
    .from(forms)
    .where(where)
    .limit(1);
  if (!form) throw notFound("Form not found");
  if (!canAccessForm(form, userId, "view")) throw forbidden("You do not have access to this form");

  return { id: form.id, urlId: form.urlId };
}

/** Loads a form for a request that needs `level` access: 404 if missing, 403 if not allowed. */
export async function requireFormAccess(formId: number, userId: number, level: FormAccessLevel) {
  const [form] = await db.select().from(forms).where(eq(forms.id, formId)).limit(1);

  if (!form) throw notFound("Form not found");
  if (!canAccessForm(form, userId, level)) throw forbidden("You do not have access to this form");

  return form;
}
