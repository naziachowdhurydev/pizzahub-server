import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins";
import { mongoClient, mongoDB } from "../config/db.js";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
}

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

// The client uses this flag to show Google sign-in only when the server can
// actually complete the OAuth flow. Credentials always stay on the server.
export const googleAuthEnabled = Boolean(googleClientId && googleClientSecret);

const googleSocialProviders = googleAuthEnabled
  ? {
      google: {
        clientId: googleClientId as string,
        clientSecret: googleClientSecret as string,
      },
    }
  : {};

export const auth = betterAuth({
  appName: "PizzaHub",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
  secret,
  trustedOrigins: [process.env.CLIENT_URL || "http://localhost:3000"],
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
    },
  },
  plugins: [jwt()],
});
