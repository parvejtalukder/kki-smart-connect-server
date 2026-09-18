import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// The service account key file. It lives in the repo but is gitignored, and can
// be overridden with FIREBASE_SERVICE_ACCOUNT_PATH in .env.
const here = path.dirname(fileURLToPath(import.meta.url)); // -> src/config
const keyPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(here, "..", "firebase-admin", "kki-smart-connects-firebase-adminsdk.json");

let adminReady = false;

// Try to start Firebase Admin once, at server start up.
try {
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  initializeApp({ credential: cert(serviceAccount) });
  adminReady = true;
  console.log("Firebase Admin ready - socket tokens will be verified");
} catch (error) {
  // Fail closed: we do NOT fall back to trusting whatever uid the client sends.
  console.warn("Firebase Admin NOT configured:", error.message);
  console.warn("Socket connections will be REJECTED until this is fixed.");
}

export const isAdminReady = () => adminReady;

/**
 * Verifies a Firebase ID token.
 *
 * Returns the decoded token, which contains the real uid. Throws if Admin is not
 * configured or the token is missing/invalid, so callers can reject the request.
 */
export const verifyIdToken = async (token) => {
  if (!adminReady) {
    throw new Error("Firebase Admin is not configured on the server");
  }

  if (!token) {
    throw new Error("No token provided");
  }

  return getAuth().verifyIdToken(token);
};