
import { Router } from "express";
import { ObjectId } from "mongodb";
import { mongoDB } from "../config/db.js";
import { requireAuth, allowRoles } from "../middleware/auth.js";

const router = Router();

// GET: View all products
router.get("/products", requireAuth, allowRoles("admin"), async (_req, res) => {
  try {
    const products = await mongoDB
      .collection("products")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: products });
  } catch {
    res.status(500).json({
      success: false,
      message: "Could not load products.",
    });
  }
});

// POST: Add a new product
router.post("/products", requireAuth, allowRoles("admin"), async (req, res) => {
  try {
    const { name, slug, description, category, price, image } =
      req.body as Record<string, unknown>;

    if (
      ![name, slug, description, category, image].every(
        (value) => typeof value === "string" && value.trim()
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

    const exists = await mongoDB
      .collection("products")
      .findOne({ slug: productSlug });

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
      rating: 4.8,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await mongoDB.collection("products").insertOne(product);

    res.status(201).json({
      success: true,
      data: { ...product, _id: result.insertedId },
    });
  } catch {
    res.status(500).json({
      success: false,
      message: "Could not create product.",
    });
  }
});

// PUT: Update a product
router.put(
  "/products/:id",
  requireAuth,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const id = String(req.params.id);

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID.",
        });
      }

      const {
        name,
        slug,
        description,
        category,
        price,
        image,
        isAvailable,
        isFeatured,
      } = req.body as Record<string, unknown>;

      if (
        (name !== undefined &&
          (typeof name !== "string" || !name.trim())) ||
        (slug !== undefined &&
          (typeof slug !== "string" || !slug.trim())) ||
        (description !== undefined &&
          (typeof description !== "string" || !description.trim())) ||
        (category !== undefined &&
          (typeof category !== "string" || !category.trim())) ||
        (image !== undefined &&
          (typeof image !== "string" || !image.trim())) ||
        (price !== undefined &&
          (typeof price !== "number" || !Number.isFinite(price) || price <= 0)) ||
        (isAvailable !== undefined && typeof isAvailable !== "boolean") ||
        (isFeatured !== undefined && typeof isFeatured !== "boolean")
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
      if (category !== undefined)
        updateData.category = (category as string).trim();
      if (price !== undefined) updateData.price = price;
      if (image !== undefined) updateData.image = (image as string).trim();
      if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
      if (isFeatured !== undefined) updateData.isFeatured = isFeatured;

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: "Provide at least one field to update.",
        });
      }

      if (typeof updateData.slug === "string") {
        const existingSlug = await mongoDB.collection("products").findOne({
          slug: updateData.slug,
          _id: { $ne: new ObjectId(id) },
        });

        if (existingSlug) {
          return res.status(409).json({
            success: false,
            message: "This product slug already exists.",
          });
        }
      }

      updateData.updatedAt = new Date();

      const result = await mongoDB.collection("products").updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Product not found.",
        });
      }

      res.json({
        success: true,
        message: "Product updated successfully.",
      });
    } catch {
      res.status(500).json({
        success: false,
        message: "Could not update product.",
      });
    }
  }
);

// DELETE: Delete a product
router.delete(
  "/products/:id",
  requireAuth,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const id = String(req.params.id);

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID.",
        });
      }

      const result = await mongoDB.collection("products").deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Product not found.",
        });
      }

      res.json({
        success: true,
        message: "Product deleted successfully.",
      });
    } catch {
      res.status(500).json({
        success: false,
        message: "Could not delete product.",
      });
    }
  }
);

// GET: View all users
router.get("/users", requireAuth, allowRoles("admin"), async (_req, res) => {
  try {
    const users = await mongoDB
      .collection("user")
      .find(
        {},
        {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            createdAt: 1,
          },
        }
      )
      .toArray();

    res.json({ success: true, data: users });
  } catch {
    res.status(500).json({
      success: false,
      message: "Could not load users.",
    });
  }
});

export default router;
