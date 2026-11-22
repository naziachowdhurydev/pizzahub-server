import { ObjectId } from "mongodb";
import { mongoDB } from "../config/db.js";
import { userFilterById, type UserDocument } from "./users.js";

export type VendorPlan = "free" | "premium";

export const FREE_ACTIVE_ITEM_LIMIT = 3;

export function normalizeVendorPlan(value: unknown): VendorPlan {
  return value === "premium" ? "premium" : "free";
}

export function activeItemLimitForPlan(plan: VendorPlan): number | null {
  return plan === "premium" ? null : FREE_ACTIVE_ITEM_LIMIT;
}

export type ActiveItemCapacity = {
  plan: VendorPlan;
  activeItems: number;
  maxActiveItems: number | null;
  unlimited: boolean;
  allowed: boolean;
};

export class VendorPlanLimitError extends Error {
  readonly statusCode = 409;
  readonly code = "PLAN_LIMIT_REACHED";

  constructor(readonly capacity: ActiveItemCapacity) {
    super(capacity.maxActiveItems === null
      ? "This plan has no active item limit."
      : `Your Free plan allows ${capacity.maxActiveItems} active menu items. You currently have ${capacity.activeItems}. Upgrade to Premium for unlimited active items.`);
    this.name = "VendorPlanLimitError";
  }
}

export async function getVendorPlan(userId: string): Promise<VendorPlan> {
  const user = await mongoDB
    .collection<UserDocument>("user")
    .findOne(userFilterById(userId), { projection: { plan: 1 } });
  return normalizeVendorPlan(user?.plan);
}

export async function checkActiveItemCapacity(input: {
  vendorId: string;
  plan: VendorPlan;
  excludeProductId?: string;
}): Promise<ActiveItemCapacity> {
  const filter: Record<string, unknown> = {
    vendorId: input.vendorId,
    isAvailable: true,
  };
  if (
    input.excludeProductId &&
    ObjectId.isValid(input.excludeProductId)
  ) {
    filter._id = { $ne: new ObjectId(input.excludeProductId) };
  }

  const activeItems = await mongoDB
    .collection("products")
    .countDocuments(filter);
  const maxActiveItems = activeItemLimitForPlan(input.plan);

  return {
    plan: input.plan,
    activeItems,
    maxActiveItems,
    unlimited: maxActiveItems === null,
    allowed: maxActiveItems === null || activeItems < maxActiveItems,
  };
}

export function assertActiveItemCapacity(capacity: ActiveItemCapacity): void {
  if (!capacity.allowed) {
    throw new VendorPlanLimitError(capacity);
  }
}
