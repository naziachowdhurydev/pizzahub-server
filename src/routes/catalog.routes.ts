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

router.get("/products", async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const sort = typeof req.query.sort === "string" ? req.query.sort.trim() : "featured";
    const minPrice = typeof req.query.minPrice === "string" ? Number(req.query.minPrice) : NaN;
    const maxPrice = typeof req.query.maxPrice === "string" ? Number(req.query.maxPrice) : NaN;

    const filter: Record<string, unknown> = { isAvailable: true };
    if (category) filter.category = category;
    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
      filter.price = {
        ...(Number.isFinite(minPrice) ? { $gte: minPrice } : {}),
        ...(Number.isFinite(maxPrice) ? { $lte: maxPrice } : {}),
      };
    }
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(escaped, "i");
      filter.$or = [{ name: pattern }, { description: pattern }, { category: pattern }];
    }

    const products = await mongoDB.collection("products").find(filter).toArray();
    const enriched = await withVendorDetails(products as CatalogProduct[]);

    enriched.sort((a, b) => {
      const priceA = typeof a.price === "number" ? a.price : Number(a.price ?? 0);
      const priceB = typeof b.price === "number" ? b.price : Number(b.price ?? 0);
      const nameA = String(a.name ?? "");
      const nameB = String(b.name ?? "");

      switch (sort) {
        case "price_asc":
          return priceA - priceB || nameA.localeCompare(nameB);
        case "price_desc":
          return priceB - priceA || nameA.localeCompare(nameB);
        case "name_asc":
          return nameA.localeCompare(nameB);
        case "name_desc":
          return nameB.localeCompare(nameA);
        case "featured":
        default: {
          const rankDifference = productRank(b) - productRank(a);
          if (rankDifference !== 0) return rankDifference;
          return nameA.localeCompare(nameB);
        }
      }
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
