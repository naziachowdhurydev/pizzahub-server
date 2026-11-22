
import { Router } from "express";
import { ObjectId } from "mongodb";
import { mongoDB } from "../config/db.js";
import { requireAuth, allowRoles } from "../middleware/auth.js";

const router = Router();

type CartItem = {
  productId: ObjectId;
  size: string;
  quantity: number;
};

type CartDocument = {
  userId: string;
  items: CartItem[];
  updatedAt: Date;
};

// Get the current customer's cart with product details
router.get(
  "/",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const cart = await mongoDB.collection<CartDocument>("carts").findOne({
        userId: req.authUser!.id,
      });

      if (!cart || cart.items.length === 0) {
        return res.json({
          success: true,
          data: { items: [], subtotal: 0, itemCount: 0 },
        });
      }

      // Defensively collapse any stale duplicate product/size entries so
      // subtotals and item counts are calculated from one entry per pair.
      const seen = new Set<string>();
      const cartItems = cart.items.filter((item) => {
        const key = `${String(item.productId)}|${item.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const productIds = cartItems.map((item) => item.productId);

      const products = await mongoDB
        .collection("products")
        .find({ _id: { $in: productIds } })
        .toArray();

      const items = cartItems.flatMap((item) => {
        const product = products.find(
          (p) => String(p._id) === String(item.productId),
        );

        if (!product) return [];

        return [{
          productId: String(item.productId),
          name: product.name,
          image: product.image,
          price: product.price,
          size: item.size,
          quantity: item.quantity,
          isAvailable: product.isAvailable === true,
          subtotal: product.price * item.quantity,
        }];
      });

      const subtotal = items.reduce(
        (sum, item) => sum + item.subtotal,
        0,
      );

      const itemCount = items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );

      res.json({
        success: true,
        data: { items, subtotal, itemCount },
      });
    } catch (error) {
      console.error("Get cart error:", error);
      res.status(500).json({
        success: false,
        message: "Could not load cart.",
      });
    }
  },
);

// Add a product to the cart
router.post(
  "/items",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const { productId, size, quantity } = req.body as {
        productId?: string;
        size?: string;
        quantity?: number;
      };
      const selectedSize = size?.trim();

      if (
        !productId ||
        !ObjectId.isValid(productId) ||
        !selectedSize ||
        !Number.isInteger(quantity) ||
        !quantity ||
        quantity < 1 ||
        quantity > 20
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid product, size and quantity are required.",
        });
      }

      const product = await mongoDB.collection("products").findOne({
        _id: new ObjectId(productId),
        isAvailable: true,
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found or unavailable.",
        });
      }

      if (
        Array.isArray(product.sizes) &&
        !product.sizes.includes(selectedSize)
      ) {
        return res.status(400).json({
          success: false,
          message: "Selected size is not available.",
        });
      }

      const userId = req.authUser!.id;
      const carts = mongoDB.collection<CartDocument>("carts");

      const cart = await carts.findOne({ userId });
      const matchingItem = (cart?.items ?? []).find(
        (item) =>
          String(item.productId) === productId &&
          item.size === selectedSize,
      );

      // Keep one entry per product/size pair, even if older data contains duplicates.
      const items = (cart?.items ?? []).filter(
        (item) =>
          String(item.productId) !== productId ||
          item.size !== selectedSize,
      );

      items.push({
        productId: new ObjectId(productId),
        size: selectedSize,
        quantity,
      });

      await carts.updateOne(
        { userId },
        {
          $set: {
            items,
            updatedAt: new Date(),
          },
          $setOnInsert: { userId },
        },
        { upsert: true },
      );

      const itemCount = items.reduce(
        (total, item) => total + item.quantity,
        0,
      );

      res.status(200).json({
        success: true,
        message: matchingItem
          ? "Cart item updated."
          : "Product added to cart.",
        data: { itemCount },
      });
    } catch (error) {
      console.error("Add to cart error:", error);
      res.status(500).json({
        success: false,
        message: "Could not add product to cart.",
      });
    }
  },
);

// Update a cart item's quantity
router.patch(
  "/items/:productId",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const productId = String(req.params.productId);
      const { size, quantity } = req.body as {
        size?: string;
        quantity?: number;
      };
      const selectedSize = size?.trim();

      if (
        !ObjectId.isValid(productId) ||
        !selectedSize ||
        !Number.isInteger(quantity) ||
        !quantity ||
        quantity < 1 ||
        quantity > 20
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid product, size or quantity.",
        });
      }

      const carts = mongoDB.collection<CartDocument>("carts");
      const cart = await carts.findOne({
        userId: req.authUser!.id,
      });

      if (!cart) {
        return res.status(404).json({
          success: false,
          message: "Cart not found.",
        });
      }

      const items = cart.items.filter(
        (entry) =>
          String(entry.productId) === productId &&
          entry.size === selectedSize,
      );
      const item = items[0];

      if (!item) {
        return res.status(404).json({
          success: false,
          message: "Cart item not found.",
        });
      }

      // Collapse any stale duplicates for this product/size pair.
      const nextItems = cart.items.filter(
        (entry) =>
          String(entry.productId) !== productId ||
          entry.size !== selectedSize,
      );
      item.quantity = quantity;
      nextItems.push(item);

      await carts.updateOne(
        { userId: req.authUser!.id },
        {
          $set: {
            items: nextItems,
            updatedAt: new Date(),
          },
        },
      );

      res.json({
        success: true,
        message: "Cart quantity updated.",
      });
    } catch (error) {
      console.error("Update cart error:", error);
      res.status(500).json({
        success: false,
        message: "Could not update cart.",
      });
    }
  },
);

// Remove one product/size combination from the cart
router.delete(
  "/items/:productId",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const productId = String(req.params.productId);
      const size = String(req.query.size ?? "").trim();

      if (!ObjectId.isValid(productId) || !size) {
        return res.status(400).json({
          success: false,
          message: "Valid product ID and size are required.",
        });
      }

      const result = await mongoDB.collection<CartDocument>("carts").updateOne(
        { userId: req.authUser!.id },
        {
          $pull: {
            items: {
              productId: new ObjectId(productId),
              size,
            },
          },
          $set: { updatedAt: new Date() },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Cart not found.",
        });
      }

      res.json({
        success: true,
        message: "Item removed from cart.",
      });
    } catch (error) {
      console.error("Remove cart item error:", error);
      res.status(500).json({
        success: false,
        message: "Could not remove cart item.",
      });
    }
  },
);

// Clear the current customer's cart
router.delete(
  "/",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      await mongoDB.collection<CartDocument>("carts").updateOne(
        { userId: req.authUser!.id },
        {
          $set: {
            items: [],
            updatedAt: new Date(),
          },
        },
      );

      res.json({
        success: true,
        message: "Cart cleared.",
      });
    } catch (error) {
      console.error("Clear cart error:", error);
      res.status(500).json({
        success: false,
        message: "Could not clear cart.",
      });
    }
  },
);

export default router;
