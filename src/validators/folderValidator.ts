import { z } from "zod";

export const createFolderSchema = z.object({
  folderName: z.string().trim().min(1).max(255),
  folderDescription: z.string().trim().max(2000).optional(),
  /** Parent folder; null or omitted for the top level. On update, moves the folder. */
  parentFolderId: z.number().int().positive().nullable().optional(),
});

export const updateFolderSchema = createFolderSchema.partial();

// Reorders the folders inside one parent (null = top level). folderIds must be exactly
// that parent's folders (same all-or-nothing semantics as the forms/fields reorder).
export const reorderFoldersSchema = z.object({
  parentFolderId: z.number().int().positive().nullable().optional(),
  folderIds: z.array(z.number().int().positive()).min(1),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type ReorderFoldersInput = z.infer<typeof reorderFoldersSchema>;
