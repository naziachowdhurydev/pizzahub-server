
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

      const productIds = cart.items.map((item) => item.productId);

      const products = await mongoDB
        .collection("products")
        .find({ _id: { $in: productIds } })
        .toArray();

      const items = cart.items.flatMap((item) => {
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

      if (
        !productId ||
        !ObjectId.isValid(productId) ||
        !size?.trim() ||
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
        !product.sizes.includes(size)
      ) {
        return res.status(400).json({
          success: false,
          message: "Selected size is not available.",
        });
      }

      const userId = req.authUser!.id;
      const carts = mongoDB.collection<CartDocument>("carts");

      const cart = await carts.findOne({ userId });
      const items = cart?.items ?? [];

      const existingIndex = items.findIndex(
        (item) =>
          String(item.productId) === productId &&
          item.size === size,
      );

      if (existingIndex >= 0) {
        const newQuantity = items[existingIndex].quantity + quantity;

        if (newQuantity > 20) {
          return res.status(400).json({
            success: false,
            message: "Maximum quantity per item is 20.",
          });
        }

        items[existingIndex].quantity = newQuantity;
      } else {
        items.push({
          productId: new ObjectId(productId),
          size,
          quantity,
        });
      }

      await carts.updateOne(
        { userId },
        {
          $set: {
            items,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      res.status(200).json({
        success: true,
        message: "Product added to cart.",
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

      if (
        !ObjectId.isValid(productId) ||
        !size?.trim() ||
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

      const item = cart.items.find(
        (entry) =>
          String(entry.productId) === productId &&
          entry.size === size,
      );

      if (!item) {
        return res.status(404).json({
          success: false,
          message: "Cart item not found.",
        });
      }

      item.quantity = quantity;

      await carts.updateOne(
        { userId: req.authUser!.id },
        {
          $set: {
            items: cart.items,
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
      const size = String(req.query.size ?? "");

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
