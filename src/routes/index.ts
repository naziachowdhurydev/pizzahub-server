import { Router } from "express";
import catalogRoutes from "./catalog.routes.js";
import userRoutes from "./user.routes.js";
import orderRoutes from "./order.routes.js";
import adminRoutes from "./admin.routes.js";
import customerRoutes from "./customer.routes.js";
import vendorRoutes from "./vendor.routes.js";

const router = Router();
router.use("/", catalogRoutes);
router.use("/users", userRoutes);
router.use("/orders", orderRoutes);
router.use("/customer", customerRoutes);
router.use("/vendor", vendorRoutes);
router.use("/admin", adminRoutes);
export default router;
