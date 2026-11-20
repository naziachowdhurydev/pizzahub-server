
import { Router } from "express";
import type { RequestHandler } from "express";
import { ObjectId, type Filter } from "mongodb";
import { mongoClient, mongoDB } from "../config/db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import {
  getAdminOrder,
  listAdminOrders,
  updateAdminOrderStatus,
} from "../controllers/admin-orders.js";

const router = Router();

router.get("/orders", requireAuth, requireAdmin, listAdminOrders);
router.get("/orders/:id", requireAuth, requireAdmin, getAdminOrder);
router.patch(
  "/orders/:id/status",
  requireAuth,
  requireAdmin,
  updateAdminOrderStatus,
);

type AuthUserDocument = {
  _id: string | ObjectId;
  id?: string;
  name?: string;
  email?: string;
  image?: string | null;
  role?: string;
  vendorStatus?: string | null;
  vendorAppliedAt?: Date;
  vendorApprovedAt?: Date;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

class AdminRouteError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function authUserFilter(id: string): Filter<AuthUserDocument> {
  const clauses: Filter<AuthUserDocument>[] = [{ _id: id }, { id }];
  if (ObjectId.isValid(id)) clauses.push({ _id: new ObjectId(id) });
  return { $or: clauses };
}

function reviewApplication(status: "approved" | "rejected"): RequestHandler {
  return async (req, res) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: "Invalid application ID." });
      return;
    }

    const session = mongoClient.startSession();
    let updatedApplication: Record<string, unknown> | null = null;
    try {
      await session.withTransaction(async () => {
        const applicationId = new ObjectId(id);
        const applications = mongoDB.collection("vendor_applications");
        const application = await applications.findOne(
          { _id: applicationId, status: "pending" },
          { session },
        );
        if (!application) {
          throw new AdminRouteError(404, "Pending vendor application not found.");
        }

        const applicantId = String(application.userId ?? "");
        const userFilter = authUserFilter(applicantId);
        const users = mongoDB.collection<AuthUserDocument>("user");
        const applicant = await users.findOne(userFilter, { session });
        if (!applicant) {
          throw new AdminRouteError(404, "Applicant account not found.");
        }
        if (status === "approved" && applicant.role !== "customer") {
          throw new AdminRouteError(409, "Applicant is no longer a customer.");
        }

        const now = new Date();
        const userUpdate =
          status === "approved"
            ? await users.updateOne(
                {
                  ...userFilter,
                  role: "customer",
                },
                {
                  $set: {
                    role: "vendor",
                    vendorStatus: "approved",
                    vendorApprovedAt: now,
                    updatedAt: now,
                  },
                },
                { session },
              )
            : await users.updateOne(
                userFilter,
                {
                  $set: {
                    vendorStatus: "rejected",
                    updatedAt: now,
                  },
                  $unset: { vendorApprovedAt: "" },
                },
                { session },
              );
        if (userUpdate.matchedCount === 0) {
          throw new AdminRouteError(409, "Applicant has no pending application.");
        }

        if (status === "approved") {
          await mongoDB.collection("stores").updateOne(
            { ownerId: applicantId },
            {
              $setOnInsert: {
                ownerId: applicantId,
                storeName: String(application.storeName),
                description: String(application.description),
                phone: "",
                address: "",
                createdAt: now,
              },
            },
            { upsert: true, session },
          );
        }

        const applicationUpdate = await applications.updateOne(
          { _id: applicationId, status: "pending" },
          {
            $set: {
              status,
              reviewedBy: req.authUser!.id,
              reviewedAt: now,
              updatedAt: now,
            },
          },
          { session },
        );
        if (applicationUpdate.matchedCount === 0) {
          throw new AdminRouteError(409, "Application was already reviewed.");
        }
        updatedApplication = await applications.findOne(
          { _id: applicationId },
          { session },
        );
      });

      res.json({ success: true, data: updatedApplication });
    } catch (error) {
      if (error instanceof AdminRouteError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error("Review vendor application failed:", error);
      res.status(500).json({
        success: false,
        message: "Could not review vendor application.",
      });
    } finally {
      await session.endSession();
    }
  };
}

async function resolveProductVendorId(value: unknown): Promise<string | null> {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminRouteError(400, "Vendor must be an approved vendor account.");
  }

  const vendorId = value.trim();
  const vendor = await mongoDB.collection<AuthUserDocument>("user").findOne({
    $and: [
      authUserFilter(vendorId),
      { role: "vendor", vendorStatus: "approved" },
      { $or: [{ status: "active" }, { status: { $exists: false } }] },
    ],
  });
  if (!vendor) {
    throw new AdminRouteError(400, "Vendor must be an approved vendor account.");
  }
  return String(vendor.id ?? vendor._id);
}

// GET: View all products
router.get("/products", requireAuth, requireAdmin, async (_req, res) => {
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

router.get("/vendors/approved", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const vendors = await mongoDB
      .collection<AuthUserDocument>("user")
      .find({
        role: "vendor",
        vendorStatus: "approved",
        $or: [{ status: "active" }, { status: { $exists: false } }],
      })
      .project({ _id: 1, id: 1, name: 1 })
      .sort({ name: 1 })
      .toArray();
    res.json({
      success: true,
      data: vendors.map((vendor) => ({
        id: String(vendor.id ?? vendor._id),
        name: String(vendor.name ?? ""),
      })),
    });
  } catch (error) {
    console.error("Load approved product vendors failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not load approved vendors.",
    });
  }
});

// POST: Add a new product
router.post("/products", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown> | null;
    const { name, slug, description, category, price, image, vendorId } =
      body ?? {};

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

    const productVendorId = await resolveProductVendorId(vendorId);
    const product = {
      name: (name as string).trim(),
      slug: productSlug,
      description: (description as string).trim(),
      category: (category as string).trim(),
      price,
      image: (image as string).trim(),
      sizes: ["Regular", "Large"],
      vendorId: productVendorId,
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
  } catch (error) {
    if (error instanceof AdminRouteError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error("Create admin product failed:", error);
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
  requireAdmin,
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
        vendorId,
      } = (req.body as Record<string, unknown> | null) ?? {};

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
      if (vendorId !== undefined) {
        updateData.vendorId = await resolveProductVendorId(vendorId);
      }

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
    } catch (error) {
      if (error instanceof AdminRouteError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      console.error("Update admin product failed:", error);
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
  requireAdmin,
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
router.get("/users", requireAuth, requireAdmin, async (_req, res) => {
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
            vendorStatus: 1,
            vendorAppliedAt: 1,
            vendorApprovedAt: 1,
            status: 1,
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

router.get("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await mongoDB.collection<AuthUserDocument>("user").findOne(
      authUserFilter(String(req.params.id)),
      {
        projection: {
          _id: 1,
          id: 1,
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          vendorStatus: 1,
          vendorAppliedAt: 1,
          vendorApprovedAt: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    return res.json({ success: true, data: user });
  } catch (error) {
    console.error("Load admin user failed:", error);
    return res.status(500).json({ success: false, message: "Could not load user." });
  }
});

router.get(
  "/users/:id/details",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const userFilter = authUserFilter(id);
      const user = await mongoDB.collection<AuthUserDocument>("user").findOne(userFilter, {
        projection: {
          _id: 1,
          id: 1,
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          vendorStatus: 1,
          vendorAppliedAt: 1,
          vendorApprovedAt: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      });
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const userId = String(user.id ?? user._id);
      const [sessions, linkedAccounts] = await Promise.all([
        mongoDB
          .collection("session")
          .find({ userId })
          .project({ createdAt: 1, updatedAt: 1, expiresAt: 1 })
          .sort({ createdAt: -1 })
          .toArray(),
        mongoDB
          .collection("account")
          .find({ userId })
          .project({ providerId: 1, createdAt: 1, updatedAt: 1 })
          .toArray(),
      ]);

      res.json({
        success: true,
        data: {
          user,
          sessions: sessions.map((session) => ({
            id: String(session.id ?? session._id),
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            expiresAt: session.expiresAt,
          })),
          linkedAccounts,
        },
      });
    } catch (error) {
      console.error("Load user details failed:", error);
      res.status(500).json({
        success: false,
        message: "Could not load user details.",
      });
    }
  },
);

router.patch(
  "/users/:id/role",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const role = (req.body as { role?: unknown } | null)?.role;
      if (
        typeof role !== "string" ||
        !["customer", "vendor", "admin"].includes(role)
      ) {
        return res.status(400).json({
          success: false,
          message: "Role must be customer, vendor or admin.",
        });
      }
      const userFilter = authUserFilter(id);
      const target = await mongoDB.collection<AuthUserDocument>("user").findOne(userFilter);
      if (!target) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      if (String(target.id ?? target._id) === req.authUser!.id) {
        return res.status(400).json({ success: false, message: "You cannot change your own role." });
      }
      if (role === "vendor" && target.vendorStatus !== "approved") {
        return res.status(409).json({
          success: false,
          message: "Only an approved vendor application can receive the vendor role.",
        });
      }

      const result = await mongoDB.collection<AuthUserDocument>("user").updateOne(
        userFilter,
        {
          $set: {
            role,
            ...(role === "customer" && target.role === "vendor"
              ? { vendorStatus: "not_applied" }
              : {}),
            updatedAt: new Date(),
          },
        },
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const user = await mongoDB.collection<AuthUserDocument>("user").findOne(userFilter, {
        projection: {
          _id: 1,
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          vendorStatus: 1,
          status: 1,
          createdAt: 1,
          id: 1,
        },
      });
      res.json({ success: true, data: user });
    } catch (error) {
      console.error("Update user role failed:", error);
      res.status(500).json({ success: false, message: "Could not update user role." });
    }
  },
);

router.patch(
  "/users/:id/status",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const status = (req.body as { status?: unknown } | null)?.status;
      if (status !== "active" && status !== "suspended") {
        return res.status(400).json({
          success: false,
          message: "Status must be active or suspended.",
        });
      }

      const userFilter = authUserFilter(id);
      const target = await mongoDB.collection<AuthUserDocument>("user").findOne(userFilter);
      if (!target) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      if (String(target.id ?? target._id) === req.authUser!.id) {
        return res.status(400).json({ success: false, message: "You cannot change your own account status." });
      }

      await mongoDB.collection<AuthUserDocument>("user").updateOne(
        userFilter,
        { $set: { status, updatedAt: new Date() } },
      );
      const user = await mongoDB.collection<AuthUserDocument>("user").findOne(
        userFilter,
        {
          projection: {
            _id: 1,
            id: 1,
            name: 1,
            email: 1,
            role: 1,
            vendorStatus: 1,
            status: 1,
          },
        },
      );
      return res.json({ success: true, data: user });
    } catch (error) {
      console.error("Update user status failed:", error);
      return res.status(500).json({ success: false, message: "Could not update user status." });
    }
  },
);

const listPendingApplications: RequestHandler = async (_req, res) => {
  try {
    const applications = await mongoDB
      .collection("vendor_applications")
      .find({ status: "pending" })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: applications });
  } catch (error) {
    console.error("Load pending vendor applications failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not load pending vendor applications.",
    });
  }
};

router.get("/vendors/pending", requireAuth, requireAdmin, listPendingApplications);

router.get(
  "/vendors/applications",
  requireAuth,
  requireAdmin,
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
  "/vendors/:id/approve",
  requireAuth,
  requireAdmin,
  reviewApplication("approved"),
);
router.patch(
  "/vendors/:id/reject",
  requireAuth,
  requireAdmin,
  reviewApplication("rejected"),
);

const reviewLegacyApplication: RequestHandler = (req, res, next) => {
  const status = (req.body as { status?: unknown } | null)?.status;
  if (status !== "approved" && status !== "rejected") {
    res.status(400).json({
      success: false,
      message: "Status must be approved or rejected.",
    });
    return;
  }
  return reviewApplication(status)(req, res, next);
};

router.patch(
  "/vendors/applications/:id",
  requireAuth,
  requireAdmin,
  reviewLegacyApplication,
);

router.get(
  "/analytics",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const [users, customers, vendors, pendingVendors, products, orders] = await Promise.all([
        mongoDB.collection("user").countDocuments(),
        mongoDB.collection("user").countDocuments({ role: "customer" }),
        mongoDB.collection("user").countDocuments({ role: "vendor" }),
        mongoDB.collection("vendor_applications").countDocuments({ status: "pending" }),
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
          customers,
          vendors,
          pendingVendors,
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
