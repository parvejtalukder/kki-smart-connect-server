import { Ollama } from "ollama";

// Ollama can run in two places:
//   * Ollama Cloud, which needs OLLAMA_API_KEY and uses a model name ending in ":cloud"
//   * this machine, which needs Ollama installed and running locally
//
// A local server is often not running, so whenever we have an API key we use the
// cloud. Point OLLAMA_HOST at an https:// address to override this.
const apiKey = process.env.OLLAMA_API_KEY;
const configuredHost = process.env.OLLAMA_HOST || "";
const isRemoteHost = configuredHost.startsWith("https://");

const useCloud = isRemoteHost || Boolean(apiKey);

const host = isRemoteHost
  ? configuredHost
  : useCloud
    ? "https://ollama.com"
    : "http://localhost:11434";

// Cloud models are named like "gemma4:cloud", so a leftover local model name
// such as "llama3.1" is ignored when we are talking to the cloud.
const cloudModel =
  process.env.OLLAMA_MODEL && process.env.OLLAMA_MODEL.endsWith(":cloud")
    ? process.env.OLLAMA_MODEL
    : "gemma4:cloud";

const MODEL = useCloud ? cloudModel : process.env.OLLAMA_MODEL || "llama3.1";

const ollama = new Ollama({
  host,
  headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
});

/**
 * Translates one piece of text into `targetLanguage`.
 *
 * Returns the translated string, or null if it could not be translated.
 * It never throws, so a translation problem can never break chat: the caller
 * falls back to showing the original message.
 */
export const translateText = async (text, targetLanguage) => {
  if (!text || !targetLanguage) {
    return null;
  }

  try {
    const response = await ollama.generate({
      model: MODEL,
      prompt: `Translate this message into ${targetLanguage}.
              Return only the translated message.
              Do not explain anything.
              Do not add quotes.

              Message:
              ${text}`,
    });

    const translated = (response.response || "").trim();

    return translated || null;
  } catch (error) {
    console.error("Translation failed:", error.message);
    return null;
  }
};