import express from "express";
import cors from "cors"; 
import "dotenv/config";
import { connectDB, getDB } from "./config/db.js";

import userRoutes from "./routes/user.routes.js";
import translateRoutes from "./routes/translate.routes.js";

const app = express();

app.use(cors());

app.use(express.json());
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.json({
        message: "KKI is Running...",
    });
});

app.use("/api/users", userRoutes);
app.use("/api/translate", translateRoutes);

await connectDB();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export const usersCollection = () => {
    return getDB().collection("users");
};