import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth, googleAuthEnabled } from "../lib/auth.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Public capability flag for the login/register screens. No credentials are exposed.
router.get("/auth-providers", (_req, res) => {
  res.json({ success: true, data: { google: googleAuthEnabled } });
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const sessionData = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    res.json({
      success: true,
      data: {
        user: req.authUser,
        session: sessionData?.session
          ? {
              id: sessionData.session.id,
              createdAt: sessionData.session.createdAt,
              expiresAt: sessionData.session.expiresAt,
              updatedAt: sessionData.session.updatedAt,
            }
          : null,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: "Could not load profile session." });
  }
});


export default router;
