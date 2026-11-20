import { Router, type RequestHandler } from "express";
import { ObjectId } from "mongodb";
import { mongoClient, mongoDB } from "../config/db.js";
import {
  requireApprovedVendor,
  requireAuth,
  requireVendor,
} from "../middleware/auth.js";
import {
  getItemStatus,
  getOrderStatus,
  isOrderStatus,
  vendorStatusTransitions,
  type OrderRecord,
  type OrderStatus,
} from "../lib/order-management.js";
import {
  makeCustomerStatusNotification,
  recordOrderNotification,
} from "../lib/order-notifications.js";

const router = Router();

type VendorOrderItem = {
  itemId: string;
  productId: string;
  vendorId: string;
  status: OrderStatus;
  rejectionReason?: string;
  name: string;
  size: string;
  image: string;
  price: number;
  quantity: number;
  subtotal: number;
};

type VendorOrderWithItems = {
  _id: ObjectId;
  status: OrderStatus;
  createdAt?: Date;
  customerName: string;
  deliveryAddress: string;
  phone: string;
  vendorTotal: number;
  items: VendorOrderItem[];
};

class VendorOrderError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

async function loadVendorOrders(vendorId: string): Promise<VendorOrderWithItems[]> {
  const products = await mongoDB
    .collection("products")
    .find({ vendorId })
    .project({ _id: 1 })
    .toArray();
  const productIds = products.map((product) => product._id);
  const productIdSet = new Set(productIds.map(String));
  const ordersCollection = mongoDB.collection<OrderRecord>("orders");
  const [snapshotOrders, legacyOrders] = await Promise.all([
    ordersCollection
      .find({ "items.vendorId": vendorId })
      .sort({ createdAt: -1 })
      .toArray(),
    productIds.length
      ? ordersCollection
          .find({
            "items.productId": { $in: [...productIds, ...productIds.map(String)] },
          })
          .sort({ createdAt: -1 })
          .toArray()
      : Promise.resolve([] as OrderRecord[]),
  ]);
  const ordersById = new Map<string, OrderRecord>();
  for (const order of [...snapshotOrders, ...legacyOrders]) {
    ordersById.set(String(order._id), order);
  }

  return [...ordersById.values()].flatMap((order) => {
    const ownItems = (Array.isArray(order.items) ? order.items : [])
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          item.vendorId === vendorId ||
          (item.vendorId == null && productIdSet.has(String(item.productId))),
      );
    if (ownItems.length === 0) return [];
    const orderWithOwnItems = { ...order, items: ownItems.map(({ item }) => item) };
    const responseItems = ownItems.map(({ item, index }) => ({
      itemId: String(item.itemId ?? item._id ?? `legacy_${index}`),
      productId: String(item.productId),
      vendorId,
      status: getItemStatus(item, order.status),
      name: String(item.name ?? ""),
      size: String(item.size ?? ""),
      image: String(item.image ?? ""),
      price: Number(item.price ?? 0),
      quantity: Number(item.quantity ?? 0),
      subtotal: Number(
        item.subtotal ?? Number(item.price ?? 0) * Number(item.quantity ?? 0),
      ),
      ...(typeof item.rejectionReason === "string"
        ? { rejectionReason: item.rejectionReason }
        : {}),
    }));

    return [{
      _id: order._id,
      status: getOrderStatus(orderWithOwnItems),
      createdAt: order.createdAt,
      customerName: String(order.customerName ?? ""),
      deliveryAddress: String(order.deliveryAddress ?? ""),
      phone: String(order.phone ?? ""),
      vendorTotal: responseItems.reduce((sum, item) => sum + item.subtotal, 0),
      items: responseItems,
    }];
  }).sort(
    (left, right) =>
      (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0),
  );
}

function updateVendorOrderItem(legacyProductId = false): RequestHandler {
  return async (req, res) => {
    const orderId = String(req.params.id);
    const selector = legacyProductId
      ? (req.body as { productId?: unknown } | null)?.productId
      : req.params.itemId;
    const body = req.body as {
      status?: unknown;
      rejectionReason?: unknown;
      productId?: unknown;
    } | null;
    const status = body?.status;
    const rejectionReason = body?.rejectionReason;
    if (!ObjectId.isValid(orderId)) {
      res.status(400).json({ success: false, message: "Invalid order ID." });
      return;
    }
    if (typeof selector !== "string" || !selector) {
      res.status(400).json({ success: false, message: "Invalid order item ID." });
      return;
    }
    if (legacyProductId && !ObjectId.isValid(selector)) {
      res.status(400).json({ success: false, message: "Invalid product ID." });
      return;
    }
    if (
      !legacyProductId &&
      !/^legacy_\d+$/.test(selector) &&
      !ObjectId.isValid(selector)
    ) {
      res.status(400).json({ success: false, message: "Invalid order item ID." });
      return;
    }
    if (!isOrderStatus(status)) {
      res.status(400).json({ success: false, message: "Invalid vendor order status." });
      return;
    }
    if (
      (status === "rejected" &&
        (typeof rejectionReason !== "string" ||
          rejectionReason.trim().length < 5 ||
          rejectionReason.trim().length > 500)) ||
      (status !== "rejected" && rejectionReason !== undefined)
    ) {
      res.status(400).json({
        success: false,
        message: "A rejection reason between 5 and 500 characters is required when rejecting an item.",
      });
      return;
    }

    const session = mongoClient.startSession();
    try {
      const vendorId = req.authUser!.id;
      const orderObjectId = new ObjectId(orderId);
      const orders = mongoDB.collection<OrderRecord>("orders");
      await session.withTransaction(async () => {
        const productIds = await mongoDB
          .collection("products")
          .find({ vendorId }, { session })
          .project({ _id: 1 })
          .toArray();
        const ownedProductIds = new Set(productIds.map((product) => String(product._id)));
        const order = await orders.findOne({ _id: orderObjectId }, { session });
        if (!order) throw new VendorOrderError(404, "Order not found.");

        const items = order.items ?? [];
        const selectedIndex = items.findIndex((item, index) => {
          const ownsItem =
            item.vendorId === vendorId ||
            (item.vendorId == null && ownedProductIds.has(String(item.productId)));
          if (!ownsItem) return false;
          if (legacyProductId) return String(item.productId) === selector;
          return String(item.itemId ?? item._id ?? `legacy_${index}`) === selector;
        });
        if (selectedIndex < 0) {
          throw new VendorOrderError(404, "Order item not found in your store.");
        }

        const selectedItem = items[selectedIndex];
        const currentStatus = getItemStatus(selectedItem, order.status);
        if (
          status !== currentStatus &&
          !vendorStatusTransitions[currentStatus].includes(status)
        ) {
          throw new VendorOrderError(
            400,
            `Cannot change this item from ${currentStatus} to ${status}.`,
          );
        }

        const now = new Date();
        const statusChanged = status !== currentStatus;
        const itemIdField =
          selectedItem.itemId !== undefined
            ? "itemId"
            : selectedItem._id !== undefined
              ? "_id"
              : null;
        let updateResult;
        if (itemIdField) {
          const storedItemId = selectedItem[itemIdField];
          const itemIds =
            storedItemId instanceof ObjectId
              ? [storedItemId, storedItemId.toHexString()]
              : [storedItemId];
          updateResult = await orders.updateOne(
            {
              _id: orderObjectId,
              items: {
                $elemMatch: {
                  [itemIdField]: { $in: itemIds },
                  productId: selectedItem.productId,
                  vendorId: selectedItem.vendorId ?? null,
                  ...(selectedItem.status === undefined
                    ? { status: { $exists: false } }
                    : { status: selectedItem.status }),
                },
              },
            },
            {
              $set: {
                "items.$[line].status": status,
                "items.$[line].vendorId": vendorId,
                updatedAt: now,
                ...(status === "rejected"
                  ? { "items.$[line].rejectionReason": (rejectionReason as string).trim() }
                  : {}),
              },
              ...(status === "rejected"
                ? {}
                : { $unset: { "items.$[line].rejectionReason": "" } }),
            },
            {
              arrayFilters: [
                {
                  [`line.${itemIdField}`]: { $in: itemIds },
                  "line.productId": selectedItem.productId,
                  "line.vendorId": selectedItem.vendorId ?? null,
                  ...(selectedItem.status === undefined
                    ? { "line.status": { $exists: false } }
                    : { "line.status": selectedItem.status }),
                },
              ],
              session,
            },
          );
        } else {
          const itemPrefix = `items.${selectedIndex}`;
          const filter: Record<string, unknown> = {
            _id: orderObjectId,
            [`${itemPrefix}.productId`]: selectedItem.productId,
          };
          filter[`${itemPrefix}.vendorId`] =
            selectedItem.vendorId === undefined
              ? { $exists: false }
              : selectedItem.vendorId;
          filter[`${itemPrefix}.status`] =
            selectedItem.status === undefined
              ? { $exists: false }
              : selectedItem.status;
          updateResult = await orders.updateOne(
            filter,
            {
              $set: {
                [`${itemPrefix}.status`]: status,
                [`${itemPrefix}.vendorId`]: vendorId,
                updatedAt: now,
                ...(status === "rejected"
                  ? { [`${itemPrefix}.rejectionReason`]: (rejectionReason as string).trim() }
                  : {}),
              },
              ...(status === "rejected"
                ? {}
                : { $unset: { [`${itemPrefix}.rejectionReason`]: "" } }),
            },
            { session },
          );
        }
        if (updateResult.matchedCount === 0) {
          throw new VendorOrderError(
            409,
            "The order item changed. Refresh and try again.",
          );
        }

        const refreshedOrder = await orders.findOne(
          { _id: orderObjectId },
          { session },
        );
        if (!refreshedOrder) {
          throw new VendorOrderError(404, "Order not found.");
        }
        await orders.updateOne(
          { _id: orderObjectId },
          { $set: { status: getOrderStatus(refreshedOrder) } },
          { session },
        );
        if (statusChanged) {
          const store = await mongoDB.collection("stores").findOne(
            { ownerId: vendorId },
            { projection: { storeName: 1 }, session },
          );
          const notification = makeCustomerStatusNotification({
            order: refreshedOrder,
            item: selectedItem,
            itemId: String(selectedItem.itemId ?? selectedItem._id ?? `legacy_${selectedIndex}`),
            vendorId,
            vendorName: String(store?.storeName ?? "Your vendor"),
            status,
            ...(status === "rejected" && typeof rejectionReason === "string"
              ? { rejectionReason: rejectionReason.trim() }
              : {}),
          });
          if (notification) await recordOrderNotification(notification, session);
        }
      });
      const updatedVendorOrder = (await loadVendorOrders(vendorId)).find(
        (entry) => String(entry._id) === orderId,
      );
      res.json({ success: true, data: updatedVendorOrder ?? null });
    } catch (error) {
      if (error instanceof VendorOrderError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error("Update vendor order item status failed:", error);
      res.status(500).json({
        success: false,
        message: "Could not update order item status.",
      });
    } finally {
      await session.endSession();
    }
  };
}

router.get(
  "/products",
  requireAuth,
  requireVendor,
  async (req, res) => {
    try {
      const products = await mongoDB
        .collection("products")
        .find({ vendorId: req.authUser!.id })
        .sort({ createdAt: -1 })
        .toArray();
      res.json({ success: true, data: products });
    } catch (error) {
      console.error("Load vendor products failed:", error);
      res.status(500).json({ success: false, message: "Could not load your products." });
    }
  },
);

router.post(
  "/products",
  requireAuth,
  requireVendor,
  async (req, res) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      const { name, slug, description, category, price, image } =
        body ?? {};
      if (
        ![name, slug, description, category, image].every(
          (value) => typeof value === "string" && value.trim(),
        ) ||
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Provide valid product information.",
        });
      }

      const productSlug = (slug as string).trim();
      const exists = await mongoDB.collection("products").findOne({
        slug: productSlug,
      });
      if (exists) {
        return res.status(409).json({
          success: false,
          message: "A product with this slug already exists.",
        });
      }

      const product = {
        name: (name as string).trim(),
        slug: productSlug,
        description: (description as string).trim(),
        category: (category as string).trim(),
        price,
        image: (image as string).trim(),
        sizes: ["Regular", "Large"],
        isAvailable: true,
        isFeatured: false,
        rating: 0,
        vendorId: req.authUser!.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await mongoDB.collection("products").insertOne(product);
      res.status(201).json({
        success: true,
        data: { ...product, _id: result.insertedId },
      });
    } catch (error) {
      console.error("Create vendor product failed:", error);
      res.status(500).json({ success: false, message: "Could not create product." });
    }
  },
);

router.put(
  "/products/:id",
  requireAuth,
  requireVendor,
  async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
      }

      const body = req.body as Record<string, unknown> | null;
      const { name, slug, description, category, price, image, isAvailable } =
        body ?? {};
      if (
        (name !== undefined && (typeof name !== "string" || !name.trim())) ||
        (slug !== undefined && (typeof slug !== "string" || !slug.trim())) ||
        (description !== undefined &&
          (typeof description !== "string" || !description.trim())) ||
        (category !== undefined &&
          (typeof category !== "string" || !category.trim())) ||
        (image !== undefined && (typeof image !== "string" || !image.trim())) ||
        (price !== undefined &&
          (typeof price !== "number" || !Number.isFinite(price) || price <= 0)) ||
        (isAvailable !== undefined && typeof isAvailable !== "boolean")
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid product information.",
        });
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = (name as string).trim();
      if (slug !== undefined) updateData.slug = (slug as string).trim();
      if (description !== undefined)
        updateData.description = (description as string).trim();
      if (category !== undefined) updateData.category = (category as string).trim();
      if (image !== undefined) updateData.image = (image as string).trim();
      if (price !== undefined) updateData.price = price;
      if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: "Provide at least one field to update.",
        });
      }

      if (typeof updateData.slug === "string") {
        const duplicate = await mongoDB.collection("products").findOne({
          slug: updateData.slug,
          _id: { $ne: new ObjectId(id) },
        });
        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: "A product with this slug already exists.",
          });
        }
      }

      updateData.updatedAt = new Date();
      const result = await mongoDB.collection("products").updateOne(
        { _id: new ObjectId(id), vendorId: req.authUser!.id },
        { $set: updateData },
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Product not found in your store.",
        });
      }

      const product = await mongoDB.collection("products").findOne({
        _id: new ObjectId(id),
        vendorId: req.authUser!.id,
      });
      res.json({ success: true, data: product });
    } catch (error) {
      console.error("Update vendor product failed:", error);
      res.status(500).json({ success: false, message: "Could not update product." });
    }
  },
);

router.delete(
  "/products/:id",
  requireAuth,
  requireVendor,
  async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
      }
      const result = await mongoDB.collection("products").deleteOne({
        _id: new ObjectId(id),
        vendorId: req.authUser!.id,
      });
      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Product not found in your store.",
        });
      }
      res.json({ success: true, message: "Product removed from your store." });
    } catch (error) {
      console.error("Delete vendor product failed:", error);
      res.status(500).json({ success: false, message: "Could not remove product." });
    }
  },
);

router.get(
  "/orders",
  requireAuth,
  requireApprovedVendor,
  async (req, res) => {
    try {
      const orders = await loadVendorOrders(req.authUser!.id);
      res.json({ success: true, data: orders });
    } catch (error) {
      console.error("Load vendor orders failed:", error);
      res.status(500).json({ success: false, message: "Could not load store orders." });
    }
  },
);

router.get(
  "/orders/:id",
  requireAuth,
  requireApprovedVendor,
  async (req, res) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid order ID." });
    }
    try {
      const order = (await loadVendorOrders(req.authUser!.id)).find(
        (item) => String(item._id) === id,
      );
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found in your store." });
      }
      return res.json({ success: true, data: order });
    } catch (error) {
      console.error("Load vendor order failed:", error);
      return res.status(500).json({ success: false, message: "Could not load order." });
    }
  },
);

router.patch(
  "/orders/:id/items/:itemId/status",
  requireAuth,
  requireApprovedVendor,
  updateVendorOrderItem(),
);

router.patch(
  "/orders/:id/status",
  requireAuth,
  requireApprovedVendor,
  updateVendorOrderItem(true),
);

router.get(
  "/sales",
  requireAuth,
  requireApprovedVendor,
  async (req, res) => {
    try {
      const orders = await loadVendorOrders(req.authUser!.id);
      const completedOrders = orders.filter((order) => order.status === "delivered");
      const revenue = completedOrders.reduce(
        (total, order) =>
          total +
          order.items.reduce(
            (sum: number, item: { price?: number; quantity?: number }) =>
              sum + Number(item.price ?? 0) * Number(item.quantity ?? 0),
            0,
          ),
        0,
      );
      const unitsSold = completedOrders.reduce(
        (total, order) =>
          total +
          order.items.reduce(
            (sum: number, item: { quantity?: number }) =>
              sum + Number(item.quantity ?? 0),
            0,
          ),
        0,
      );
      res.json({
        success: true,
        data: {
          totalOrders: orders.length,
          pendingOrders: orders.filter((order) =>
            ["pending", "confirmed", "preparing"].includes(String(order.status)),
          ).length,
          completedOrders: completedOrders.length,
          unitsSold,
          revenue,
        },
      });
    } catch (error) {
      console.error("Load vendor sales failed:", error);
      res.status(500).json({ success: false, message: "Could not load sales summary." });
    }
  },
);

router.get(
  "/store",
  requireAuth,
  requireVendor,
  async (req, res) => {
    try {
      const store = await mongoDB.collection("stores").findOne({
        ownerId: req.authUser!.id,
      });
      res.json({
        success: true,
        data: store ?? {
          storeName: `${req.authUser!.name}'s Pizza Shop`,
          description: "",
          phone: "",
          address: "",
        },
      });
    } catch (error) {
      console.error("Load vendor store failed:", error);
      res.status(500).json({ success: false, message: "Could not load store settings." });
    }
  },
);

router.put(
  "/store",
  requireAuth,
  requireVendor,
  async (req, res) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      const { storeName, description, phone, address } = body ?? {};
      if (
        typeof storeName !== "string" ||
        !storeName.trim() ||
        typeof description !== "string" ||
        typeof phone !== "string" ||
        typeof address !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Provide a store name, description, phone and address.",
        });
      }
      const now = new Date();
      const store = {
        ownerId: req.authUser!.id,
        storeName: storeName.trim(),
        description: description.trim(),
        phone: phone.trim(),
        address: address.trim(),
        updatedAt: now,
      };
      await mongoDB.collection("stores").updateOne(
        { ownerId: req.authUser!.id },
        { $set: store, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
      res.json({ success: true, data: store });
    } catch (error) {
      console.error("Save vendor store failed:", error);
      res.status(500).json({ success: false, message: "Could not save store settings." });
    }
  },
);

export default router;
