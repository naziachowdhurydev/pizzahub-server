import type { RequestHandler } from "express";
import { mongoClient, mongoDB } from "../config/db.js";
import { userFilterById, type UserDocument } from "../lib/users.js";

type ApplyBody = {
  storeName?: unknown;
  description?: unknown;
};

export const applyVendorApplication: RequestHandler = async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ success: false, message: "Authentication required." });
    return;
  }

  const body = req.body as ApplyBody | null;
  const storeName = typeof body?.storeName === "string" ? body.storeName.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  if (!storeName || storeName.length > 100 || !description || description.length > 1000) {
    res.status(400).json({
      success: false,
      message: "Provide a store name (max 100 characters) and description (max 1000 characters).",
    });
    return;
  }

  const now = new Date();
  const session = mongoClient.startSession();
  try {
    await session.withTransaction(async () => {
      const users = mongoDB.collection<UserDocument>("user");
      const userUpdate = await users.updateOne(
        {
          ...userFilterById(authUser.id),
          role: "customer",
          vendorStatus: { $ne: "pending" },
        },
        {
          $set: {
            vendorStatus: "pending",
            vendorAppliedAt: now,
            updatedAt: now,
          },
        },
        { session },
      );
      if (userUpdate.matchedCount === 0) {
        throw new Error("APPLICATION_NOT_ALLOWED");
      }

      await mongoDB.collection("vendor_applications").updateOne(
        { userId: authUser.id },
        {
          $set: {
            storeName,
            description,
            status: "pending",
            updatedAt: now,
          },
          $setOnInsert: {
            userId: authUser.id,
            applicantName: authUser.name,
            applicantEmail: authUser.email,
            createdAt: now,
          },
        },
        { upsert: true, session },
      );
    });

    const application = await mongoDB
      .collection("vendor_applications")
      .findOne({ userId: authUser.id });
    res.status(201).json({ success: true, data: application });
  } catch (error) {
    if (error instanceof Error && error.message === "APPLICATION_NOT_ALLOWED") {
      res.status(409).json({
        success: false,
        message: "You already have a pending application or are not eligible to apply.",
      });
      return;
    }
    console.error("Submit vendor application failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not submit the vendor application.",
    });
  } finally {
    await session.endSession();
  }
};
