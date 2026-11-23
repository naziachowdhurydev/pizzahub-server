/**
 * Public origin used by Better Auth for callbacks, cookies and JWT
 * issuer/audience. In this repo, auth is exposed through the Next.js same-origin
 * proxy, so the browser-facing origin is the client app. BETTER_AUTH_URL should
 * therefore be the client origin (e.g. https://pizzahub-client-ten-silk.vercel.app
 * in production, http://localhost:3000 in local dev).
 */
function normalize(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}

function isLocalhost(value: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(value);
}

export function getServerBaseUrl(): string {
  const configured = normalize(process.env.BETTER_AUTH_URL);
  const clientUrl = normalize(process.env.CLIENT_URL);

  if (process.env.VERCEL) {
    // A localhost value is useless on Vercel. Prefer explicit client-facing
    // origins; fall back to deployment URL only when no client origin is known.
    if (configured && !isLocalhost(configured)) return configured;
    if (clientUrl && !isLocalhost(clientUrl)) return clientUrl;

    const deployment =
      normalize(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
      normalize(process.env.VERCEL_URL);
    if (deployment) return `https://${deployment}`;
  }

  return configured || clientUrl || "http://localhost:3000";
}
