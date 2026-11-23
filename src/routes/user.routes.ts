import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth, googleAuthEnabled } from "../lib/auth.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Public capability flag for the login screen. No credentials are exposed.
router.get("/auth-providers", (_req, res) => {
  res.json({ success: true, data: { google: googleAuthEnabled } });
});

router.get("/me", requireAuth, async (req, res) => {
  // The client may call this endpoint with a Bearer token only (no cookie).
  // Fall back to the verified JWT claims so session info still comes from the server.
  const cookieSession = await auth.api
    .getSession({ headers: fromNodeHeaders(req.headers) })
    .catch(() => null);

  const session = cookieSession?.session
    ? {
        id: cookieSession.session.id,
        createdAt: cookieSession.session.createdAt,
        expiresAt: cookieSession.session.expiresAt,
        updatedAt: cookieSession.session.updatedAt,
      }
    : req.authSession ?? null;

  res.json({ success: true, data: { user: req.authUser, session } });
});

export default router;
