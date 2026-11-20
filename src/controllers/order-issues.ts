import type { RequestHandler } from "express";
import { ObjectId } from "mongodb";
import { mongoClient, mongoDB } from "../config/db.js";
import { adminStatusTransitions, getItemStatus, type OrderRecord } from "../lib/order-management.js";
import { recordOrderNotification, type OrderNotification } from "../lib/order-notifications.js";

type OrderIssueType = "complaint" | "cancellation" | "refund";
type OrderIssueStatus = "open" | "in_review" | "resolved" | "rejected";

type OrderIssue = {
  _id: ObjectId;
  orderId: ObjectId;
  customerId: string;
  customerName: string;
  type: OrderIssueType;
  message: string;
  itemId?: string;
  orderTotal: number;
  status: OrderIssueStatus;
  adminNote?: string;
  createdAt: Date;
  updatedAt: Date;
  reviewedBy?: string;
  resolvedAt?: Date;
};

class OrderIssueError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const issueTypes: readonly OrderIssueType[] = ["complaint", "cancellation", "refund"];
const issueStatuses: readonly OrderIssueStatus[] = ["open", "in_review", "resolved", "rejected"];

export const createCustomerOrderIssue: RequestHandler = async (req, res) => {
  const orderId = String(req.params.id);
  const body = req.body as {
    type?: unknown;
    message?: unknown;
    itemId?: unknown;
  } | null;
  const { type, message, itemId } = body ?? {};
  if (!ObjectId.isValid(orderId)) {
    res.status(400).json({ success: false, message: "Invalid order ID." });
    return;
  }
  if (
    typeof type !== "string" ||
    !issueTypes.includes(type as OrderIssueType) ||
    typeof message !== "string" ||
    message.trim().length < 10 ||
    message.trim().length > 2000 ||
    (itemId !== undefined && (typeof itemId !== "string" || !itemId.trim()))
  ) {
    res.status(400).json({
      success: false,
      message: "Provide a request type and a message between 10 and 2000 characters.",
    });
    return;
  }

  const session = mongoClient.startSession();
  let createdIssue: OrderIssue | null = null;
  try {
    await session.withTransaction(async () => {
      const order = await mongoDB.collection<OrderRecord>("orders").findOne(
        { _id: new ObjectId(orderId), userId: req.authUser!.id },
        { session },
      );
      if (!order) throw new OrderIssueError(404, "Order not found.");
      if (typeof itemId === "string") {
        const foundItem = (order.items ?? []).some(
          (item, index) =>
            String(item.itemId ?? item._id ?? `legacy_${index}`) === itemId,
        );
        if (!foundItem) throw new OrderIssueError(404, "Order item not found.");
      }

      const now = new Date();
      const issue: Omit<OrderIssue, "_id"> = {
        orderId: order._id,
        customerId: req.authUser!.id,
        customerName: req.authUser!.name,
        type: type as OrderIssueType,
        message: message.trim(),
        ...(typeof itemId === "string" ? { itemId } : {}),
        orderTotal: Number(order.total ?? 0),
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      const result = await mongoDB
        .collection<Omit<OrderIssue, "_id">>("order_issues")
        .insertOne(issue, { session });
      createdIssue = { ...issue, _id: result.insertedId };
      await recordOrderNotification(
        {
          scope: "admin",
          type: "order_issue_opened",
          title: `New ${issue.type} request`,
          message: `${issue.customerName} submitted a ${issue.type} request for order #${orderId.slice(-6)}.`,
          orderId,
          issueId: String(result.insertedId),
          isRead: false,
          dedupeKey: `order-issue-opened:${result.insertedId}`,
          createdAt: now,
        },
        session,
      );
    });
    res.status(201).json({ success: true, data: createdIssue });
  } catch (error) {
    if (error instanceof OrderIssueError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
      return;
    }
    console.error("Create customer order issue failed:", error);
    res.status(500).json({ success: false, message: "Could not submit your request." });
  } finally {
    await session.endSession();
  }
};

export const listCustomerOrderIssues: RequestHandler = async (req, res) => {
  try {
    const issues = await mongoDB
      .collection<OrderIssue>("order_issues")
      .find({ customerId: req.authUser!.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    res.json({ success: true, data: issues });
  } catch (error) {
    console.error("Load customer order issues failed:", error);
    res.status(500).json({ success: false, message: "Could not load your requests." });
  }
};

export const listAdminOrderIssues: RequestHandler = async (req, res) => {
  const status = req.query.status;
  if (
    status !== undefined &&
    (typeof status !== "string" || !issueStatuses.includes(status as OrderIssueStatus))
  ) {
    res.status(400).json({ success: false, message: "Invalid request status filter." });
    return;
  }
  const statusFilter =
    typeof status === "string" ? (status as OrderIssueStatus) : undefined;
  try {
    const issues = await mongoDB
      .collection<OrderIssue>("order_issues")
      .find(statusFilter ? { status: statusFilter } : {})
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    res.json({ success: true, data: issues });
  } catch (error) {
    console.error("Load admin order issues failed:", error);
    res.status(500).json({ success: false, message: "Could not load order requests." });
  }
};

export const updateAdminOrderIssue: RequestHandler = async (req, res) => {
  const id = String(req.params.id);
  const body = req.body as {
    status?: unknown;
    adminNote?: unknown;
    orderAction?: unknown;
  } | null;
  const { status, adminNote, orderAction } = body ?? {};
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: "Invalid request ID." });
    return;
  }
  if (
    typeof status !== "string" ||
    !issueStatuses.includes(status as OrderIssueStatus) ||
    (adminNote !== undefined &&
      (typeof adminNote !== "string" || adminNote.trim().length > 1000)) ||
    (orderAction !== undefined && orderAction !== "cancel")
  ) {
    res.status(400).json({ success: false, message: "Invalid request update." });
    return;
  }
  if (orderAction === "cancel" && status !== "resolved") {
    res.status(400).json({
      success: false,
      message: "Resolve the request to apply the cancellation.",
    });
    return;
  }

  const session = mongoClient.startSession();
  let updatedIssue: OrderIssue | null = null;
  try {
    await session.withTransaction(async () => {
      const issues = mongoDB.collection<OrderIssue>("order_issues");
      const issue = await issues.findOne({ _id: new ObjectId(id) }, { session });
      if (!issue) throw new OrderIssueError(404, "Order request not found.");
      if (orderAction === "cancel" && issue.type !== "cancellation") {
        throw new OrderIssueError(400, "Only cancellation requests can cancel an order.");
      }

      if (orderAction === "cancel") {
        const orders = mongoDB.collection<OrderRecord>("orders");
        const order = await orders.findOne({ _id: issue.orderId }, { session });
        if (!order) throw new OrderIssueError(404, "Order not found.");
        const items = order.items ?? [];
        const cannotCancel = items.some((item) => {
          const current = getItemStatus(item, order.status);
          return current !== "cancelled" && !adminStatusTransitions[current].includes("cancelled");
        });
        if (cannotCancel) {
          throw new OrderIssueError(
            409,
            "The order has items that can no longer be cancelled.",
          );
        }

        const now = new Date();
        const update: Record<string, unknown> = {
          status: "cancelled",
          updatedAt: now,
        };
        if (items.length) update["items.$[].status"] = "cancelled";
        const result = await orders.updateOne(
          { _id: order._id, ...(order.updatedAt ? { updatedAt: order.updatedAt } : {}) },
          { $set: update },
          { session },
        );
        if (result.matchedCount === 0) {
          throw new OrderIssueError(409, "The order changed. Refresh and retry.");
        }
        if (order.userId) {
          await recordOrderNotification(
            {
              scope: "customer",
              userId: order.userId,
              type: "order_cancelled",
              title: "Order cancelled",
              message: `Order #${String(order._id).slice(-6)} was cancelled by an administrator.`,
              orderId: String(order._id),
              status: "cancelled",
              isRead: false,
              dedupeKey: `admin-order-cancel:${order._id}:${now.getTime()}`,
              createdAt: now,
            },
            session,
          );
        }
      }

      const now = new Date();
      const updateIssue: Record<string, unknown> = {
        status,
        updatedAt: now,
        reviewedBy: req.authUser!.id,
        ...(status === "resolved" || status === "rejected" ? { resolvedAt: now } : {}),
      };
      if (typeof adminNote === "string") updateIssue.adminNote = adminNote.trim();
      const result = await issues.updateOne(
        { _id: issue._id, ...(issue.updatedAt ? { updatedAt: issue.updatedAt } : {}) },
        { $set: updateIssue },
        { session },
      );
      if (result.matchedCount === 0) {
        throw new OrderIssueError(409, "The request changed. Refresh and retry.");
      }

      await recordOrderNotification(
        {
          scope: "customer",
          userId: issue.customerId,
          type: "order_issue_update",
          title: "Your order request was updated",
          message: `Your ${issue.type} request for order #${String(issue.orderId).slice(-6)} is now ${status.replaceAll("_", " ")}.${typeof adminNote === "string" && adminNote.trim() ? ` Admin note: ${adminNote.trim()}` : ""}`,
          orderId: String(issue.orderId),
          issueId: id,
          status,
          isRead: false,
          dedupeKey: `order-issue-update:${id}:${now.getTime()}`,
          createdAt: now,
        },
        session,
      );
      updatedIssue = await issues.findOne({ _id: issue._id }, { session });
    });
    res.json({ success: true, data: updatedIssue });
  } catch (error) {
    if (error instanceof OrderIssueError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
      return;
    }
    console.error("Update admin order issue failed:", error);
    res.status(500).json({ success: false, message: "Could not update order request." });
  } finally {
    await session.endSession();
  }
};
