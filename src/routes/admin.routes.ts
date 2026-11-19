
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

      const updatedProduct = await mongoDB.collection("products").findOne({
        _id: new ObjectId(id),
      });
      if (!updatedProduct) {
        return res.status(404).json({
          success: false,
          message: "Product not found.",
        });
      }

      res.json({
        success: true,
        message: "Product updated successfully.",
        data: updatedProduct,
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
            id: 1,
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

router.patch(
  "/users/:id/role",
  requireAuth,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const { role } = req.body as { role?: unknown };
      if (!["customer", "vendor", "admin"].includes(String(role))) {
        return res.status(400).json({
          success: false,
          message: "Role must be customer, vendor or admin.",
        });
      }
      if (id === req.authUser!.id) {
        return res.status(400).json({
          success: false,
          message: "You cannot change your own role.",
        });
      }

      const userFilter = ObjectId.isValid(id)
        ? { $or: [{ _id: new ObjectId(id) }, { id }] }
        : { id };
      const result = await mongoDB.collection("user").updateOne(
        userFilter,
        { $set: { role, updatedAt: new Date() } },
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const user = await mongoDB.collection("user").findOne(userFilter, {
        projection: { name: 1, email: 1, image: 1, role: 1, createdAt: 1, id: 1 },
      });
      res.json({ success: true, data: user });
    } catch (error) {
      console.error("Update user role failed:", error);
      res.status(500).json({ success: false, message: "Could not update user role." });
    }
  },
);

router.get(
  "/vendors/applications",
  requireAuth,
  allowRoles("admin"),
  async (_req, res) => {
    try {
      const applications = await mongoDB
        .collection("vendor_applications")
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.json({ success: true, data: applications });
    } catch (error) {
      console.error("Load vendor applications failed:", error);
      res.status(500).json({
        success: false,
        message: "Could not load vendor applications.",
      });
    }
  },
);

router.patch(
  "/vendors/applications/:id",
  requireAuth,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const { status } = req.body as { status?: unknown };
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid application ID.",
        });
      }
      if (status !== "approved" && status !== "rejected") {
        return res.status(400).json({
          success: false,
          message: "Status must be approved or rejected.",
        });
      }

      const applications = mongoDB.collection("vendor_applications");
      const application = await applications.findOne({ _id: new ObjectId(id) });
      if (!application) {
        return res.status(404).json({
          success: false,
          message: "Vendor application not found.",
        });
      }

      if (status === "approved") {
        const userFilter = ObjectId.isValid(String(application.userId))
          ? {
              $or: [
                { _id: new ObjectId(String(application.userId)) },
                { id: String(application.userId) },
              ],
            }
          : { id: String(application.userId) };
        const userUpdate = await mongoDB.collection("user").updateOne(
          userFilter,
          { $set: { role: "vendor", updatedAt: new Date() } },
        );
        if (userUpdate.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "Applicant account not found.",
          });
        }
        await mongoDB.collection("stores").updateOne(
          { ownerId: String(application.userId) },
          {
            $setOnInsert: {
              ownerId: String(application.userId),
              storeName: String(application.storeName),
              description: String(application.description),
              phone: "",
              address: "",
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );
      }

      await applications.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status,
            reviewedBy: req.authUser!.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          },
        },
      );
      const updatedApplication = await applications.findOne({
        _id: new ObjectId(id),
      });
      res.json({ success: true, data: updatedApplication });
    } catch (error) {
      console.error("Review vendor application failed:", error);
      res.status(500).json({
        success: false,
        message: "Could not review vendor application.",
      });
    }
  },
);

router.get(
  "/analytics",
  requireAuth,
  allowRoles("admin"),
  async (_req, res) => {
    try {
      const [users, vendors, products, orders] = await Promise.all([
        mongoDB.collection("user").countDocuments(),
        mongoDB.collection("user").countDocuments({ role: "vendor" }),
        mongoDB.collection("products").countDocuments(),
        mongoDB
          .collection("orders")
          .find({})
          .project({ status: 1, total: 1, items: 1 })
          .toArray(),
      ]);

      const statusCounts: Record<string, number> = {};
      let completedRevenue = 0;
      for (const order of orders) {
        const status = String(order.status ?? "pending");
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        if (status === "delivered") {
          completedRevenue += Number(
            order.total ??
              (Array.isArray(order.items)
                ? order.items.reduce(
                    (sum: number, item: { price?: number; quantity?: number }) =>
                      sum + Number(item.price ?? 0) * Number(item.quantity ?? 0),
                    0,
                  )
                : 0),
          );
        }
      }
      res.json({
        success: true,
        data: {
          users,
          vendors,
          products,
          totalOrders: orders.length,
          completedRevenue,
          ordersByStatus: statusCounts,
        },
      });
    } catch (error) {
      console.error("Load platform analytics failed:", error);
      res.status(500).json({
        success: false,
        message: "Could not load platform analytics.",
      });
    }
  },
);

export default router;
