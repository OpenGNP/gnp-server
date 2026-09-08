import { z } from "zod";

export const createFolderSchema = z.object({
  folderName: z.string().trim().min(1).max(255),
  folderDescription: z.string().trim().max(2000).optional(),
});

export const updateFolderSchema = createFolderSchema.partial();

// Folders aren't nested in the API yet, so this reorders the one flat, top-level list —
// folderIds must be the exact set of folders this admin currently has (same
// all-or-nothing semantics as the forms/fields reorder endpoints).
export const reorderFoldersSchema = z.object({
  folderIds: z.array(z.number().int().positive()).min(1),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type ReorderFoldersInput = z.infer<typeof reorderFoldersSchema>;
