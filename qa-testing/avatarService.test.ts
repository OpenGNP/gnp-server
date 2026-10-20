import { describe, expect, it } from "bun:test";

import { avatarUrlFor } from "../src/services/avatarService";

describe("avatarUrlFor", () => {
  it("versions the URL with the photo's hash, so a new photo is a new URL", () => {
    expect(avatarUrlFor(7, "avatars/7-a1b2c3d4e5f6.jpg")).toBe("/users/7/avatar?v=a1b2c3d4e5f6");
  });

  it("is null without a stored photo", () => {
    expect(avatarUrlFor(7, null)).toBeNull();
    expect(avatarUrlFor(7, "covers/x.jpg")).toBeNull();
  });
});
