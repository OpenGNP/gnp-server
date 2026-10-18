import { and, count, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";

import { db, folders, forms } from "../db/client";
import { removeObjectSafely } from "../lib/minio";
import { badRequest, forbidden, isUniqueViolation, notFound } from "../utils/errors";
import type { CreateFolderInput, UpdateFolderInput } from "../validators/folderValidator";
import { isManagedCoverKey } from "./formService";

const nowIso = () => new Date().toISOString();

async function getOwnedFolder(id: number, adminId: number) {
  const [folder] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);

  if (!folder) throw notFound("Folder not found");
  if (folder.adminId !== adminId) throw forbidden("You do not have access to this folder");

  return folder;
}

const siblingsOf = (adminId: number, parentFolderId: number | null) =>
  and(
    eq(folders.adminId, adminId),
    parentFolderId === null ? isNull(folders.parentFolderId) : eq(folders.parentFolderId, parentFolderId),
  );

/** Throws unless `parentId` is the admin's folder and not `folderId` itself or inside it. */
async function assertValidParent(adminId: number, parentId: number, folderId?: number) {
  let current: number | null = parentId;
  while (current !== null) {
    if (current === folderId) throw badRequest("A folder can't be moved into itself");
    const parent = await getOwnedFolder(current, adminId);
    current = parent.parentFolderId;
  }
}

/** uq_folder_sibling_name: two folders with the same name in one place. */
function rethrowDuplicateName(error: unknown): never {
  if (isUniqueViolation(error)) throw badRequest("A folder with that name already exists here");
  throw error;
}

export const folderService = {
  async listByAdmin(adminId: number) {
    return db
      .select({
        id: folders.id,
        parentFolderId: folders.parentFolderId,
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
    const parentFolderId = input.parentFolderId ?? null;
    if (parentFolderId !== null) await assertValidParent(adminId, parentFolderId);

    // Appends to the end of its siblings — same "current max + 1" pattern as forms.sortOrder.
    const [current] = await db
      .select({ value: max(folders.sortOrder) })
      .from(folders)
      .where(siblingsOf(adminId, parentFolderId));

    const [folder] = await db
      .insert(folders)
      .values({
        adminId,
        parentFolderId,
        folderName: input.folderName,
        folderDescription: input.folderDescription,
        sortOrder: (current?.value ?? -1) + 1,
      })
      .returning()
      .catch(rethrowDuplicateName);

    return folder!;
  },

  async update(id: number, adminId: number, input: UpdateFolderInput) {
    await getOwnedFolder(id, adminId);
    if (input.parentFolderId) await assertValidParent(adminId, input.parentFolderId, id);

    // Stamp updated_at ($defaultFn only fires on insert) so "date modified" moves on
    // rename. reorderFolders deliberately does NOT — a drag isn't a content change.
    const [updated] = await db
      .update(folders)
      .set({ ...input, updatedAt: nowIso() })
      .where(eq(folders.id, id))
      .returning()
      .catch(rethrowDuplicateName);

    return updated!;
  },

  /** Deletes the folder only: its subfolders and forms move up to its parent (as the app shows). */
  /**
   * Deletes the folder and everything in it — its subfolders at any depth and every
   * form in them, with their responses (forms cascade to their fields and submissions;
   * subfolders cascade via fk_folder_parent).
   */
  async remove(id: number, adminId: number) {
    await getOwnedFolder(id, adminId);

    const subtree = await db.execute<{ id: number }>(sql`
      with recursive tree as (
        select id from folders where id = ${id}
        union all
        select f.id from folders f join tree on f.parent_folder_id = tree.id
      )
      select id from tree`);
    const folderIds = [...subtree].map((row) => Number(row.id));

    const doomed = await db
      .select({ id: forms.id, coverImageUrl: forms.coverImageUrl })
      .from(forms)
      .where(and(inArray(forms.folderId, folderIds), eq(forms.adminId, adminId)));

    await db.transaction(async (tx) => {
      if (doomed.length) await tx.delete(forms).where(inArray(forms.id, doomed.map((form) => form.id)));
      await tx.delete(folders).where(eq(folders.id, id));
    });

    // Rows are gone; their MinIO covers aren't — clean those up too.
    await Promise.all(
      doomed.map((form) => (isManagedCoverKey(form.coverImageUrl) ? removeObjectSafely(form.coverImageUrl) : null)),
    );
    return { deletedForms: doomed.length, deletedFolders: folderIds.length };
  },

  /** Reorders the folders inside one parent (null = top level). */
  async reorderFolders(adminId: number, parentFolderId: number | null, folderIds: number[]) {
    const existingFolders = await db
      .select({ id: folders.id })
      .from(folders)
      .where(siblingsOf(adminId, parentFolderId));
    const existingIds = new Set(existingFolders.map((folder) => folder.id));

    if (folderIds.length !== existingIds.size || !folderIds.every((id) => existingIds.has(id))) {
      throw badRequest("folderIds must match the folders in that location exactly");
    }

    await db.transaction(async (tx) => {
      for (const [index, folderId] of folderIds.entries()) {
        await tx.update(folders).set({ sortOrder: index }).where(eq(folders.id, folderId));
      }
    });
  },
};
