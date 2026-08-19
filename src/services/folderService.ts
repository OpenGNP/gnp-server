import { count, desc, eq } from "drizzle-orm";

import { db, folders, forms } from "../db/client";
import { forbidden, notFound } from "../utils/errors";
import type { CreateFolderInput, UpdateFolderInput } from "../validators/folderValidator";

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
        createdAt: folders.createdAt,
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
    const [folder] = await db
      .insert(folders)
      .values({
        adminId,
        folderName: input.folderName,
        folderDescription: input.folderDescription,
      })
      .returning();

    return folder!;
  },

  async update(id: number, adminId: number, input: UpdateFolderInput) {
    await getOwnedFolder(id, adminId);

    const [updated] = await db.update(folders).set(input).where(eq(folders.id, id)).returning();

    return updated!;
  },

  async remove(id: number, adminId: number) {
    await getOwnedFolder(id, adminId);
    await db.delete(folders).where(eq(folders.id, id));
  },
};
