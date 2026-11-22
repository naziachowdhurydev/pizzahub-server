// src/routes/saved.routes.ts
import { Router } from "express";
import { ObjectId } from "mongodb";
import { requireAuth, allowRoles } from "../middleware/auth.js";
import { mongoDB } from "../config/db.js";

const router = Router();

// Collection name for saved items (per user)
// Document shape: { userId: string, items: Array<{ productId: ObjectId, size?: string, savedAt: Date }> }

type SavedItem = {
  productId: ObjectId;
  size?: string;
  savedAt: Date;
};

type SavedDocument = {
  userId: string;
  items: SavedItem[];
};

type CartItem = {
  productId: ObjectId;
  size?: string;
  quantity: number;
};

type CartDocument = {
  userId: string;
  items: CartItem[];
};

/** Helper to get or create the saved doc */
async function getSavedDoc(userId: string): Promise<SavedDocument> {
  const coll = mongoDB.collection<SavedDocument>("saved");
  const doc = await coll.findOne({ userId });
  if (doc) return doc;

  const newDoc: SavedDocument = { userId, items: [] };
  await coll.insertOne(newDoc);
  return newDoc;
}

// GET saved items for the authenticated user
router.get(
  "/",
  requireAuth,
  allowRoles("customer", "vendor", "admin"),
  async (req, res) => {
    try {
      const saved = await getSavedDoc(req.authUser!.id);
      res.json({ success: true, data: saved.items });
    } catch (error) {
      console.error("Load saved items failed:", error);
      res.status(500).json({ success: false, message: "Could not load saved items." });
    }
  },
);

// POST /:productId – add a product to saved list
router.post(
  "/:productId",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    const productId = String(req.params.productId);
    const { size } = req.body as { size?: string };
    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID." });
    }
    try {
      const savedDoc = await getSavedDoc(req.authUser!.id);
      const exists = savedDoc.items.some(
        (i) => String(i.productId) === productId && i.size === size,
      );
      if (exists) {
        return res.json({ success: true, message: "Item already saved." });
      }
      await mongoDB
        .collection<SavedDocument>("saved")
        .updateOne(
          { userId: req.authUser!.id },
          {
            $push: { items: { productId: new ObjectId(productId), size, savedAt: new Date() } },
            $setOnInsert: { userId: req.authUser!.id },
          },
          { upsert: true },
        );
      res.json({ success: true, message: "Item saved for later." });
    } catch (error) {
      console.error("Save item failed:", error);
      res.status(500).json({ success: false, message: "Could not save item." });
    }
  },
);

// DELETE /:productId – remove from saved list
router.delete(
  "/:productId",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    const productId = String(req.params.productId);
    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID." });
    }
    try {
      await mongoDB
        .collection<SavedDocument>("saved")
        .updateOne(
          { userId: req.authUser!.id },
          { $pull: { items: { productId: new ObjectId(productId) } } },
        );
      res.json({ success: true, message: "Item removed from saved list." });
    } catch (error) {
      console.error("Remove saved failed:", error);
      res.status(500).json({ success: false, message: "Could not remove saved item." });
    }
  },
);

// POST /:productId/move – move saved item into the cart (quantity 1)
router.post(
  "/:productId/move",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    const productId = String(req.params.productId);
    const { size } = req.body as { size?: string };
    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID." });
    }
    try {
      // Load product details to get price & image
      const product = await mongoDB
        .collection("products")
        .findOne({ _id: new ObjectId(productId) });
      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
      }
      // Add to cart (reuse same shape as client addToCart)
      await mongoDB.collection<CartDocument>("carts").updateOne(
        { userId: req.authUser!.id },
        {
          $push: {
            items: {
              productId: new ObjectId(productId),
              size,
              quantity: 1,
            },
          },
          $setOnInsert: { userId: req.authUser!.id },
        },
        { upsert: true },
      );
      // Remove from saved list
      await mongoDB
        .collection<SavedDocument>("saved")
        .updateOne(
          { userId: req.authUser!.id },
          { $pull: { items: { productId: new ObjectId(productId) } } },
        );
      res.json({ success: true, message: "Item moved to cart." });
    } catch (error) {
      console.error("Move saved to cart failed:", error);
      res.status(500).json({ success: false, message: "Could not move item to cart." });
    }
  },
);

export default router;
