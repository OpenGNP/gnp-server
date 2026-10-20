const GRAPH_TIMEOUT_MS = 5000;

/**
 * Looks up the display name of the signed-in user's Entra tenant (e.g. "King
 * Mongkut's University of Technology Thonburi") via Graph `GET /organization`,
 * using the delegated `User.Read` access token MSAL returned alongside the ID
 * token. Graph validates that token itself; we only confirm it belongs to the same
 * tenant as the verified ID token so a mismatched token can't name someone else's org.
 *
 * Best-effort: resolves `null` on any failure so sign-in never depends on Graph.
 */
export async function fetchTenantDisplayName(
  accessToken: string,
  expectedTenantId: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/organization?$select=id,displayName",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;

    const body = (await response.json()) as { value?: { id?: string; displayName?: string }[] };
    const organization = body.value?.find((org) => org.id === expectedTenantId);
    const name = organization?.displayName?.trim();
    return name ? name.slice(0, 255) : null;
  } catch {
    return null;
  }
}

/**
 * The signed-in user's Microsoft profile photo (96×96 JPEG), via Graph with the same
 * delegated `User.Read` token. `null` when they have none (Graph 404s) or on any failure.
 */
export async function fetchMyPhoto(accessToken: string): Promise<Buffer | null> {
  try {
    const response = await fetch("https://graph.microsoft.com/v1.0/me/photos/96x96/$value", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}
