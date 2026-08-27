import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);

let db;

export const connectDB = async () => {
    try {
        await client.connect();
        db = client.db(process.env.MONGODB_NAME || "kki");
        console.log("MongoDB connected");
    } catch (error) {
        console.log("MongoDB Connection Issue: ", error);
        process.exit(1);
    }
}

export const getDB = () => {
    if (!db) {
        throw new Error("Database is not connected!");
    }
    return db;
}

export const usersCollection = () => getDB().collection("users");