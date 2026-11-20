import { Router } from "express";
import { mongoDB } from "../config/db.js";

const router = Router();

router.get("/categories", async (_req, res) => {
  try {
    const categories = await mongoDB.collection("categories").find({ isActive: true }).sort({ name: 1 }).toArray();
    res.json({ success: true, data: categories });
  } catch {
    res.status(500).json({ success: false, message: "Could not load categories." });
  }
});

router.get("/products", async (_req, res) => {
  try {
    const products = await mongoDB.collection("products").find({ isAvailable: true }).sort({ isFeatured: -1, name: 1 }).toArray();
    res.json({ success: true, data: products });
  } catch {
    res.status(500).json({ success: false, message: "Could not load products." });
  }
});

router.get("/products/:slug", async (req, res) => {
  try {
    const product = await mongoDB.collection("products").findOne({ slug: req.params.slug });
    if (!product) return res.status(404).json({ success: false, message: "Pizza not found." });
    res.json({ success: true, data: product });
  } catch {
    res.status(500).json({ success: false, message: "Could not load pizza." });
  }
});

export default router;
