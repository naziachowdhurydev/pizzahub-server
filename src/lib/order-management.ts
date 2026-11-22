import { ObjectId } from "mongodb";

export const orderStatuses = [
  "pending",
  "accepted",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "rejected",
] as const;

// `confirmed` is kept for legacy orders; new approvals use `accepted`.
export const activeOrderStatuses = [
  "pending",
  "accepted",
  "confirmed",
  "preparing",
  "out_for_delivery",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export type OrderLine = {
  itemId?: ObjectId | string;
  productId: ObjectId | string;
  vendorId?: string | null;
  name?: string;
  image?: string;
  size?: string;
  price?: number;
  quantity?: number;
  subtotal?: number;
  status?: string;
  [key: string]: unknown;
};

export type OrderRecord = {
  _id: ObjectId;
  userId?: string;
  customerName?: string;
  customerEmail?: string;
  deliveryDate?: string;
  deliveryAddress?: string;
  phone?: string;
  notes?: string;
  subtotal?: number;
  deliveryFee?: number;
  total?: number;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
  items?: OrderLine[];
  [key: string]: unknown;
};

export const adminStatusTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["accepted", "rejected", "cancelled"],
  accepted: ["preparing", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
  rejected: [],
};

export const vendorStatusTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["accepted", "rejected"],
  accepted: ["preparing", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
  rejected: [],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && orderStatuses.includes(value as OrderStatus);
}

export function normalizeOrderStatus(value: unknown): OrderStatus {
  return isOrderStatus(value) ? value : "pending";
}

export function getItemStatus(item: OrderLine, orderStatus?: string): OrderStatus {
  return normalizeOrderStatus(item.status ?? orderStatus);
}

export function getOrderStatus(order: OrderRecord): OrderStatus {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return normalizeOrderStatus(order.status);

  const statuses = items.map((item) => getItemStatus(item, order.status));
  if (statuses.every((status) => status === statuses[0])) return statuses[0];

  const activePriority: OrderStatus[] = [
    "pending",
    "accepted",
    "confirmed",
    "preparing",
    "out_for_delivery",
  ];
  const activeStatus = activePriority.find((status) => statuses.includes(status));
  if (activeStatus) return activeStatus;
  if (statuses.every((status) => status === "delivered")) return "delivered";
  if (statuses.every((status) => status === "rejected")) return "rejected";
  if (statuses.every((status) => status === "cancelled")) return "cancelled";
  if (statuses.includes("delivered")) return "delivered";
  if (statuses.includes("rejected")) return "rejected";
  return "cancelled";
}

export function normalizeOrder(order: OrderRecord): OrderRecord {
  return {
    ...order,
    status: getOrderStatus(order),
    items: (Array.isArray(order.items) ? order.items : []).map((item, index) => ({
      ...item,
      itemId: String(item.itemId ?? item._id ?? `legacy_${index}`),
      productId: String(item.productId),
      vendorId: typeof item.vendorId === "string" ? item.vendorId : null,
      status: getItemStatus(item, order.status),
    })),
  };
}
