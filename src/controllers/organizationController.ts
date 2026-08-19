import { organizationService } from "../services/organizationService";

export const organizationController = {
  list() {
    return organizationService.list();
  },
};
