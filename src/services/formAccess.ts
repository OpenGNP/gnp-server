import { and, eq, or, sql } from "drizzle-orm";

import { db, formCollaborators, forms, users } from "../db/client";
import { forbidden, notFound } from "../utils/errors";

/** How a user relates to a form: its owner, or someone it was shared with to view. */
export type FormRole = "owner" | "viewer";

/**
 * What a request needs to do with a form:
 * - `view`: read it — the editor's read view, its dashboard and analytics, its responses.
 *   Owners and viewers (form_collaborators).
 * - `edit`: change its content — fields, options, settings, cover image.
 * - `manage`: owner-only actions — deleting it (and, later, sharing it).
 */
export type FormAccessLevel = "view" | "edit" | "manage";

/**
 * `userId`'s role on `form`, or null for none. A viewer is matched by account or by
 * email — the share may have been made before they ever signed in.
 */
export async function formRoleFor(form: { id: number; adminId: number }, userId: number): Promise<FormRole | null> {
  if (form.adminId === userId) return "owner";
  const [row] = await db
    .select({ id: formCollaborators.id })
    .from(formCollaborators)
    .where(
      and(
        eq(formCollaborators.formId, form.id),
        or(
          eq(formCollaborators.userId, userId),
          sql`lower(${formCollaborators.email}) = (select lower(${users.email}) from ${users} where ${users.id} = ${userId})`,
        ),
      ),
    )
    .limit(1);
  return row ? "viewer" : null;
}

const ALLOWED: Record<FormRole, FormAccessLevel[]> = {
  owner: ["view", "edit", "manage"],
  viewer: ["view"],
};

/**
 * Whether `userId` may act on `form` at `level`. The one rule for form access — every
 * form endpoint goes through here (directly or via `requireFormAccess`).
 */
export async function canAccessForm(
  form: { id: number; adminId: number },
  userId: number,
  level: FormAccessLevel,
): Promise<boolean> {
  const role = await formRoleFor(form, userId);
  return role !== null && ALLOWED[role].includes(level);
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
  const role = await formRoleFor(form, userId);
  if (!role) throw forbidden("You do not have access to this form");

  return { id: form.id, urlId: form.urlId, role };
}

/** Loads a form for a request that needs `level` access: 404 if missing, 403 if not allowed. */
export async function requireFormAccess(formId: number, userId: number, level: FormAccessLevel) {
  const [form] = await db.select().from(forms).where(eq(forms.id, formId)).limit(1);

  if (!form) throw notFound("Form not found");
  if (!(await canAccessForm(form, userId, level))) throw forbidden("You do not have access to this form");

  return form;
}
