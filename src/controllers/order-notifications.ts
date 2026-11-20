import type { RequestHandler } from "express";
import { ObjectId } from "mongodb";
import { mongoDB } from "../config/db.js";
import {
  scanOverdueVendorOrders,
  type NotificationScope,
  type OrderNotification,
} from "../lib/order-notifications.js";

export function listOrderNotifications(scope: NotificationScope): RequestHandler {
  return async (req, res) => {
    try {
      if (scope === "admin") await scanOverdueVendorOrders();
      const filter =
        scope === "customer"
          ? { scope, userId: req.authUser!.id }
          : { scope };
      const notifications = await mongoDB
        .collection<OrderNotification>("notifications")
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      res.json({ success: true, data: notifications });
    } catch (error) {
      console.error(`Load ${scope} notifications failed:`, error);
      res.status(500).json({
        success: false,
        message: "Could not load notifications.",
      });
    }
  };
}

export function markOrderNotificationRead(
  scope: NotificationScope,
): RequestHandler {
  return async (req, res) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: "Invalid notification ID." });
      return;
    }
    try {
      const filter =
        scope === "customer"
          ? {
              _id: new ObjectId(id),
              scope,
              userId: req.authUser!.id,
            }
          : { _id: new ObjectId(id), scope };
      const result = await mongoDB.collection<OrderNotification>("notifications").updateOne(
        filter,
        { $set: { isRead: true, readAt: new Date() } },
      );
      if (result.matchedCount === 0) {
        res.status(404).json({ success: false, message: "Notification not found." });
        return;
      }
      res.json({ success: true, data: { id, isRead: true } });
    } catch (error) {
      console.error(`Mark ${scope} notification read failed:`, error);
      res.status(500).json({
        success: false,
        message: "Could not update notification.",
      });
    }
  };
}
