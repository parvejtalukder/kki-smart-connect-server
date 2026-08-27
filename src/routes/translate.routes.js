import express from "express";
import { Ollama } from "ollama";

const router = express.Router();

const ollama = new Ollama({
  host: "https://ollama.com",
  headers: {
    Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
  },
});

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

  try {
    const response = await ollama.generate({
      model: "gemma4:cloud",
      prompt: 
              `Translate this message into ${targetLanguage}.
              Return only the translated message.
              Do not explain anything.
              Do not add quotes.

              Message:
              ${message}`,
    });
    
    res.json(
      {
        success: true,
        translation: response.response.trim(),
      }
    );

  } catch (error) {
    console.error("Ollama Cloud error:", error);

    res.status(500).json(
      {
        success: false,
        message: "Translation failed",
      }
    );
  }
});

export default router;