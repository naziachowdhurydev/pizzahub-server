import { Router } from "express";
import { ObjectId } from "mongodb";
import { mongoDB } from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

router.get(
  "/wishlist",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const wishlist = await mongoDB.collection("wishlists").findOne({
        userId: req.authUser!.id,
      });
      const productIds = Array.isArray(wishlist?.productIds)
        ? (wishlist.productIds as unknown[]).filter((id) =>
            ObjectId.isValid(String(id)),
          )
        : [];
      if (productIds.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const products = await mongoDB
        .collection("products")
        .find({ _id: { $in: productIds.map((id) => new ObjectId(String(id))) } })
        .toArray();
      const byId = new Map(products.map((product) => [String(product._id), product]));
      res.json({
        success: true,
        data: productIds.flatMap((id) => {
          const product = byId.get(String(id));
          return product ? [product] : [];
        }),
      });
    } catch (error) {
      console.error("Load wishlist failed:", error);
      res.status(500).json({ success: false, message: "Could not load wishlist." });
    }
  },
);

router.post(
  "/wishlist/:productId",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const productId = String(req.params.productId);
      if (!ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
      }
      const product = await mongoDB.collection("products").findOne({
        _id: new ObjectId(productId),
      });
      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
      }

      await mongoDB.collection("wishlists").updateOne(
        { userId: req.authUser!.id },
        {
          $addToSet: { productIds: new ObjectId(productId) },
          $set: { updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
      res.json({ success: true, message: "Pizza saved to your wishlist." });
    } catch (error) {
      console.error("Save wishlist item failed:", error);
      res.status(500).json({ success: false, message: "Could not save this pizza." });
    }
  },
);

router.delete(
  "/wishlist/:productId",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const productId = String(req.params.productId);
      if (!ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
      }
      await mongoDB.collection<{ userId: string; productIds: ObjectId[] }>("wishlists").updateOne(
        { userId: req.authUser!.id },
        {
          $pull: { productIds: new ObjectId(productId) },
          $set: { updatedAt: new Date() },
        },
      );
      res.json({ success: true, message: "Pizza removed from your wishlist." });
    } catch (error) {
      console.error("Remove wishlist item failed:", error);
      res.status(500).json({ success: false, message: "Could not update wishlist." });
    }
  },
);

router.get(
  "/address",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const profile = await mongoDB.collection("customer_profiles").findOne({
        userId: req.authUser!.id,
      });
      res.json({
        success: true,
        data: profile
          ? {
              fullName: profile.fullName,
              phone: profile.phone,
              street: profile.street,
              city: profile.city,
              postalCode: profile.postalCode,
            }
          : null,
      });
    } catch (error) {
      console.error("Load delivery address failed:", error);
      res.status(500).json({ success: false, message: "Could not load delivery information." });
    }
  },
);

router.put(
  "/address",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const { fullName, phone, street, city, postalCode } = req.body as Record<
        string,
        unknown
      >;
      if (
        ![fullName, phone, street, city, postalCode].every(
          (value) => typeof value === "string" && value.trim(),
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Name, phone, street, city and postal code are required.",
        });
      }

      const address = {
        userId: req.authUser!.id,
        fullName: (fullName as string).trim(),
        phone: (phone as string).trim(),
        street: (street as string).trim(),
        city: (city as string).trim(),
        postalCode: (postalCode as string).trim(),
        updatedAt: new Date(),
      };
      await mongoDB.collection("customer_profiles").updateOne(
        { userId: req.authUser!.id },
        { $set: address, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
      res.json({ success: true, data: address });
    } catch (error) {
      console.error("Save delivery address failed:", error);
      res.status(500).json({ success: false, message: "Could not save delivery information." });
    }
  },
);

router.get(
  "/vendor-application",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const application = await mongoDB.collection("vendor_applications").findOne({
        userId: req.authUser!.id,
      });
      res.json({ success: true, data: application });
    } catch (error) {
      console.error("Load vendor application failed:", error);
      res.status(500).json({ success: false, message: "Could not load vendor application." });
    }
  },
);

router.post(
  "/vendor-application",
  requireAuth,
  allowRoles("customer"),
  async (req, res) => {
    try {
      const { storeName, description } = req.body as {
        storeName?: unknown;
        description?: unknown;
      };
      if (
        typeof storeName !== "string" ||
        !storeName.trim() ||
        typeof description !== "string" ||
        !description.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Store name and a short description are required.",
        });
      }

      const now = new Date();
      await mongoDB.collection("vendor_applications").updateOne(
        { userId: req.authUser!.id },
        {
          $set: {
            storeName: storeName.trim(),
            description: description.trim(),
            status: "pending",
            updatedAt: now,
          },
          $setOnInsert: {
            userId: req.authUser!.id,
            applicantName: req.authUser!.name,
            applicantEmail: req.authUser!.email,
            createdAt: now,
          },
        },
        { upsert: true },
      );
      const application = await mongoDB.collection("vendor_applications").findOne({
        userId: req.authUser!.id,
      });
      res.status(201).json({ success: true, data: application });
    } catch (error) {
      console.error("Submit vendor application failed:", error);
      res.status(500).json({ success: false, message: "Could not submit vendor application." });
    }
  },
);

export default router;
