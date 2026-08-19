import { folderService } from "../services/folderService";
import type { CreateFolderInput, UpdateFolderInput } from "../validators/folderValidator";

export const folderController = {
  list(adminId: number) {
    return folderService.listByAdmin(adminId);
  },

  get(id: number, adminId: number) {
    return folderService.getById(id, adminId);
  },

  create(adminId: number, input: CreateFolderInput) {
    return folderService.create(adminId, input);
  },

  update(id: number, adminId: number, input: UpdateFolderInput) {
    return folderService.update(id, adminId, input);
  },

  remove(id: number, adminId: number) {
    return folderService.remove(id, adminId);
  },
};
