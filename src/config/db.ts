import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || "pizzahub";

if (!uri) throw new Error("MONGODB_URI is missing from the server .env file.");

export const mongoClient = new MongoClient(uri);
export const mongoDB = mongoClient.db(dbName);

export async function connectDatabase() {
  await mongoClient.connect();
  await mongoDB.command({ ping: 1 });
  console.log(`MongoDB connected: ${dbName}`);
}
