import type { CurrentUser } from "../middleware/authMiddleware";
import { userService } from "../services/userService";
import type { CreateUserInput, UpdateUserRoleInput } from "../validators/userValidator";

export const userController = {
  me(currentUser: CurrentUser) {
    return userService.getById(currentUser.id);
  },

  list(currentUser: CurrentUser, search?: string) {
    return userService.listByOrganization(currentUser.organizationId, search);
  },

  create(input: CreateUserInput) {
    return userService.create(input);
  },

  updateRole(id: number, input: UpdateUserRoleInput) {
    return userService.updateRole(id, input.role);
  },
};
