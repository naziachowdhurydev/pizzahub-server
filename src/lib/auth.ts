import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins";
import { mongoClient, mongoDB } from "../config/db.js";
import { getServerBaseUrl } from "./base-url.js";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
}

// Google OAuth credentials stay server-side as Vercel environment variables.
// The browser only ever sees the generated authorize URL, never the secret.
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

// The client uses this flag to show Google sign-in only when the server can
// actually complete the OAuth flow.
export const googleAuthEnabled = Boolean(googleClientId && googleClientSecret);

const googleSocialProviders = googleAuthEnabled
  ? {
    google: {
      clientId: googleClientId!,
      clientSecret: googleClientSecret!,
    },
  }
  : {};

const authBaseUrl = getServerBaseUrl();

// Requests reach this server through the client app's same-origin proxy, so the
// browser Origin header is the client origin (not the API deployment URL).
const trustedOrigins = [
  authBaseUrl,
  process.env.CLIENT_URL,
  ...(process.env.VERCEL ? [] : ["http://localhost:3000", "http://localhost:5000"]),
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

  // Sign-up can choose only customer or vendor. Admin is assigned separately
  // by an administrator, never by the browser.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const isVendor = user.role === "vendor";
          const now = new Date();
          return {
            data: {
              role: isVendor ? "vendor" : "customer",
              status: "active",
              plan: "free",
              vendorStatus: isVendor ? "approved" : "not_applied",
              ...(isVendor
                ? { vendorAppliedAt: now, vendorApprovedAt: now }
                : {}),
            },
          };
        },
        after: async (user) => {
          if (user.role !== "vendor") return;
          // Give every new vendor a store record so the dashboard is usable
          // immediately after sign-up.
          const store = await mongoDB.collection("stores").findOne({ ownerId: user.id });
          if (store) return;
          const now = new Date();
          await mongoDB.collection("stores").updateOne(
            { ownerId: user.id },
            {
              $setOnInsert: {
                ownerId: user.id,
                storeName: `${user.name}'s Pizza Shop`,
                description: "",
                phone: "",
                address: "",
                createdAt: now,
              },
              $set: { updatedAt: now },
            },
            { upsert: true },
          );
        },
      },
    },
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: true,
        transform: {
          input: (value) => (value === "vendor" ? "vendor" : "customer"),
        },
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
