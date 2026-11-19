import { Router } from "express";
import { ObjectId } from "mongodb";
import { mongoDB } from "../config/db.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

type VendorOrderItem = {
  productId: ObjectId | string;
  price?: number;
  quantity?: number;
};

type VendorOrderDocument = {
  _id: ObjectId;
  status?: string;
  createdAt?: Date;
  items?: VendorOrderItem[];
  [key: string]: unknown;
};

type VendorOrderWithItems = Omit<VendorOrderDocument, "items"> & {
  items: VendorOrderItem[];
};

async function loadVendorOrders(vendorId: string): Promise<VendorOrderWithItems[]> {
  const products = await mongoDB
    .collection("products")
    .find({ vendorId })
    .project({ _id: 1 })
    .toArray();
  const productIds = products.map((product) => product._id);
  if (productIds.length === 0) return [];

  const productIdSet = new Set(productIds.map(String));
  const orders = await mongoDB
    .collection<VendorOrderDocument>("orders")
    .find({ "items.productId": { $in: productIds } })
    .sort({ createdAt: -1 })
    .toArray();

  return orders.flatMap((order) => {
    const items = Array.isArray(order.items)
      ? order.items.filter((item) => productIdSet.has(String(item.productId)))
      : [];
    return items.length > 0 ? [{ ...order, items }] : [];
  });
}

router.get(
  "/products",
  requireAuth,
  allowRoles("vendor"),
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
  allowRoles("vendor"),
  async (req, res) => {
    try {
      const { name, slug, description, category, price, image } =
        req.body as Record<string, unknown>;
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
  allowRoles("vendor"),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid product ID." });
      }

      const { name, slug, description, category, price, image, isAvailable } =
        req.body as Record<string, unknown>;
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
  allowRoles("vendor"),
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
  allowRoles("vendor"),
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
  "/sales",
  requireAuth,
  allowRoles("vendor"),
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
  allowRoles("vendor"),
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
  allowRoles("vendor"),
  async (req, res) => {
    try {
      const { storeName, description, phone, address } = req.body as Record<
        string,
        unknown
      >;
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
