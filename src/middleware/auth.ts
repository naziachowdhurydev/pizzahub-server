import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { mongoDB } from "../config/db.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        name: string;
        email: string;
        image?: string | null;
        role: string;
      };
    }
  }
}

const authBaseUrl = process.env.BETTER_AUTH_URL || "http://localhost:5000";
const jwks = createRemoteJWKSet(new URL(`${authBaseUrl}/api/auth/jwks`));

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Bearer token required." });
    }

    const token = header.slice("Bearer ".length).trim();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: authBaseUrl,
      audience: authBaseUrl,
    });

    if (!payload.sub) {
      return res.status(401).json({ success: false, message: "Invalid token subject." });
    }

    // Read the current role from the database on every request so role changes take effect immediately.
    const user = await mongoDB.collection("user").findOne({
      $or: [{ _id: payload.sub as never }, { id: payload.sub }],
    });

    if (!user) {
      return res.status(401).json({ success: false, message: "User no longer exists." });
    }

    req.authUser = {
      id: String(user.id ?? user._id),
      name: String(user.name ?? ""),
      email: String(user.email ?? ""),
      image: typeof user.image === "string" ? user.image : null,
      role: String(user.role ?? "customer"),
    };
    next();
  } catch (error) {
    console.error("JWT verification failed:", error);
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
}

export function allowRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      return res.status(403).json({ success: false, message: "You do not have permission." });
    }
    next();
  };
}
