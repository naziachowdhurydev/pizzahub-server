import "dotenv/config";
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { getServerBaseUrl } from "./lib/base-url.js";
import { connectDatabase } from "./config/db.js";
import { startVendorResponseMonitor } from "./lib/order-notifications.js";
import apiRoutes from "./routes/index.js";

const app = express();
const port = Number(process.env.PORT || 5000);
const isServerless = Boolean(process.env.VERCEL);
const allowedOrigins = [
  process.env.CLIENT_URL,
  getServerBaseUrl(),
  ...(isServerless ? [] : ["http://localhost:3000", "http://localhost:5000"]),
]
  .map((origin) => origin?.trim().replace(/\/+$/, ""))
  .filter((origin): origin is string => Boolean(origin));

app.use(cors({
  origin: (origin, callback) => {
    const isPreviewClient = Boolean(origin && /^https:\/\/pizzahub-client-[a-z0-9-]+\.vercel\.app$/i.test(origin));
    callback(null, !origin || allowedOrigins.includes(origin) || isPreviewClient);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  exposedHeaders: ["Set-Cookie"],
}));

// Better Auth must be mounted before express.json() because it reads the request stream.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "PizzaHub API is running." });
});

app.use("/api", apiRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

async function start() {
  // On Vercel the MongoDB driver connects lazily on the first operation.
  // Awaiting a ping here would fail cold starts before any request is handled.
  if (isServerless) return;
  await connectDatabase();
  await startVendorResponseMonitor();
  app.listen(port, () => console.log(`PizzaHub server running at http://localhost:${port}`));
}

start().catch(error => {
  console.error("Server startup failed:", error);
  if (!isServerless) process.exit(1);
});

export default app;