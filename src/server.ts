import "dotenv/config";
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { connectDatabase } from "./config/db.js";
import { startVendorResponseMonitor } from "./lib/order-notifications.js";
import apiRoutes from "./routes/index.js";

const app = express();
const port = Number(process.env.PORT || 5000);
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

app.use(cors({
  origin: clientUrl,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Better Auth must be mounted before express.json() because it reads the request stream.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "PizzaHub API is running." });
});

app.use("/api", apiRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

async function start() {
  await connectDatabase();
  await startVendorResponseMonitor();
  app.listen(port, () => console.log(`PizzaHub server running at http://localhost:${port}`));
}

start().catch(error => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
