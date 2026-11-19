import "dotenv/config";
import { connectDatabase, mongoDB, mongoClient } from "../config/db.js";

const categories = [
  { name: "Classic", slug: "classic", description: "Timeless pizza favourites." },
  { name: "Chicken", slug: "chicken", description: "Loaded with delicious chicken." },
  { name: "Vegetarian", slug: "vegetarian", description: "Fresh vegetables and rich flavours." },
  { name: "Spicy", slug: "spicy", description: "For those who love a kick." },
  { name: "Cheese Lovers", slug: "cheese-lovers", description: "Extra cheesy goodness." },
  { name: "Specialty", slug: "specialty", description: "PizzaHub signature creations." },
].map(item => ({ ...item, isActive: true, createdAt: new Date(), updatedAt: new Date() }));

const products = [
  { name: "Margherita", slug: "margherita", description: "Classic tomato sauce, mozzarella and fresh basil.", category: "Classic", price: 450, image: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85", rating: 4.8, isFeatured: true },
  { name: "Classic Pepperoni", slug: "classic-pepperoni", description: "A generous layer of pepperoni over mozzarella and tomato sauce.", category: "Classic", price: 650, image: "https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=900&q=85", rating: 4.9, isFeatured: true },
  { name: "BBQ Chicken", slug: "bbq-chicken", description: "Smoky BBQ sauce, grilled chicken, onion and mozzarella.", category: "Chicken", price: 700, image: "https://images.unsplash.com/photo-1604382355076-af4b0eb60143?auto=format&fit=crop&w=900&q=85", rating: 4.8, isFeatured: true },
  { name: "Chicken Supreme", slug: "chicken-supreme", description: "Chicken, mushrooms, capsicum, onion and our house sauce.", category: "Chicken", price: 750, image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=85", rating: 4.7, isFeatured: true },
  { name: "Veggie Delight", slug: "veggie-delight", description: "Bell peppers, olives, onions, sweet corn and mushrooms.", category: "Vegetarian", price: 550, image: "https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=900&q=85", rating: 4.6, isFeatured: false },
  { name: "Four Cheese", slug: "four-cheese", description: "Mozzarella, cheddar, parmesan and creamy cheese sauce.", category: "Cheese Lovers", price: 800, image: "https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=85", rating: 4.9, isFeatured: true },
  { name: "Spicy Dynamite", slug: "spicy-dynamite", description: "Spicy chicken, jalapeños, chilli flakes and hot sauce.", category: "Spicy", price: 720, image: "https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=900&q=85", rating: 4.7, isFeatured: false },
  { name: "Hub Special", slug: "hub-special", description: "A signature mix of chicken, beef, olives and extra cheese.", category: "Specialty", price: 850, image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=85", rating: 5.0, isFeatured: true },
].map(item => ({ ...item, sizes: ["Regular", "Large"], isAvailable: true, createdAt: new Date(), updatedAt: new Date() }));

async function seed() {
  try {
    await connectDatabase();
    for (const category of categories) {
      await mongoDB.collection("categories").updateOne({ slug: category.slug }, { $setOnInsert: category }, { upsert: true });
    }
    for (const product of products) {
      await mongoDB.collection("products").updateOne({ slug: product.slug }, { $setOnInsert: product }, { upsert: true });
    }
    console.log(`Seed complete: ${categories.length} categories and ${products.length} products.`);
  } catch (error) {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoClient.close();
  }
}
seed();
