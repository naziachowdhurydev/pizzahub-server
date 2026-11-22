import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth, googleAuthEnabled } from "../lib/auth.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

type ImgbbResponse = {
  success?: boolean;
  data?: { url?: string; display_url?: string };
  error?: { message?: string };
};

function hasImageSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (mimeType === "image/gif") {
    return bytes.subarray(0, 4).toString("ascii") === "GIF8";
  }
  if (mimeType === "image/webp") {
    return (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

// Public capability flag for the login/register screens. No credentials are exposed.
router.get("/auth-providers", (_req, res) => {
  res.json({ success: true, data: { google: googleAuthEnabled } });
});

// Uploads the image from the server so the ImgBB API key is never sent to the browser.
router.post("/me/image", requireAuth, async (req, res) => {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      message: "Profile image upload is not configured yet.",
    });
  }

  const rawImage = (req.body as { image?: unknown } | null)?.image;
  if (typeof rawImage !== "string" || !rawImage.trim()) {
    return res.status(400).json({ success: false, message: "Choose an image to upload." });
  }

  const dataUrl = rawImage.replace(/\s/g, "");
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(
    dataUrl,
  );
  if (!match) {
    return res.status(400).json({
      success: false,
      message: "Use a PNG, JPG, WEBP or GIF image.",
    });
  }

  const mimeType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_PROFILE_IMAGE_BYTES) {
    return res.status(400).json({
      success: false,
      message: "Image must be 5 MB or smaller.",
    });
  }
  if (!hasImageSignature(bytes, mimeType)) {
    return res.status(400).json({
      success: false,
      message: "The uploaded file is not a valid image.",
    });
  }

  try {
    const form = new FormData();
    const extension = IMAGE_EXTENSIONS[mimeType];
    form.append(
      "image",
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      `pizzahub-profile-${req.authUser!.id}.${extension}`,
    );
    form.append("name", `pizzahub-profile-${req.authUser!.id}`);

    const upstream = await fetch(
      `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`,
      { method: "POST", body: form },
    );
    const payload = (await upstream.json()) as ImgbbResponse;
    const imageUrl = payload.data?.url ?? payload.data?.display_url;

    if (!upstream.ok || payload.success !== true || !imageUrl) {
      return res.status(502).json({
        success: false,
        message: payload.error?.message || "ImgBB rejected the image upload.",
      });
    }

    return res.json({ success: true, data: { url: imageUrl } });
  } catch (error) {
    console.error("ImgBB upload failed:", error);
    return res.status(502).json({
      success: false,
      message: "Could not upload the image right now.",
    });
  }
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
