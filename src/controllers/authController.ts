import { authService } from "../services/authService";
import type { LoginInput, RegisterInput } from "../validators/authValidator";

export const authController = {
  register(input: RegisterInput) {
    return authService.register(input);
  },

  login(input: LoginInput) {
    return authService.login(input);
  },
};
