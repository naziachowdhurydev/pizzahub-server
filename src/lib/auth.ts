import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins";
import { mongoClient, mongoDB } from "../config/db.js";
import { getServerBaseUrl } from "./base-url.js";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
}

// Google OAuth credentials are configured directly here so the provider is
// registered on startup without extra environment setup. Keep the secret private.
const googleClientId = "189010282861-ktk2lvhc9m7229iafa0c3hr3iqghv15n.apps.googleusercontent.com";
const googleClientSecret = "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";

// The client uses this flag to show Google sign-in only when the server can
// actually complete the OAuth flow. Credentials always stay on the server.
export const googleAuthEnabled = Boolean(googleClientId && googleClientSecret);

const googleSocialProviders = googleAuthEnabled
  ? {
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    },
  }
  : {};

const authBaseUrl = getServerBaseUrl();

// Requests reach this server through the client app's same-origin proxy, so the
// browser Origin header is the client origin (not the API deployment URL).
const trustedOrigins = [
  authBaseUrl,
  process.env.CLIENT_URL,
  ...(process.env.VERCEL ? ["https://pizzahub-client-*.vercel.app"] : ["http://localhost:3000", "http://localhost:5000"]),
]
  .map((origin) => origin?.trim().replace(/\/+$/, ""))
  .filter((origin): origin is string => Boolean(origin));

export const auth = betterAuth({
  appName: "PizzaHub",
  baseURL: authBaseUrl,
  secret,
  trustedOrigins: Array.from(new Set(trustedOrigins)),
  database: mongodbAdapter(mongoDB, { client: mongoClient }),
  ...(googleAuthEnabled ? { socialProviders: googleSocialProviders } : {}),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: false,
      },
      vendorStatus: {
        type: "string",
        required: false,
        defaultValue: "not_applied",
        input: false,
      },
      vendorAppliedAt: {
        type: "date",
        required: false,
        input: false,
      },
      vendorApprovedAt: {
        type: "date",
        required: false,
        input: false,
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "active",
        input: false,
      },
      plan: {
        type: "string",
        required: false,
        defaultValue: "free",
        input: false,
      },
    },
  },
  plugins: [jwt()],
});
