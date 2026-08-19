import { z } from "zod";

export const createFolderSchema = z.object({
  folderName: z.string().trim().min(1).max(255),
  folderDescription: z.string().trim().max(2000).optional(),
});

export const updateFolderSchema = createFolderSchema.partial();

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
