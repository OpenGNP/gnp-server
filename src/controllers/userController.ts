import type { CurrentUser } from "../middleware/authMiddleware";
import { userService } from "../services/userService";

export const userController = {
  me(currentUser: CurrentUser) {
    return userService.getById(currentUser.id);
  },

  list(currentUser: CurrentUser, search?: string) {
    return userService.listByOrganization(currentUser.organizationId, search);
  },
};
