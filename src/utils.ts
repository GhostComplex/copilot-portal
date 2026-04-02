/**
 * Utility functions.
 */

/**
 * Extract token from Authorization header.
 * Only accepts "Bearer <token>" or "token <token>" schemes.
 * Rejects Basic, Digest, etc.
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length === 2) {
    const scheme = parts[0].toLowerCase();
    if (scheme === "bearer" || scheme === "token") {
      return parts[1];
    }
  }
  return null;
}
