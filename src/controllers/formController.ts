import type { CurrentUser } from "../middleware/authMiddleware";
import { formService } from "../services/formService";
import type {
  CreateFieldOptionInput,
  CreateFormFieldInput,
  CreateFormInput,
  UpdateFormFieldInput,
  UpdateFormInput,
  UploadCoverImageInput,
} from "../validators/formValidator";

export const formController = {
  list(adminId: number, folderId?: number) {
    return formService.listByAdmin(adminId, folderId);
  },

  getForEdit(id: number, adminId: number) {
    return formService.getForEdit(id, adminId);
  },

  getPublicByToken(token: string, viewer: CurrentUser | null) {
    return formService.getPublicByToken(token, viewer);
  },

  getPublicBySlug(slug: string, viewer: CurrentUser | null) {
    return formService.getPublicBySlug(slug, viewer);
  },

  getCoverImageForEdit(id: number, adminId: number) {
    return formService.getCoverImageForEdit(id, adminId);
  },

  getCoverImageByToken(token: string, viewer: CurrentUser | null) {
    return formService.getCoverImageByToken(token, viewer);
  },

  getCoverImageBySlug(slug: string, viewer: CurrentUser | null) {
    return formService.getCoverImageBySlug(slug, viewer);
  },

  uploadCoverImage(id: number, adminId: number, input: UploadCoverImageInput) {
    return formService.uploadCoverImage(id, adminId, input);
  },

  removeCoverImage(id: number, adminId: number) {
    return formService.removeCoverImage(id, adminId);
  },

  create(admin: CurrentUser, input: CreateFormInput) {
    return formService.create(admin, input);
  },

  update(id: number, admin: CurrentUser, input: UpdateFormInput) {
    return formService.update(id, admin, input);
  },

  remove(id: number, adminId: number) {
    return formService.remove(id, adminId);
  },

  reorderForms(adminId: number, folderId: number | null, formIds: number[]) {
    return formService.reorderForms(adminId, folderId, formIds);
  },

  addField(formId: number, adminId: number, input: CreateFormFieldInput) {
    return formService.addField(formId, adminId, input);
  },

  updateField(formId: number, fieldId: number, adminId: number, input: UpdateFormFieldInput) {
    return formService.updateField(formId, fieldId, adminId, input);
  },

  removeField(formId: number, fieldId: number, adminId: number) {
    return formService.removeField(formId, fieldId, adminId);
  },

  reorderFields(formId: number, adminId: number, fieldIds: number[]) {
    return formService.reorderFields(formId, adminId, fieldIds);
  },

  addOption(formId: number, fieldId: number, adminId: number, input: CreateFieldOptionInput) {
    return formService.addOption(formId, fieldId, adminId, input);
  },

  removeOption(formId: number, fieldId: number, optionId: number, adminId: number) {
    return formService.removeOption(formId, fieldId, optionId, adminId);
  },
};
