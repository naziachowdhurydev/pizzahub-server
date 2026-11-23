/**
 * Public origin used by Better Auth for callbacks, cookies and JWT
 * issuer/audience. This is the browser-facing origin, which is the client app
 * when auth is exposed through the client's same-origin proxy.
 */
function normalize(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}

export function getServerBaseUrl(): string {
  const configured = normalize(process.env.BETTER_AUTH_URL);

  if (process.env.VERCEL) {
    // A localhost value is useless on Vercel. Ignore it and fall back to the
    // deployment URL so Preview deployments also get a valid auth origin.
    if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) return configured;

    const deployment =
      normalize(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
      normalize(process.env.VERCEL_URL);
    if (deployment) return `https://${deployment}`;
  }

  return configured || "http://localhost:3000";
}
