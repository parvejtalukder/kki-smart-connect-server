import express from "express";
import { translateText } from "../utils/translate.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { message, targetLanguage = "English" } = req.body;

  if (!message) {
    return res.status(400).json(
      {
        success: false,
        message: "message is required",
      }
    );
  }

  const translation = await translateText(message, targetLanguage);

  if (!translation) {
    return res.status(500).json(
      {
        success: false,
        message: "Translation failed",
      }
    );
  }

  res.json(
    {
      success: true,
      translation,
    }
  );
});

export default router;