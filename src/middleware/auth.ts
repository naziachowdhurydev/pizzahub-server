import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { mongoDB } from "../config/db.js";
import type { UserDocument } from "../lib/users.js";
import { userFilterById } from "../lib/users.js";
import { normalizeVendorPlan, type VendorPlan } from "../lib/vendor-plan.js";
import { getServerBaseUrl } from "../lib/base-url.js";

export type UserRole = "customer" | "vendor" | "admin";
export type VendorStatus = "not_applied" | "pending" | "approved" | "rejected";
export type AccountStatus = "active" | "suspended";

export type TokenSession = {
  id?: string;
  createdAt?: string;
  expiresAt?: string;
  updatedAt?: string;
};

declare global {
  namespace Express {
    interface Request {
      authSession?: TokenSession;
      authUser?: {
        id: string;
        name: string;
        email: string;
        image?: string | null;
        role: UserRole;
        vendorStatus: VendorStatus;
        status: AccountStatus;
        plan: VendorPlan;
      };
    }
  }
}

const authBaseUrl = getServerBaseUrl();
const jwks = createRemoteJWKSet(new URL(`${authBaseUrl}/api/auth/jwks`));

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Bearer token required." });
  }

  let subject: string;
  try {
    const token = header.slice("Bearer ".length).trim();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: authBaseUrl,
      audience: authBaseUrl,
    });

    if (typeof payload.sub !== "string" || !payload.sub) {
      return res.status(401).json({ success: false, message: "Invalid token subject." });
    }
    subject = payload.sub;
    req.authSession = {
      id: typeof payload.jti === "string" ? payload.jti : undefined,
      createdAt: typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : undefined,
      expiresAt: typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : undefined,
      updatedAt: typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : undefined,
    };
  } catch (error) {
    console.error("JWT verification failed:", error);
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }

  let user: UserDocument | null;
  try {
    // Authorization always uses the current MongoDB record, never JWT role claims.
    user = await mongoDB.collection<UserDocument>("user").findOne(userFilterById(subject));
  } catch (error) {
    console.error("Load authenticated user failed:", error);
    return res.status(500).json({ success: false, message: "Could not verify account permissions." });
  }

  if (!user) {
    return res.status(401).json({ success: false, message: "User no longer exists." });
  }

  const role =
    user.role === "admin" || user.role === "vendor" || user.role === "customer"
      ? user.role
      : user.role == null
        ? "customer"
        : null;
  if (!role) {
    return res.status(403).json({ success: false, message: "This account has an unsupported role." });
  }
  const vendorStatus: VendorStatus =
    user.vendorStatus === "pending" ||
    user.vendorStatus === "approved" ||
    user.vendorStatus === "rejected"
      ? user.vendorStatus
      : "not_applied";
  const status: AccountStatus = user.status === "active" || user.status === undefined
    ? "active"
    : "suspended";

  if (status !== "active") {
    return res.status(403).json({ success: false, message: "This account is suspended." });
  }
  const plan = normalizeVendorPlan(user.plan);

  req.authUser = {
    id: String(user.id ?? user._id),
    name: String(user.name ?? ""),
    email: String(user.email ?? ""),
    image: typeof user.image === "string" ? user.image : null,
    role,
    vendorStatus,
    status,
    plan,
  };
  return next();
}

export function allowRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!roles.includes(req.authUser.role)) {
      return res.status(403).json({ success: false, message: "You do not have permission." });
    }
    next();
  };
}

// Explicit admin guard. Role comes from the current MongoDB user loaded by requireAuth,
// never from a JWT claim or request body.
export function verifyAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  if (req.authUser.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access is required." });
  }
  return next();
}

export const requireAdmin = verifyAdmin;
export const requireCustomer = allowRoles("customer");

export function requireVendor(req: Request, res: Response, next: NextFunction) {
  return requireApprovedVendor(req, res, next);
}

export function requireApprovedVendor(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.authUser) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  if (req.authUser.role === "admin") {
    return next();
  }
  if (req.authUser.role !== "vendor") {
    return res.status(403).json({ success: false, message: "Vendor access is required." });
  }
  if (req.authUser.vendorStatus !== "approved") {
    return res.status(403).json({ success: false, message: "Your vendor account is not approved." });
  }
  return next();
}
