import { Router } from "express";
import { mongoDB } from "../config/db.js";
import { normalizeVendorPlan } from "../lib/vendor-plan.js";

const router = Router();

type CatalogProduct = Record<string, unknown> & {
  _id?: unknown;
  name?: unknown;
  isFeatured?: unknown;
  vendorId?: unknown;
  vendorName?: string;
  vendorPlan?: "free" | "premium";
};

async function withVendorDetails(products: CatalogProduct[]): Promise<CatalogProduct[]> {
  const vendors = await mongoDB
    .collection("user")
    .find({}, { projection: { name: 1, plan: 1 } })
    .toArray();
  const vendorsById = new Map(
    vendors.map((vendor) => [String(vendor.id ?? vendor._id), vendor]),
  );

  return products.map((product) => {
    const vendorId = typeof product.vendorId === "string" ? product.vendorId : "";
    const vendor = vendorsById.get(vendorId);
    return {
      ...product,
      vendorName: typeof vendor?.name === "string" ? vendor.name : "PizzaHub",
      vendorPlan: normalizeVendorPlan(vendor?.plan),
    };
  });
}

function productRank(product: CatalogProduct): number {
  const featured = product.isFeatured === true ? 1 : 0;
  return (product.vendorPlan === "premium" ? 3 : 0) + featured;
}

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
    const products = await mongoDB.collection("products").find({ isAvailable: true }).toArray();
    const enriched = await withVendorDetails(products as CatalogProduct[]);
    enriched.sort((a, b) => {
      const rankDifference = productRank(b) - productRank(a);
      if (rankDifference !== 0) return rankDifference;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""));
    });
    res.json({ success: true, data: enriched });
  } catch {
    res.status(500).json({ success: false, message: "Could not load products." });
  }
});

router.get("/products/:slug", async (req, res) => {
  try {
    const product = await mongoDB.collection("products").findOne({ slug: req.params.slug });
    if (!product) return res.status(404).json({ success: false, message: "Pizza not found." });
    const [enriched] = await withVendorDetails([product as CatalogProduct]);
    res.json({ success: true, data: enriched });
  } catch {
    res.status(500).json({ success: false, message: "Could not load pizza." });
  }
});

export default router;
