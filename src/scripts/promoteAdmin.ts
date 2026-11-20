import "dotenv/config";
import { connectDatabase, mongoDB, mongoClient } from "../config/db.js";

async function promoteAdmin() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Usage: npm run admin:promote -- existing-user@example.com");
    process.exitCode = 1;
    return;
  }

  try {
    await connectDatabase();
    const result = await mongoDB.collection("user").updateOne(
      { email },
      {
        $set: {
          role: "admin",
          updatedAt: new Date(),
        },
      },
    );
    if (result.matchedCount === 0) {
      console.error(`No existing user found for ${email}. Create the account through public signup first.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Promoted existing account ${email} to admin.`);
  } catch (error) {
    console.error("Admin promotion failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoClient.close();
  }
}

void promoteAdmin();
