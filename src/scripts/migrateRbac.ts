import "dotenv/config";
import { connectDatabase, mongoDB, mongoClient } from "../config/db.js";
import { userFilterById, type UserDocument } from "../lib/users.js";

async function migrate() {
  try {
    await connectDatabase();
    const users = mongoDB.collection<UserDocument>("user");
    const now = new Date();

    await users.updateMany(
      { $or: [{ role: { $exists: false } }, { role: null }] },
      { $set: { role: "customer" } },
    );
    await users.updateMany(
      { $or: [{ status: { $exists: false } }, { status: null }] },
      { $set: { status: "active" } },
    );
    await users.updateMany(
      { $or: [{ plan: { $exists: false } }, { plan: null }] },
      { $set: { plan: "free" } },
    );
    await users.updateMany(
      {
        role: "vendor",
        $or: [{ vendorStatus: { $exists: false } }, { vendorStatus: null }],
      },
      { $set: { vendorStatus: "approved", vendorApprovedAt: now } },
    );
    await users.updateMany(
      {
        role: { $ne: "vendor" },
        $or: [{ vendorStatus: { $exists: false } }, { vendorStatus: null }],
      },
      { $set: { vendorStatus: "not_applied" } },
    );

    const applications = await mongoDB
      .collection("vendor_applications")
      .find({ status: { $in: ["pending", "approved", "rejected"] } })
      .toArray();
    for (const application of applications) {
      if (typeof application.userId !== "string") continue;
      const status = String(application.status);
      const appliedAt = application.createdAt instanceof Date
        ? application.createdAt
        : now;
      const existingUser = await users.findOne(userFilterById(application.userId));
      if (!existingUser) continue;
      await users.updateOne(
        userFilterById(application.userId),
        {
          $set: {
            vendorStatus: status,
            vendorAppliedAt: appliedAt,
            ...(status === "approved"
              && existingUser.role !== "admin"
              ? {
                  role: "vendor",
                  vendorApprovedAt:
                    application.reviewedAt instanceof Date
                      ? application.reviewedAt
                      : now,
                }
              : {}),
          },
          ...(status === "approved"
            ? {}
            : { $unset: { vendorApprovedAt: "" } }),
        },
      );
    }

    console.log(`RBAC migration complete. Synchronized ${applications.length} vendor applications.`);
  } catch (error) {
    console.error("RBAC migration failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoClient.close();
  }
}

void migrate();
