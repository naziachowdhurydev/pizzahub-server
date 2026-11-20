import "dotenv/config";
import { connectDatabase, mongoDB, mongoClient } from "../config/db.js";

const categories = [
  { name: "Classic", slug: "classic", description: "Timeless pizza favourites." },
  { name: "Chicken", slug: "chicken", description: "Loaded with delicious chicken." },
  { name: "Vegetarian", slug: "vegetarian", description: "Fresh vegetables and rich flavours." },
  { name: "Spicy", slug: "spicy", description: "For those who love a kick." },
  { name: "Cheese Lovers", slug: "cheese-lovers", description: "Extra cheesy goodness." },
  { name: "Specialty", slug: "specialty", description: "PizzaHub signature creations." },
  { name: "Seafood", slug: "seafood", description: "Fresh seafood with vibrant toppings." },
  { name: "Meat Lovers", slug: "meat-lovers", description: "Hearty pizzas loaded with savory meats." },
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
  { name: "Buffalo Chicken", slug: "buffalo-chicken", description: "Crispy chicken, tangy buffalo sauce, red onion and cooling ranch.", category: "Chicken", price: 780, image: "https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=900&q=85", rating: 4.8, isFeatured: true },
  { name: "Garden Pesto", slug: "garden-pesto", description: "Basil pesto, roasted peppers, cherry tomatoes and mozzarella.", category: "Vegetarian", price: 620, image: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85", rating: 4.6, isFeatured: false },
  { name: "Smoky Beef", slug: "smoky-beef", description: "Slow-cooked beef, smoked onions, cheddar and barbecue glaze.", category: "Meat Lovers", price: 890, image: "https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=900&q=85", rating: 4.9, isFeatured: true },
  { name: "Seafood Delight", slug: "seafood-delight", description: "Shrimp, sweet corn, herbs and creamy garlic sauce.", category: "Seafood", price: 950, image: "https://images.unsplash.com/photo-1604382355076-af4b0eb60143?auto=format&fit=crop&w=900&q=85", rating: 4.7, isFeatured: false },
  { name: "Mediterranean", slug: "mediterranean", description: "Olives, feta, spinach, sun-dried tomato and oregano.", category: "Vegetarian", price: 690, image: "https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=900&q=85", rating: 4.7, isFeatured: false },
  { name: "Spicy Beef Supreme", slug: "spicy-beef-supreme", description: "Seasoned beef, jalapeños, peppers and melted mozzarella.", category: "Spicy", price: 920, image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=85", rating: 4.8, isFeatured: false },
  { name: "Garlic Prawn", slug: "garlic-prawn", description: "Garlic prawns, parsley, mozzarella and a bright lemon finish.", category: "Seafood", price: 980, image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=85", rating: 4.8, isFeatured: false },
  { name: "Meat Feast", slug: "meat-feast", description: "Pepperoni, beef, chicken sausage and extra cheese.", category: "Meat Lovers", price: 990, image: "https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=900&q=85", rating: 4.9, isFeatured: true },
  { name: "Mushroom Truffle", slug: "mushroom-truffle", description: "Roasted mushrooms, mozzarella, herbs and a truffle oil drizzle.", category: "Specialty", price: 870, image: "https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=85", rating: 4.8, isFeatured: false },
].map(item => ({
  ...item,
  ingredients: [
    "Hand-stretched dough",
    "Tomato sauce",
    "Mozzarella",
    `${item.category} toppings`,
  ],
  allergens: ["Wheat (gluten)", "Milk"],
  preparationTime: "20–25 minutes",
  sizes: ["Regular", "Large"],
  isAvailable: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

async function seed() {
  try {
    await connectDatabase();
    for (const category of categories) {
      await mongoDB.collection("categories").updateOne({ slug: category.slug }, { $setOnInsert: category }, { upsert: true });
    }
    for (const product of products) {
      const { ingredients, allergens, preparationTime, ...insertData } = product;
      await mongoDB.collection("products").updateOne(
        { slug: product.slug },
        {
          $setOnInsert: insertData,
          $set: { ingredients, allergens, preparationTime },
        },
        { upsert: true },
      );
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
