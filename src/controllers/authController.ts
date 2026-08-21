import { authService } from "../services/authService";
import type { LoginInput } from "../validators/authValidator";

export const authController = {
  login(input: LoginInput) {
    return authService.login(input);
  },
};
