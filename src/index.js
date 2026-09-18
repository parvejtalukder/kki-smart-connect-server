import express from "express";
import cors from "cors"; 
import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import { connectDB, getDB } from "./config/db.js";
import { attachChatSocket } from "./socket/chat.socket.js";

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

// Express needs a real HTTP server so Socket.io can share the same port.
const server = http.createServer(app);

// Which sites may open a websocket. SITE can hold several, comma separated,
// written as "localhost:3000" or as a full URL.
const toOrigin = (value) => {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  // A bare host such as "localhost" needs the protocol and the port added.
  const withPort = value.includes(":") ? value : `${value}:3000`;

  return `http://${withPort}`;
};

const allowedOrigins = (process.env.SITE || "localhost:3000")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map(toOrigin);

// Always allow the local Next.js app, so a stale SITE value cannot silently
// break chat while developing.
if (!allowedOrigins.includes("http://localhost:3000")) {
  allowedOrigins.push("http://localhost:3000");
}

console.log("Socket.io will accept connections from:", allowedOrigins.join(", "));

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// All the chat events live in this file.
attachChatSocket(io);

await connectDB();

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export const usersCollection = () => {
    return getDB().collection("users");
};

// Chat messages, as described in src/socket/chat.socket.js
export const messagesCollection = () => {
    return getDB().collection("messages");
};