import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { db, users } from "../db/client";
import { fetchMyPhoto } from "../lib/microsoftGraph";
import { getObjectBuffer, putObject, removeObjectSafely } from "../lib/minio";
import { notFound } from "../utils/errors";

/*
 * Profile photos come from Microsoft at sign-in (each person's own, with their own
 * token: reading other people's photos would need an admin-consented permission).
 * Stored in MinIO as avatars/<userId>-<hash>.jpg; the hash changes when the photo does,
 * which also versions the URL so browsers can cache it for good.
 */

const isAvatarKey = (key: string | null): key is string => typeof key === "string" && key.startsWith("avatars/");

/** Where the client loads a user's photo from, or null (it shows initials instead). */
export function avatarUrlFor(userId: number, key: string | null): string | null {
  if (!isAvatarKey(key)) return null;
  const version = key.slice(key.lastIndexOf("-") + 1, key.lastIndexOf("."));
  return `/users/${userId}/avatar?v=${version}`;
}

/**
 * Brings the stored photo in line with Microsoft: saves a new or changed one, drops it
 * if they've removed theirs. Returns the key now in use. Never throws: a missing photo
 * must never get in the way of signing in.
 */
export async function syncMicrosoftAvatar(userId: number, currentKey: string | null, accessToken: string) {
  try {
    const photo = await fetchMyPhoto(accessToken);
    if (!photo) {
      if (isAvatarKey(currentKey)) {
        await db.update(users).set({ avatarKey: null }).where(eq(users.id, userId));
        await removeObjectSafely(currentKey);
      }
      return null;
    }
    const hash = createHash("sha1").update(photo).digest("hex").slice(0, 12);
    const key = `avatars/${userId}-${hash}.jpg`;
    if (key === currentKey) return key;

    await putObject(key, photo, "image/jpeg");
    await db.update(users).set({ avatarKey: key }).where(eq(users.id, userId));
    if (isAvatarKey(currentKey)) await removeObjectSafely(currentKey);
    return key;
  } catch (error) {
    console.error(`Could not sync the Microsoft photo for user ${userId}`, error);
    return currentKey;
  }
}

export async function getAvatar(userId: number) {
  const [user] = await db.select({ key: users.avatarKey }).from(users).where(eq(users.id, userId));
  if (!isAvatarKey(user?.key ?? null)) throw notFound("No profile photo");
  return { buffer: await getObjectBuffer(user!.key!), contentType: "image/jpeg" };
}
