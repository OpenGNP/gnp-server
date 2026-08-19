import type { CurrentUser } from "../middleware/authMiddleware";
import { formService } from "../services/formService";
import type {
  CreateFieldOptionInput,
  CreateFormFieldInput,
  CreateFormInput,
  UpdateFormFieldInput,
  UpdateFormInput,
} from "../validators/formValidator";

export const formController = {
  list(adminId: number, folderId?: number) {
    return formService.listByAdmin(adminId, folderId);
  },

  getForEdit(id: number, adminId: number) {
    return formService.getForEdit(id, adminId);
  },

  getPublic(id: number, viewer: CurrentUser | null) {
    return formService.getPublic(id, viewer);
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
