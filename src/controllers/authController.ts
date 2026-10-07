import { authService } from "../services/authService";
import type { LoginInput, MicrosoftLoginInput } from "../validators/authValidator";

export const authController = {
  login(input: LoginInput) {
    return authService.login(input);
  },

  loginWithMicrosoft(input: MicrosoftLoginInput) {
    return authService.loginWithMicrosoft(input);
  },
};
