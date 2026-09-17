import express from "express";
import { usersCollection } from "../index.js";

const router = express.Router();

router.post("/signup", async (req, res) => {
  
  const { fullName, email, photoURL, uid } = req.body;
  
  if (!email || !fullName) {
    return res.status(400).json({
      success: false,
      message: "Required Field Missing!"
    });
  }
  
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  try {
    const existingUser = await usersCollection().findOne({ email });
    if (existingUser) {
      console.log("Exist")
      return res.status(409).json({
        success: false,
        message: "User Already Exists!"
      });
    }
    
    const newUser = {
      uid,
      firstName,
      lastName,
      email,
      photoURL: photoURL || "",
      role: "user",
      preferredLanguage: "",
      createdAt: new Date(),
    };

    const result = await usersCollection().insertOne(newUser);
    console.log(result);

    return res.status(201).json({
      success: true,
      message: "Account created and saved successfully!",
      userId: result.insertedId
    });

  } catch (err) {
    console.error("Error during user signup:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
});

router.get("/role", async (req, res) => {
  try {
    const { uid } = req.query;

    if (!uid) {
      return res.status(400).json({ success: false, message: "UID is required" });
    }

    const user = await usersCollection().findOne({ uid });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, role: user.role || "user" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;