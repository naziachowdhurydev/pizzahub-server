import { ObjectId } from "mongodb";
import { mongoDB } from "../config/db.js";
import { activeOrderStatuses } from "./order-management.js";

type OrderedProduct = {
  _id?: ObjectId | string;
  name?: string;
  vendorId?: unknown;
  [key: string]: unknown;
};

export class OrderRuleError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
    readonly code: string = "ORDER_RULE_VIOLATION",
  ) {
    super(message);
    this.name = "OrderRuleError";
  }
}

export function isValidDeliveryDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateDeliveryDate(value: unknown): string {
  if (!isValidDeliveryDate(value)) {
    throw new OrderRuleError("Choose a valid delivery date.");
  }
  if (value < new Date().toISOString().slice(0, 10)) {
    throw new OrderRuleError("Delivery date cannot be in the past.");
  }
  return value;
}

export function validateNotes(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new OrderRuleError("Additional message must be text.");
  }
  const trimmed = value.trim();
  if (trimmed.length > 1000) {
    throw new OrderRuleError("Additional message must be 1000 characters or fewer.");
  }
  return trimmed;
}

export function assertNotOwnProduct(products: OrderedProduct[], userId: string): void {
  const ownProduct = products.find(
    (product) =>
      typeof product.vendorId === "string" && product.vendorId === userId,
  );
  if (ownProduct) {
    throw new OrderRuleError(
      `You cannot order ${String(ownProduct.name ?? "your own item")} from your own store.`,
      403,
      "OWN_ITEM_ORDER",
    );
  }
}

export function assertUniqueRequestedProducts(products: OrderedProduct[]): void {
  const ids = products.map((product) => String(product._id));
  if (new Set(ids).size !== ids.length) {
    throw new OrderRuleError("Order each menu item only once per request.");
  }
}

export async function assertNoActiveDuplicateOrder(input: {
  userId: string;
  deliveryDate: string;
  products: OrderedProduct[];
}): Promise<void> {
  const productIds = input.products
    .map((product) => String(product._id))
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (productIds.length === 0) return;

  const existing = await mongoDB.collection("orders").findOne({
    userId: input.userId,
    deliveryDate: input.deliveryDate,
    status: { $in: [...activeOrderStatuses] },
    "items.productId": { $in: productIds },
  });
  if (!existing) return;

  const orderedIds = new Set(
    (Array.isArray(existing.items) ? existing.items : []).map((item) =>
      String((item as { productId?: unknown }).productId),
    ),
  );
  const duplicateName = input.products.find((product) =>
    orderedIds.has(String(product._id)),
  );

  throw new OrderRuleError(
    `You already have an active order for ${String(duplicateName?.name ?? "this item")} on ${input.deliveryDate}.`,
    409,
    "DUPLICATE_ACTIVE_ORDER",
  );
}
