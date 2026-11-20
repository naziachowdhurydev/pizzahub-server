import { Router } from "express";
import { applyVendorApplication } from "../controllers/vendor-applications.js";
import { requireAuth, requireCustomer } from "../middleware/auth.js";

const router = Router();

router.post("/apply", requireAuth, requireCustomer, applyVendorApplication);

export default router;
