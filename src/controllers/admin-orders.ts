import type { RequestHandler } from "express";
import { ObjectId, type ClientSession } from "mongodb";
import { mongoClient, mongoDB } from "../config/db.js";
import {
  adminStatusTransitions,
  getItemStatus,
  getOrderStatus,
  isOrderStatus,
  normalizeOrder,
  type OrderRecord,
} from "../lib/order-management.js";
import {
  makeCustomerStatusNotification,
  recordOrderNotification,
} from "../lib/order-notifications.js";

class AdminOrderError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

async function addVendorNames(
  orders: OrderRecord[],
  session?: ClientSession,
): Promise<OrderRecord[]> {
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
        .find({ _id: { $in: unresolvedProductIds } }, session ? { session } : {})
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
          .filter((id): id is string => typeof id === "string"),
      ),
    ),
  ];
  if (vendorIds.length === 0) return orders.map(normalizeOrder);

  const stores = await mongoDB
    .collection("stores")
    .find({ ownerId: { $in: vendorIds } }, session ? { session } : {})
    .project({ ownerId: 1, storeName: 1 })
    .toArray();
  const storeNames = new Map(
    stores.map((store) => [String(store.ownerId), String(store.storeName ?? "")]),
  );
  return orders.map((order) => {
    const normalized = normalizeOrder(order);
    return {
      ...normalized,
      items: (normalized.items ?? []).map((item) => {
        const vendorId =
          (typeof item.vendorId === "string" ? item.vendorId : undefined) ??
          ownerByProduct.get(String(item.productId)) ??
          null;
        return {
          ...item,
          vendorId,
          vendorName: vendorId ? storeNames.get(vendorId) || vendorId : null,
        };
      }),
    };
  });
}

export const listAdminOrders: RequestHandler = async (req, res) => {
  const status = req.query.status;
  const vendorId = req.query.vendorId;
  const customerId = req.query.customerId;
  const search = req.query.search;
  const from = req.query.from;
  const to = req.query.to;

  if (status !== undefined && !isOrderStatus(status)) {
    res.status(400).json({ success: false, message: "Invalid order status filter." });
    return;
  }
  if (
    (vendorId !== undefined && (typeof vendorId !== "string" || !vendorId.trim())) ||
    (customerId !== undefined && (typeof customerId !== "string" || !customerId.trim())) ||
    (search !== undefined && (typeof search !== "string" || search.length > 100))
  ) {
    res.status(400).json({ success: false, message: "Invalid order filter." });
    return;
  }

  const fromDate = from === undefined ? undefined : new Date(String(from));
  const toDate = to === undefined
    ? undefined
    : /^\d{4}-\d{2}-\d{2}$/.test(String(to))
      ? new Date(`${String(to)}T23:59:59.999`)
      : new Date(String(to));
  if (
    (fromDate && Number.isNaN(fromDate.getTime())) ||
    (toDate && Number.isNaN(toDate.getTime()))
  ) {
    res.status(400).json({ success: false, message: "Invalid date filter." });
    return;
  }

  try {
    const orders = await mongoDB
      .collection<OrderRecord>("orders")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    const normalized = await addVendorNames(orders);
    const filtered = normalized.filter((order) => {
      if (typeof vendorId === "string" &&
        !order.items?.some((item) => item.vendorId === vendorId)) return false;
      if (typeof customerId === "string" && order.userId !== customerId) return false;
      if (isOrderStatus(status) &&
        order.status !== status &&
        !order.items?.some((item) => item.status === status)) return false;
      if (fromDate && (!order.createdAt || order.createdAt < fromDate)) return false;
      if (toDate && (!order.createdAt || order.createdAt > toDate)) return false;
      if (typeof search === "string" && search.trim()) {
        const needle = search.trim().toLowerCase();
        const matchesText = [order.customerName, order.customerEmail, order.userId]
          .some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
        if (!matchesText && !String(order._id).includes(needle)) return false;
      }
      return true;
    });

    res.json({ success: true, data: filtered });
  } catch (error) {
    console.error("Load admin orders failed:", error);
    res.status(500).json({ success: false, message: "Could not load orders." });
  }
};

export const getAdminOrder: RequestHandler = async (req, res) => {
  const id = String(req.params.id);
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: "Invalid order ID." });
    return;
  }

  try {
    const order = await mongoDB
      .collection<OrderRecord>("orders")
      .findOne({ _id: new ObjectId(id) });
    if (!order) {
      res.status(404).json({ success: false, message: "Order not found." });
      return;
    }
    const [orderWithVendorName] = await addVendorNames([order]);
    res.json({ success: true, data: orderWithVendorName });
  } catch (error) {
    console.error("Load admin order failed:", error);
    res.status(500).json({ success: false, message: "Could not load order." });
  }
};

export const updateAdminOrderStatus: RequestHandler = async (req, res) => {
  const id = String(req.params.id);
  const body = req.body as {
    status?: unknown;
    rejectionReason?: unknown;
  } | null;
  const { status, rejectionReason } = body ?? {};
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: "Invalid order ID." });
    return;
  }
  if (!isOrderStatus(status)) {
    res.status(400).json({ success: false, message: "Invalid order status." });
    return;
  }
  if (
    rejectionReason !== undefined &&
    (typeof rejectionReason !== "string" ||
      rejectionReason.trim().length < 5 ||
      rejectionReason.trim().length > 500)
  ) {
    res.status(400).json({ success: false, message: "Invalid rejection reason." });
    return;
  }

  const session = mongoClient.startSession();
  try {
    const orderId = new ObjectId(id);
    const orders = mongoDB.collection<OrderRecord>("orders");
    let updatedWithVendorNames: OrderRecord | null = null;
    await session.withTransaction(async () => {
      const order = await orders.findOne({ _id: orderId }, { session });
      if (!order) throw new AdminOrderError(404, "Order not found.");

      const currentStatuses = (order.items ?? []).map((item) =>
        getItemStatus(item, order.status),
      );
      if (currentStatuses.length === 0) currentStatuses.push(getOrderStatus(order));
      const invalidTransition = currentStatuses.find(
        (current) =>
          current !== status && !adminStatusTransitions[current].includes(status),
      );
      if (invalidTransition) {
        throw new AdminOrderError(
          400,
          `Cannot change an order item from ${invalidTransition} to ${status}.`,
        );
      }

      const update: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (order.items?.length) {
        update["items.$[].status"] = status;
        if (status === "rejected") {
          update["items.$[].rejectionReason"] =
            typeof rejectionReason === "string"
              ? rejectionReason.trim()
              : "Rejected by an administrator.";
        }
      }
      const filter: Record<string, unknown> = { _id: orderId };
      filter.items =
        order.items === undefined ? { $exists: false } : order.items;
      const result = await orders.updateOne(
        filter,
        { $set: update },
        { session },
      );
      if (result.matchedCount === 0) {
        throw new AdminOrderError(409, "The order changed. Refresh and retry.");
      }

      const updated = await orders.findOne({ _id: orderId }, { session });
      if (!updated) throw new AdminOrderError(404, "Order not found.");
      const [enrichedOrder] = await addVendorNames([updated], session);
      for (const [index, item] of (enrichedOrder.items ?? []).entries()) {
        if (currentStatuses[index] === status) continue;
        const notification = makeCustomerStatusNotification({
          order: updated,
          item,
          itemId: String(item.itemId ?? item._id ?? `legacy_${index}`),
          vendorId: item.vendorId ?? null,
          vendorName: String(
            item.vendorName ?? (item.vendorId ? "Your vendor" : "PizzaHub"),
          ),
          status,
          ...(status === "rejected" && typeof item.rejectionReason === "string"
            ? { rejectionReason: item.rejectionReason }
            : {}),
        });
        if (notification) await recordOrderNotification(notification, session);
      }
      updatedWithVendorNames = enrichedOrder;
    });
    res.json({ success: true, data: updatedWithVendorNames });
  } catch (error) {
    if (error instanceof AdminOrderError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
      return;
    }
    console.error("Update admin order status failed:", error);
    res.status(500).json({ success: false, message: "Could not update order status." });
  } finally {
    await session.endSession();
  }
};
