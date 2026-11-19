
import { Router } from "express";
import { ObjectId } from "mongodb";
import { mongoDB } from "../config/db.js";
import { requireAuth, allowRoles } from "../middleware/auth.js";

const router = Router();

// Create a new order
router.post("/", requireAuth, allowRoles("customer", "admin"), async (req, res) => {
  try {
    const { items, deliveryAddress, phone } = req.body as {
      items?: Array<{ productId: string; quantity: number }>;
      deliveryAddress?: string;
      phone?: string;
    };

    if (!Array.isArray(items) || items.length === 0 || !deliveryAddress || !phone) {
      return res.status(400).json({
        success: false,
        message: "Items, delivery address and phone are required.",
      });
    }

    if (
      items.some(
        (item) =>
          !ObjectId.isValid(item.productId) ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 20
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID or item quantity.",
      });
    }

    const productIds = items.map((item) => item.productId);

    const products = await mongoDB
      .collection("products")
      .find({
        _id: { $in: productIds.map((id) => new ObjectId(id)) },
        isAvailable: true,
      })
      .toArray();

    if (products.length !== new Set(productIds).size) {
      return res.status(400).json({
        success: false,
        message: "One or more products are unavailable.",
      });
    }

    const orderItems = items.map((item) => {
      const product = products.find(
        (p) => String(p._id) === item.productId
      )!;

      return {
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
      };
    });

    const total = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const order = {
      userId: req.authUser!.id,
      customerName: req.authUser!.name,
      items: orderItems,
      total,
      deliveryAddress,
      phone,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await mongoDB.collection("orders").insertOne(order);

    res.status(201).json({
      success: true,
      data: { ...order, _id: result.insertedId },
    });
  } catch {
    res.status(500).json({
      success: false,
      message: "Could not create order.",
    });
  }
});

// Customer: Get own orders
router.get("/my", requireAuth, async (req, res) => {
  try {
    const orders = await mongoDB
      .collection("orders")
      .find({ userId: req.authUser!.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: orders });
  } catch {
    res.status(500).json({
      success: false,
      message: "Could not load your orders.",
    });
  }
});

// Admin: Get all orders
router.get("/admin/all", requireAuth, allowRoles("admin"), async (_req, res) => {
  try {
    const orders = await mongoDB
      .collection("orders")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: orders });
  } catch {
    res.status(500).json({
      success: false,
      message: "Could not load orders.",
    });
  }
});

// Admin: Update order status
router.patch(
  "/admin/:id/status",
  requireAuth,
  allowRoles("admin"),
  async (req, res) => {
    try {
    const id = String(req.params.id);
      const { status } = req.body as { status?: string };

      const allowedStatuses = [
        "pending",
        "confirmed",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ];

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid order ID.",
        });
      }

      if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid order status.",
        });
      }

      const result = await mongoDB.collection("orders").updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found.",
        });
      }

      res.json({
        success: true,
        message: "Order status updated successfully.",
      });
    } catch {
      res.status(500).json({
        success: false,
        message: "Could not update order status.",
      });
    }
  }
);

// Admin: Delete an order
router.delete(
  "/admin/:id",
  requireAuth,
  allowRoles("admin"),
  async (req, res) => {
    try {
   const id = String(req.params.id);

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid order ID.",
        });
      }

      const result = await mongoDB.collection("orders").deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found.",
        });
      }

      res.json({
        success: true,
        message: "Order deleted successfully.",
      });
    } catch {
      res.status(500).json({
        success: false,
        message: "Could not delete order.",
      });
    }
  }
);

export default router;
