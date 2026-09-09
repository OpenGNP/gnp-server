import { count, desc, eq, max } from "drizzle-orm";

import { db, folders, forms } from "../db/client";
import { badRequest, forbidden, notFound } from "../utils/errors";
import type { CreateFolderInput, UpdateFolderInput } from "../validators/folderValidator";

const nowIso = () => new Date().toISOString();

async function getOwnedFolder(id: number, adminId: number) {
  const [folder] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);

  if (!folder) throw notFound("Folder not found");
  if (folder.adminId !== adminId) throw forbidden("You do not have access to this folder");

  return folder;
}

export const folderService = {
  async listByAdmin(adminId: number) {
    return db
      .select({
        id: folders.id,
        folderName: folders.folderName,
        folderDescription: folders.folderDescription,
        sortOrder: folders.sortOrder,
        createdAt: folders.createdAt,
        updatedAt: folders.updatedAt,
        formCount: count(forms.id),
      })
      .from(folders)
      .leftJoin(forms, eq(forms.folderId, folders.id))
      .where(eq(folders.adminId, adminId))
      .groupBy(folders.id)
      .orderBy(desc(folders.createdAt));
  },

  async getById(id: number, adminId: number) {
    const folder = await getOwnedFolder(id, adminId);

    const folderForms = await db
      .select({
        id: forms.id,
        formTitle: forms.formTitle,
        status: forms.status,
        createdAt: forms.createdAt,
      })
      .from(forms)
      .where(eq(forms.folderId, id))
      .orderBy(desc(forms.createdAt));

    return { ...folder, forms: folderForms };
  },

  async create(adminId: number, input: CreateFolderInput) {
    // New folders append to the end of the (flat, top-level) list — same "current
    // max + 1" pattern as forms.sortOrder.
    const [current] = await db
      .select({ value: max(folders.sortOrder) })
      .from(folders)
      .where(eq(folders.adminId, adminId));

    const [folder] = await db
      .insert(folders)
      .values({
        adminId,
        folderName: input.folderName,
        folderDescription: input.folderDescription,
        sortOrder: (current?.value ?? -1) + 1,
      })
      .returning();

    return folder!;
  },

  async update(id: number, adminId: number, input: UpdateFolderInput) {
    await getOwnedFolder(id, adminId);

    // Stamp updated_at ($defaultFn only fires on insert) so "date modified" moves on
    // rename. reorderFolders deliberately does NOT — a drag isn't a content change.
    const [updated] = await db
      .update(folders)
      .set({ ...input, updatedAt: nowIso() })
      .where(eq(folders.id, id))
      .returning();

    return updated!;
  },

  async remove(id: number, adminId: number) {
    await getOwnedFolder(id, adminId);
    await db.delete(folders).where(eq(folders.id, id));
  },

  /** Reorders the admin's top-level folders. Folders aren't nested in the API, so this is the whole list. */
  async reorderFolders(adminId: number, folderIds: number[]) {
    const existingFolders = await db.select({ id: folders.id }).from(folders).where(eq(folders.adminId, adminId));
    const existingIds = new Set(existingFolders.map((folder) => folder.id));

    if (folderIds.length !== existingIds.size || !folderIds.every((id) => existingIds.has(id))) {
      throw badRequest("folderIds must match your folders exactly");
    }

    await db.transaction(async (tx) => {
      for (const [index, folderId] of folderIds.entries()) {
        await tx.update(folders).set({ sortOrder: index }).where(eq(folders.id, folderId));
      }
    });
  },
};
