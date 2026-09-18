import express from "express";
import { usersCollection } from "../index.js";
import { ObjectId } from "mongodb";

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
      preferredLanguage: null,
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

    // NOTE: the user document stores the language as `preferredLanguage`.
    // This used to read `user.language`, which does not exist, so it always
    // returned "" and the language lookup never worked.
    res.json({
      success: true,
      role: user.role || "user",
      preferredLanguage: user.preferredLanguage || "",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.patch("/language", async (req, res) => {
  try {
    const { uid, preferredLanguage } = req.body;
    if (!uid || !preferredLanguage) {
      return res.status(400).json({ success: false, message: "UID and language are required" });
    }

    const result = await usersCollection().updateOne(
      { uid },
      { $set: { preferredLanguage } }
    );

    // Tell the truth when the uid did not match anything, otherwise the app
    // thinks the language was saved and shows the wrong state.
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, message: "Language updated successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.get("/profile", async (req, res) => {
  try {
    const { uid } = req.query;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "UID is required!",
      });
    }

    const user = await usersCollection().findOne({ uid });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User profile fetched successfully",
      user,
    });

  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
});

router.patch("/profile", async (req, res) => {
  try {

    const { uid, ...updateFields } = req.body;
    
    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "UID is required!",
      });
    }

    const result = await usersCollection().updateOne(
      { uid },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const updatedUser = await usersCollection().findOne({ uid });

    res.json({
      success: true,
      message: "User profile updated successfully!",
      user: updatedUser,
    });

  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
});

/**
 * Search for people to chat with.
 *
 * Matches the query against email, first name, last name and preferred language.
 * Only public fields are returned; email is public on purpose so members can be
 * found by it.
 */
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    // A blank search returns nothing, so we never dump the whole user list.
    if (!q) {
      return res.json({ success: true, users: [] });
    }

    // Escape characters that mean something in a regex, so a query like "a.b"
    // is searched as plain text.
    const safeQuery = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(safeQuery, "i");

    const users = await usersCollection()
      .find({
        $or: [
          { email: pattern },
          { firstName: pattern },
          { lastName: pattern },
          { preferredLanguage: pattern },
        ],
      })
      .limit(20)
      .toArray();

    res.json({
      success: true,
      users: users.map((user) => ({
        uid: user.uid,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        photoURL: user.photoURL || "",
        preferredLanguage: user.preferredLanguage || "",
      })),
    });
  } catch (error) {
    console.error("Error searching users:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;