import { ObjectId, type ClientSession } from "mongodb";
import { mongoDB } from "../config/db.js";
import {
  getItemStatus,
  type OrderLine,
  type OrderRecord,
  type OrderStatus,
} from "./order-management.js";

export type NotificationScope = "customer" | "admin";

export type OrderNotification = {
  _id?: ObjectId;
  scope: NotificationScope;
  userId?: string;
  type: string;
  title: string;
  message: string;
  orderId?: string;
  issueId?: string;
  vendorId?: string;
  itemId?: string;
  status?: string;
  isRead: boolean;
  readAt?: Date;
  dedupeKey: string;
  createdAt: Date;
};

export async function ensureOrderNotificationIndexes(): Promise<void> {
  await mongoDB
    .collection<OrderNotification>("notifications")
    .createIndex({ dedupeKey: 1 }, { unique: true, sparse: true });
}

export async function recordOrderNotification(
  notification: OrderNotification,
  session?: ClientSession,
): Promise<void> {
  await mongoDB.collection<OrderNotification>("notifications").updateOne(
    { dedupeKey: notification.dedupeKey },
    { $setOnInsert: notification },
    { upsert: true, ...(session ? { session } : {}) },
  );
}

export function makeCustomerStatusNotification(input: {
  order: OrderRecord;
  item: OrderLine;
  itemId: string;
  vendorId: string | null;
  vendorName: string;
  status: OrderStatus;
  rejectionReason?: string;
}): OrderNotification | null {
  const { order, item, itemId, vendorId, vendorName, status, rejectionReason } = input;
  if (!order.userId) return null;

  const orderId = String(order._id);
  const itemName = String(item.name ?? "An item");
  const messages: Partial<Record<OrderStatus, { title: string; message: string }>> = {
    confirmed: {
      title: "Order item accepted",
      message: `${vendorName} accepted ${itemName} in order #${orderId.slice(-6)}.`,
    },
    rejected: {
      title: "Order item unavailable",
      message: `${vendorName} could not fulfill ${itemName} in order #${orderId.slice(-6)}. Reason: ${rejectionReason ?? "No reason provided."}`,
    },
    preparing: {
      title: "Order item is being prepared",
      message: `${vendorName} is preparing ${itemName} for order #${orderId.slice(-6)}.`,
    },
    out_for_delivery: {
      title: "Order item dispatched",
      message: `${itemName} from ${vendorName} is out for delivery for order #${orderId.slice(-6)}.`,
    },
    delivered: {
      title: "Order item delivered",
      message: `${itemName} from ${vendorName} was delivered for order #${orderId.slice(-6)}.`,
    },
    cancelled: {
      title: "Order item cancelled",
      message: `${itemName} from ${vendorName} was cancelled for order #${orderId.slice(-6)}.`,
    },
  };
  const content = messages[status];
  if (!content) return null;

  return {
    scope: "customer",
    userId: order.userId,
    type: "order_status",
    title: content.title,
    message: content.message,
    orderId,
    ...(vendorId ? { vendorId } : {}),
    itemId,
    status,
    isRead: false,
    dedupeKey: `order-status:${orderId}:${itemId}:${status}`,
    createdAt: new Date(),
  };
}

function getVendorResponseLimitMinutes(): number {
  const configuredMinutes = Number(process.env.VENDOR_ORDER_RESPONSE_MINUTES);
  return Number.isInteger(configuredMinutes) && configuredMinutes > 0
    ? configuredMinutes
    : 15;
}

let monitorRunning = false;

export async function scanOverdueVendorOrders(): Promise<void> {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    const responseLimitMinutes = getVendorResponseLimitMinutes();
    const cutoff = new Date(Date.now() - responseLimitMinutes * 60_000);
    const orders = await mongoDB
      .collection<OrderRecord>("orders")
      .find({
        createdAt: { $lte: cutoff },
        $or: [{ status: "pending" }, { "items.status": "pending" }],
      })
      .toArray();
    if (orders.length === 0) return;

    const unassignedProductIds = [
      ...new Set(
        orders.flatMap((order) =>
          (order.items ?? [])
            .filter((item) => item.vendorId == null)
            .map((item) => String(item.productId)),
        ),
      ),
    ];
    const products = unassignedProductIds
      .filter(ObjectId.isValid)
      .map((id) => new ObjectId(id));
    const productOwners = products.length
      ? await mongoDB
          .collection("products")
          .find({ _id: { $in: products } })
          .project({ _id: 1, vendorId: 1 })
          .toArray()
      : [];
    const ownerByProduct = new Map(
      productOwners
        .filter((product) => typeof product.vendorId === "string")
        .map((product) => [String(product._id), product.vendorId as string]),
    );

    const overdueGroups = orders.flatMap((order) => {
      const byVendor = new Map<string, number>();
      for (const item of order.items ?? []) {
        if (getItemStatus(item, order.status) !== "pending") continue;
        const vendorId =
          typeof item.vendorId === "string"
            ? item.vendorId
            : ownerByProduct.get(String(item.productId));
        if (vendorId) byVendor.set(vendorId, (byVendor.get(vendorId) ?? 0) + 1);
      }
      return [...byVendor].map(([vendorId, pendingItemCount]) => ({
        order,
        vendorId,
        pendingItemCount,
      }));
    });
    if (overdueGroups.length === 0) return;

    const vendorIds = [...new Set(overdueGroups.map((group) => group.vendorId))];
    const stores = await mongoDB
      .collection("stores")
      .find({ ownerId: { $in: vendorIds } })
      .project({ ownerId: 1, storeName: 1 })
      .toArray();
    const storeNames = new Map(
      stores.map((store) => [String(store.ownerId), String(store.storeName ?? "")]),
    );

    for (const { order, vendorId, pendingItemCount } of overdueGroups) {
      const orderId = String(order._id);
      const vendorName = storeNames.get(vendorId) || "A vendor";
      await recordOrderNotification({
        scope: "admin",
        type: "vendor_response_overdue",
        title: "Vendor response overdue",
        message: `${vendorName} has ${pendingItemCount} pending item${pendingItemCount === 1 ? "" : "s"} in order #${orderId.slice(-6)} after ${responseLimitMinutes} minutes.`,
        orderId,
        vendorId,
        status: "pending",
        isRead: false,
        dedupeKey: `vendor-response-overdue:${orderId}:${vendorId}`,
        createdAt: new Date(),
      });
    }
  } finally {
    monitorRunning = false;
  }
}

export async function startVendorResponseMonitor(): Promise<void> {
  await ensureOrderNotificationIndexes();
  const scan = () => {
    void scanOverdueVendorOrders().catch((error: unknown) => {
      console.error("Scan overdue vendor orders failed:", error);
    });
  };
  scan();
  const timer = setInterval(scan, 60_000);
  timer.unref();
}
