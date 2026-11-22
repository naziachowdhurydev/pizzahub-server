
import { Router } from "express";
import { ObjectId } from "mongodb";
import { mongoDB } from "../config/db.js";
import {
  requireAuth,
  requireCustomer,
  verifyAdmin,
} from "../middleware/auth.js";
import {
  getItemStatus,
  getOrderStatus,
  normalizeOrder,
  type OrderLine,
  type OrderRecord,
} from "../lib/order-management.js";
import {
  listAdminOrders,
  updateAdminOrderStatus,
} from "../controllers/admin-orders.js";
import {
  createCustomerOrderIssue,
  listCustomerOrderIssues,
} from "../controllers/order-issues.js";
import {
  listOrderNotifications,
  markOrderNotificationRead,
} from "../controllers/order-notifications.js";
import {
  assertNoActiveDuplicateOrder,
  assertNotOwnProduct,
  assertUniqueRequestedProducts,
  OrderRuleError,
  validateDeliveryDate,
  validateNotes,
} from "../lib/order-rules.js";

const router = Router();

async function addCustomerVendorDetails(orders: OrderRecord[]): Promise<OrderRecord[]> {
  const unresolvedProductIds = [
    ...new Set(
      orders.flatMap((order) =>
        (order.items ?? [])
          .filter((item) => item.vendorId == null)
          .map((item) => String(item.productId)),
      ),
    ),
  ]
    .filter(ObjectId.isValid)
    .map((id) => new ObjectId(id));
  const productOwners = unresolvedProductIds.length
    ? await mongoDB
        .collection("products")
        .find({ _id: { $in: unresolvedProductIds } })
        .project({ _id: 1, vendorId: 1 })
        .toArray()
    : [];
  const ownerByProduct = new Map(
    productOwners
      .filter((product) => typeof product.vendorId === "string")
      .map((product) => [String(product._id), product.vendorId as string]),
  );
  const vendorIds = [
    ...new Set(
      orders.flatMap((order) =>
        (order.items ?? [])
          .map(
            (item) =>
              (typeof item.vendorId === "string" ? item.vendorId : undefined) ??
              ownerByProduct.get(String(item.productId)),
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ),
  ];
  const stores = vendorIds.length
    ? await mongoDB
        .collection("stores")
        .find({ ownerId: { $in: vendorIds } })
        .project({ ownerId: 1, storeName: 1 })
        .toArray()
    : [];
  const storeNames = new Map(
    stores.map((store) => [String(store.ownerId), String(store.storeName ?? "")]),
  );

  return orders.map((order) => {
    const normalized = normalizeOrder(order);
    return {
      ...normalized,
      items: ((normalized.items ?? []) as OrderLine[]).map((item) => {
        const vendorId =
          (typeof item.vendorId === "string" ? item.vendorId : undefined) ??
          ownerByProduct.get(String(item.productId)) ??
          null;
        return {
          ...item,
          vendorId,
          vendorName: vendorId
            ? storeNames.get(vendorId) || "PizzaHub vendor"
            : "PizzaHub platform",
        };
      }),
    };
  });
}

router.get(
  "/notifications",
  requireAuth,
  requireCustomer,
  listOrderNotifications("customer"),
);
router.patch(
  "/notifications/:id/read",
  requireAuth,
  requireCustomer,
  markOrderNotificationRead("customer"),
);
router.get("/issues/my", requireAuth, requireCustomer, listCustomerOrderIssues);
router.post("/:id/issues", requireAuth, requireCustomer, createCustomerOrderIssue);

// Create a new order from a product details page.
router.post("/", requireAuth, requireCustomer, async (req, res) => {
  try {
    const body = req.body as {
      items?: Array<{ productId: string; size?: string; quantity: number }>;
      deliveryDate?: string;
      deliveryAddress?: string;
      phone?: string;
      notes?: string;
    } | null;
    const { items, deliveryAddress, phone, notes } = body ?? {};

    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      typeof deliveryAddress !== "string" ||
      !deliveryAddress.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Items, delivery date and delivery address are required.",
      });
    }

    const deliveryDate = validateDeliveryDate(body?.deliveryDate);
    const specialInstructions = validateNotes(notes);

    if (
      items.some(
        (item) =>
          !item ||
          typeof item.productId !== "string" ||
          !ObjectId.isValid(item.productId) ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 20 ||
          (item.size !== undefined &&
            (typeof item.size !== "string" || !item.size.trim()))
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

    assertUniqueRequestedProducts(products);
    assertNotOwnProduct(products, req.authUser!.id);
    await assertNoActiveDuplicateOrder({
      userId: req.authUser!.id,
      deliveryDate,
      products,
    });

    const orderItems = [];
    for (const item of items) {
      const product = products.find((p) => String(p._id) === item.productId);
      if (!product) {
        return res.status(400).json({
          success: false,
          message: "One or more products are unavailable.",
        });
      }
      if (
        item.size &&
        Array.isArray(product.sizes) &&
        !product.sizes.includes(item.size)
      ) {
        return res.status(400).json({
          success: false,
          message: `${product.name} is not available in ${item.size} size.`,
        });
      }
      if (
        typeof product.price !== "number" ||
        !Number.isFinite(product.price) ||
        product.price <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: `${product.name} has an invalid price.`,
        });
      }

      orderItems.push({
        itemId: new ObjectId(),
        productId: product._id,
        vendorId: typeof product.vendorId === "string" ? product.vendorId : null,
        name: product.name,
        image: product.image ?? "",
        size: item.size ?? product.sizes?.[0] ?? "Regular",
        price: product.price,
        quantity: item.quantity,
        subtotal: product.price * item.quantity,
        status: "pending",
      });
    }

    const total = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const order = {
      userId: req.authUser!.id,
      customerName: req.authUser!.name,
      customerEmail: req.authUser!.email,
      items: orderItems,
      total,
      deliveryDate,
      deliveryAddress: deliveryAddress.trim(),
      phone: typeof phone === "string" ? phone.trim() : "",
      notes: specialInstructions,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await mongoDB.collection("orders").insertOne(order);

    return res.status(201).json({
      success: true,
      message: "Order placed successfully. Status: Pending.",
      data: { ...order, _id: result.insertedId },
    });
  } catch (error) {
    if (error instanceof OrderRuleError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    console.error("Create order failed:", error);
    return res.status(500).json({
      success: false,
      message: "Could not create order.",
    });
  }
});


router.post(
  "/checkout",
  requireAuth,
  requireCustomer,
  async (req, res) => {
    try {
      const body = req.body as {
        deliveryDate?: string;
        deliveryAddress?: string;
        phone?: string;
        notes?: string;
      } | null;
      const { deliveryAddress, phone, notes } = body ?? {};

      if (
        typeof deliveryAddress !== "string" ||
        !deliveryAddress.trim() ||
        typeof phone !== "string" ||
        !phone.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Delivery date, address and phone are required.",
        });
      }

      const deliveryDate = validateDeliveryDate(body?.deliveryDate);
      const specialInstructions = validateNotes(notes);
      const userId = req.authUser!.id;

      const cart = await mongoDB.collection("carts").findOne({
        userId,
      });

      if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Your cart is empty.",
        });
      }

      const cartItems = cart.items as Array<{
        productId: ObjectId;
        size: string;
        quantity: number;
      }>;

      const productIds = cartItems.map((item) => item.productId);

      const products = await mongoDB.collection("products").find({
        _id: { $in: productIds },
        isAvailable: true,
      }).toArray();

      if (products.length !== new Set(productIds.map(String)).size) {
        return res.status(400).json({
          success: false,
          message: "Some products in your cart are unavailable.",
        });
      }

      assertUniqueRequestedProducts(products);
      assertNotOwnProduct(products, userId);
      await assertNoActiveDuplicateOrder({ userId, deliveryDate, products });

      const orderItems = [];

      for (const item of cartItems) {
        if (
          !ObjectId.isValid(String(item.productId)) ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 20 ||
          typeof item.size !== "string"
        ) {
          return res.status(400).json({
            success: false,
            message: "Your cart contains an invalid item.",
          });
        }

        const product = products.find(
          (p) => String(p._id) === String(item.productId),
        );

        if (!product) {
          return res.status(400).json({
            success: false,
            message: "A product in your cart is unavailable.",
          });
        }

        if (
          Array.isArray(product.sizes) &&
          !product.sizes.includes(item.size)
        ) {
          return res.status(400).json({
            success: false,
            message: `${product.name} is not available in ${item.size} size.`,
          });
        }

        if (
          typeof product.price !== "number" ||
          !Number.isFinite(product.price) ||
          product.price <= 0
        ) {
          return res.status(400).json({
            success: false,
            message: "A product has an invalid price.",
          });
        }

        orderItems.push({
          itemId: new ObjectId(),
          productId: product._id,
          vendorId: typeof product.vendorId === "string" ? product.vendorId : null,
          name: product.name,
          image: product.image ?? "",
          size: item.size,
          price: product.price,
          quantity: item.quantity,
          subtotal: product.price * item.quantity,
          status: "pending",
        });
      }

      const subtotal = orderItems.reduce(
        (sum, item) => sum + item.subtotal,
        0,
      );

      // Example delivery fee. You can change this to your business rule.
      const deliveryFee = 3;
      const total = subtotal + deliveryFee;

      const order = {
        userId,
        customerName: req.authUser!.name,
        customerEmail: req.authUser!.email,
        items: orderItems,
        subtotal,
        deliveryFee,
        total,
        deliveryDate,
        deliveryAddress: deliveryAddress.trim(),
        phone: phone.trim(),
        notes: specialInstructions,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await mongoDB.collection("orders").insertOne(order);

      await mongoDB.collection("carts").updateOne(
        { userId },
        {
          $set: {
            items: [],
            updatedAt: new Date(),
          },
        },
      );

      return res.status(201).json({
        success: true,
        message: "Your order has been placed successfully.",
        data: {
          ...order,
          _id: result.insertedId,
        },
      });
    } catch (error) {
      if (error instanceof OrderRuleError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
        });
      }
      console.error("Checkout error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not place your order.",
      });
    }
  },
);


// Customer: Get own orders
router.get("/my", requireAuth, requireCustomer, async (req, res) => {
  try {
    const orders = await mongoDB
      .collection<OrderRecord>("orders")
      .find({ userId: req.authUser!.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: await addCustomerVendorDetails(orders) });
  } catch (error) {
    console.error("Load customer orders failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not load your orders.",
    });
  }
});

router.get("/:id", requireAuth, requireCustomer, async (req, res) => {
  const id = String(req.params.id);
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Invalid order ID." });
  }
  try {
    const order = await mongoDB.collection<OrderRecord>("orders").findOne({
      _id: new ObjectId(id),
      userId: req.authUser!.id,
    });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }
    const [orderWithVendorDetails] = await addCustomerVendorDetails([order]);
    return res.json({ success: true, data: orderWithVendorDetails });
  } catch (error) {
    console.error("Load customer order failed:", error);
    return res.status(500).json({ success: false, message: "Could not load order." });
  }
});

router.patch("/:id/cancel", requireAuth, requireCustomer, async (req, res) => {
  const id = String(req.params.id);
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Invalid order ID." });
  }
  try {
    const orderId = new ObjectId(id);
    const orders = mongoDB.collection<OrderRecord>("orders");
    const order = await orders.findOne({
      _id: orderId,
      userId: req.authUser!.id,
    });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }
    const items = order.items ?? [];
    if (
      getOrderStatus(order) !== "pending" ||
      items.some((item) => getItemStatus(item, order.status) !== "pending")
    ) {
      return res.status(409).json({
        success: false,
        message: "This order can no longer be cancelled.",
      });
    }

    const filter: Record<string, unknown> = {
      _id: orderId,
      userId: req.authUser!.id,
    };
    if (order.updatedAt) filter.updatedAt = order.updatedAt;
    if (items.length) filter.items = items;
    const update: Record<string, unknown> = {
      status: "cancelled",
      updatedAt: new Date(),
    };
    if (items.length) update["items.$[].status"] = "cancelled";
    const result = await orders.updateOne(filter, { $set: update });
    if (result.matchedCount === 0) {
      return res.status(409).json({
        success: false,
        message: "The order changed before cancellation. Refresh and try again.",
      });
    }
    const updated = await orders.findOne({ _id: orderId });
    if (!updated) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }
    const [orderWithVendorDetails] = await addCustomerVendorDetails([updated]);
    return res.json({ success: true, data: orderWithVendorDetails });
  } catch (error) {
    console.error("Cancel customer order failed:", error);
    return res.status(500).json({ success: false, message: "Could not cancel order." });
  }
});

// Admin-only order routes are mounted behind requireAuth + verifyAdmin.
const adminRouter = Router();
adminRouter.use(requireAuth, verifyAdmin);

adminRouter.get("/all", listAdminOrders);
adminRouter.patch("/:id/status", updateAdminOrderStatus);

adminRouter.delete("/:id", async (req, res) => {
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
});

router.use("/admin", adminRouter);

export default router;
