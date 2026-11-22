// src/routes/cart-sync.routes.ts
import { Router } from "express";
import { requireAuth, allowRoles } from "../middleware/auth.js";
import { mongoDB } from "../config/db.js";

const router = Router();

/**
 * Sync the whole cart from the client.
 * Expected body: { items: [{ productId: string, size?: string, quantity: number }] }
 */
router.post(
  "/",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    const { items } = req.body as { items?: any[] };
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: "Items array required." });
    }
    try {
      await mongoDB.collection("carts").updateOne(
        { userId: req.authUser!.id },
        { $set: { items, updatedAt: new Date() } },
        { upsert: true },
      );
      res.json({ success: true, message: "Cart synced." });
    } catch (error) {
      console.error("Cart sync failed:", error);
      res.status(500).json({ success: false, message: "Could not sync cart." });
    }
  },
);

export default router;
