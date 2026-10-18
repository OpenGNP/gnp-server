import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db, formCollaborators, forms, users } from "../db/client";
import { badRequest } from "../utils/errors";
import { requireFormAccess } from "./formAccess";

const MAX_VIEWERS = 50;

/** Who a form is shared with (view-only), for its owner's Share dialog. */
async function list(formId: number, adminId: number) {
  await requireFormAccess(formId, adminId, "manage");
  return db
    .select({
      email: formCollaborators.email,
      role: formCollaborators.role,
      fullName: users.fullName,
      createdAt: formCollaborators.createdAt,
    })
    .from(formCollaborators)
    .leftJoin(users, eq(formCollaborators.userId, users.id))
    .where(eq(formCollaborators.formId, formId))
    .orderBy(formCollaborators.id);
}

export const collaboratorService = {
  list,

  /**
   * Replaces the form's viewer list with `emails`. Like the "specific people" invite
   * list, an email needs no account yet — access is matched by email at open time
   * (formRoleFor); `userId` is filled in where an account already exists.
   */
  async replace(formId: number, adminId: number, emails: string[]) {
    const form = await requireFormAccess(formId, adminId, "manage");
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, form.adminId));

    const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()))].filter(
      (email) => email !== owner?.email.toLowerCase(),
    );
    if (unique.length > MAX_VIEWERS) throw badRequest(`A form can be shared with at most ${MAX_VIEWERS} people`);

    await db.transaction(async (tx) => {
      // Keep existing rows (and their created_at); only add / remove the difference.
      const current = await tx
        .select({ id: formCollaborators.id, email: formCollaborators.email })
        .from(formCollaborators)
        .where(eq(formCollaborators.formId, formId));
      const keep = new Set(unique);
      const removed = current.filter((row) => !keep.has(row.email.toLowerCase())).map((row) => row.id);
      if (removed.length) await tx.delete(formCollaborators).where(inArray(formCollaborators.id, removed));

      const existing = new Set(current.map((row) => row.email.toLowerCase()));
      const added = unique.filter((email) => !existing.has(email));
      if (added.length === 0) return;
      const accounts = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(sql`lower(${users.email})`, added));
      const userIdByEmail = new Map(accounts.map((user) => [user.email.toLowerCase(), user.id]));
      await tx.insert(formCollaborators).values(
        added.map((email) => ({
          formId,
          email,
          userId: userIdByEmail.get(email) ?? null,
          role: "viewer",
          invitedBy: adminId,
        })),
      );
    });

    return list(formId, adminId);
  },

  /** Forms shared with this user to view — the sidebar's "Shared with me". */
  async sharedWith(userId: number) {
    return db
      .select({
        id: forms.id,
        urlId: forms.urlId,
        formTitle: forms.formTitle,
        status: forms.status,
        updatedAt: forms.updatedAt,
        ownerName: sql<string | null>`coalesce(nullif(${users.fullName}, ''), ${users.email})`,
      })
      .from(formCollaborators)
      .innerJoin(forms, eq(formCollaborators.formId, forms.id))
      .innerJoin(users, eq(forms.adminId, users.id))
      .where(
        and(
          sql`${forms.status} <> 'archived'`,
          or(
            eq(formCollaborators.userId, userId),
            sql`lower(${formCollaborators.email}) = (select lower(u.email) from users u where u.id = ${userId})`,
          ),
        ),
      )
      .orderBy(desc(forms.updatedAt));
  },
};
