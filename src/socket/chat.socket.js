import { ObjectId } from "mongodb";
import { isAdminReady, verifyIdToken } from "../config/firebaseAdmin.js";
import { translateText } from "../utils/translate.js";
import { messagesCollection, usersCollection } from "../index.js";

// ---------------------------------------------------------------------------
// How this file is organised
//
// 1. Small helpers (room ids, names).
// 2. The translation cache + a queue so we never hammer Ollama.
// 3. attachChatSocket(), which sets up every socket event.
//
// The important idea: we translate once per LANGUAGE, not once per person.
// A group of 50 people who speak 6 languages costs 6 translations, not 50.
// ---------------------------------------------------------------------------

export const GENERAL_ROOM = "general";

// Recent messages sent when you open a room.
const HISTORY_LIMIT = 30;

// Give up waiting for a translation after this long and use the original.
const TRANSLATION_TIMEOUT_MS = 8000;

// Never run more than this many translations at the same time.
const MAX_TRANSLATIONS_AT_ONCE = 3;

/**
 * A direct message room id, the same for both people.
 * Sorting the uids means Alice->Bob and Bob->Alice land in one room.
 */
export const roomIdForDirectMessage = (uidA, uidB) => {
  const sorted = [uidA, uidB].sort();
  return `dm:${sorted[0]}:${sorted[1]}`;
};

// Each language in a room gets its own channel, so one emit reaches everyone
// reading in that language.
const languageChannel = (roomId, language) => `${roomId}::lang::${language}`;

const nameFromUser = (user) => {
  if (!user) {
    return "";
  }

  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
};

// Language names never contain "." or "$". Guard anyway so an odd value cannot
// break the MongoDB field path used for caching.
const isSafeFieldName = (value) => !value.includes(".") && !value.includes("$");

// ---------------------------------------------------------------------------
// Translation, with a cache, a queue and a timeout
// ---------------------------------------------------------------------------

// Jobs waiting for a free slot.
const waitingJobs = [];
let runningJobs = 0;

// Keeps the number of parallel translations under control, so a burst of
// messages queues up instead of overwhelming the translation service.
const runWithLimit = (job) =>
  new Promise((resolve, reject) => {
    const start = () => {
      runningJobs += 1;

      job()
        .then(resolve, reject)
        .finally(() => {
          runningJobs -= 1;

          const next = waitingJobs.shift();
          if (next) {
            next();
          }
        });
    };

    if (runningJobs < MAX_TRANSLATIONS_AT_ONCE) {
      start();
    } else {
      waitingJobs.push(start);
    }
  });

// Two people asking for the same translation at the same moment share one call.
const inFlightTranslations = new Map();

const translateWithTimeout = (text, language) =>
  Promise.race([
    translateText(text, language),
    new Promise((resolve) => setTimeout(() => resolve(null), TRANSLATION_TIMEOUT_MS)),
  ]);

const getTranslation = (text, language) => {
  const key = `${language}::${text}`;

  if (inFlightTranslations.has(key)) {
    return inFlightTranslations.get(key);
  }

  const promise = runWithLimit(() => translateWithTimeout(text, language)).finally(
    () => inFlightTranslations.delete(key)
  );

  inFlightTranslations.set(key, promise);

  return promise;
};

/**
 * The message text in `language`.
 *
 * Returns the original when no translation is needed or possible, so a
 * translation failure never hides a message.
 */
const textForLanguage = async (message, language) => {
  // The sender's own words are already in their language.
  if (message.language === language) {
    return message.text;
  }

  // Already translated for this language? Reuse it forever.
  if (message.translations && message.translations[language]) {
    return message.translations[language];
  }

  const translated = await getTranslation(message.text, language);

  if (!translated) {
    return message.text;
  }

  // Remember it so this (message, language) pair is translated only once ever.
  if (isSafeFieldName(language)) {
    await messagesCollection().updateOne(
      { _id: message._id },
      { $set: { [`translations.${language}`]: translated } }
    );
  }

  return translated;
};

/** Shapes a stored message for the browser. */
const toClientMessage = (message, text, readerLanguage) => ({
  id: String(message._id),
  roomId: message.roomId,
  fromUid: message.fromUid,
  fromName: message.fromName,
  text,
  language: message.language, // the language it was written in
  shownLanguage: readerLanguage, // the language you are reading it in
  translated: message.language !== readerLanguage,
  createdAt: message.createdAt,
  editedAt: message.editedAt || null,
});

// ---------------------------------------------------------------------------
// Sending out to everyone
// ---------------------------------------------------------------------------

/**
 * Sends one message to every language present in the room.
 *
 * This is the part that keeps big groups cheap: we translate once per language,
 * not once per member. If nobody in the room needs a translation, no work is done
 * at all.
 *
 * `eventName` lets the same helper deliver a brand new message or an edited one.
 * `skipLanguage` is used for new messages, where the sender is answered directly.
 */
const sendToEachLanguage = async (
  io,
  message,
  { eventName = "chat:message", skipLanguage = null } = {}
) => {
  const socketsInRoom = io.sockets.adapter.rooms.get(message.roomId);

  if (!socketsInRoom) {
    return;
  }

  // Which languages are actually in this room right now?
  const languages = new Set();

  for (const socketId of socketsInRoom) {
    const other = io.sockets.sockets.get(socketId);
    const language = other && other.data && other.data.language;

    if (language && language !== skipLanguage) {
      languages.add(language);
    }
  }

  // Fan out. The translation queue keeps this from overwhelming the service.
  await Promise.all(
    [...languages].map(async (language) => {
      const text = await textForLanguage(message, language);

      io.to(languageChannel(message.roomId, language)).emit(
        eventName,
        toClientMessage(message, text, language)
      );
    })
  );
};

// ---------------------------------------------------------------------------
// The sidebar: which conversations does this person have?
// ---------------------------------------------------------------------------

/**
 * Every one-to-one conversation this user takes part in, newest first, with the
 * other person's details and whether the last message was theirs.
 *
 * This is what makes a message appear in the sidebar when the person comes back
 * online, even if they never started the conversation themselves.
 */
const conversationsForUser = async (uid) => {
  // Direct message room ids look like "dm:<uidA>:<uidB>", so any room id that
  // contains this uid is one of their conversations.
  const roomIds = await messagesCollection().distinct("roomId", {
    roomId: { $regex: uid },
  });

  const conversations = [];

  for (const roomId of roomIds) {
    if (!roomId.startsWith("dm:")) {
      continue;
    }

    const latest = await messagesCollection()
      .find({ roomId })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    if (latest.length === 0) {
      continue;
    }

    const message = latest[0];

    // "dm:<a>:<b>" -> the uid that is not mine.
    const otherUid = roomId
      .split(":")
      .filter((part) => part && part !== "dm" && part !== uid)[0];

    if (!otherUid) {
      continue;
    }

    const otherUser = await usersCollection().findOne({ uid: otherUid });

    conversations.push({
      roomId,
      otherUid,
      name: nameFromUser(otherUser) || otherUser?.email || "Member",
      email: otherUser?.email || "",
      // The original text, so opening the sidebar never waits for a translation.
      lastMessage: message.text,
      lastFromUid: message.fromUid,
      lastAt: message.createdAt,
      // True when the last word was theirs, i.e. there is something to read.
      unread: message.fromUid !== uid,
    });
  }

  conversations.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  return conversations;
};

/** Sends the conversation list to every socket belonging to this user. */
const sendConversations = async (io, uid) => {
  const conversations = await conversationsForUser(uid);
  io.to(`user:${uid}`).emit("chat:conversations", conversations);
};

// ---------------------------------------------------------------------------
// The socket events
// ---------------------------------------------------------------------------

export const attachChatSocket = (io) => {
  // Before accepting a socket, find out who it is. The uid always comes from the
  // verified token, never from what the client claims.
  io.use(async (socket, next) => {
    const auth = socket.handshake.auth || {};

    // Development escape hatch, so the chat can be tested before Firebase Admin
    // is configured. Off unless ALLOW_UNVERIFIED_SOCKET=true. Never use in production.
    if (!isAdminReady() && process.env.ALLOW_UNVERIFIED_SOCKET === "true") {
      console.warn("Socket accepted WITHOUT verification (development only)");
      socket.data.uid = auth.uid || "dev-user";
      return next();
    }

    try {
      const decoded = await verifyIdToken(auth.token);
      socket.data.uid = decoded.uid;
      return next();
    } catch (error) {
      return next(new Error(`Not authorised: ${error.message}`));
    }
  });

  io.on("connection", (socket) => {
    const myUid = socket.data.uid;

    // "Here I am, and this is the language I read in."
    // The language is read from the database, because setting it on the profile
    // is required before chatting.
    socket.on("user:join", async (info = {}) => {
      const user = await usersCollection().findOne({ uid: myUid });

      socket.data.name = nameFromUser(user) || info.name || "Member";
      socket.data.language = user?.preferredLanguage || info.language || "English";

      socket.emit("user:ready", {
        uid: myUid,
        name: socket.data.name,
        language: socket.data.language,
      });

      // A personal room, so this user can be reached even when they are not
      // sitting inside a particular conversation.
      socket.join(`user:${myUid}`);

      // Send their conversation list straight away. This is what makes a message
      // appear in the sidebar the moment they come back online.
      await sendConversations(io, myUid);
    });

    // Open a room: join it, then receive recent history in my language.
    socket.on("chat:open", async ({ roomId } = {}) => {
      if (!roomId) {
        return;
      }

      const language = socket.data.language || "English";

      // Leave the previous conversation room and its language channel, but never
      // the personal room. Leaving that would stop this user receiving sidebar
      // updates while they are sitting in a conversation.
      for (const room of socket.rooms) {
        if (room !== socket.id && room !== `user:${myUid}`) {
          socket.leave(room);
        }
      }

      socket.join(roomId);
      socket.join(languageChannel(roomId, language));

      // Newest first for the limit, then flipped so it reads like a conversation.
      const recent = await messagesCollection()
        .find({ roomId })
        .sort({ createdAt: -1 })
        .limit(HISTORY_LIMIT)
        .toArray();

      recent.reverse();

      // Translate whatever is not cached yet. The queue limits how many run at once.
      const history = await Promise.all(
        recent.map(async (message) =>
          toClientMessage(
            message,
            await textForLanguage(message, language),
            language
          )
        )
      );

      socket.emit("chat:history", history);
    });

    // Send a message to a room.
    socket.on("chat:send", async ({ roomId, text } = {}) => {
      const cleanText = (text || "").trim();

      if (!roomId || !cleanText) {
        return;
      }

      const language = socket.data.language || "English";

      const message = {
        roomId,
        fromUid: myUid,
        fromName: socket.data.name || "Member",
        text: cleanText,
        language, // the language the sender wrote in
        translations: {}, // cache: language -> translated text
        createdAt: new Date(),
      };

      const result = await messagesCollection().insertOne(message);
      message._id = result.insertedId;

      // 1. The sender sees their own words straight away.
      socket.emit("chat:message", toClientMessage(message, message.text, language));

      // 2. Everyone else receives it in their own language.
      await sendToEachLanguage(io, message, { skipLanguage: language });

      // 3. For a one-to-one chat, refresh the other person's sidebar so the
      // conversation appears even if they are online in a different room.
      if (roomId.startsWith("dm:")) {
        const otherUid = roomId
          .split(":")
          .filter((part) => part && part !== "dm" && part !== myUid)[0];

        if (otherUid) {
          await sendConversations(io, otherUid);
        }
      }

      // The sender's own sidebar shows the new conversation too.
      await sendConversations(io, myUid);
    });

    // Edit one of your own messages.
    socket.on("chat:edit", async ({ messageId, text } = {}) => {
      const cleanText = (text || "").trim();

      if (!messageId || !ObjectId.isValid(messageId) || !cleanText) {
        return;
      }

      const existing = await messagesCollection().findOne({
        _id: new ObjectId(messageId),
      });

      // Only the author may edit their own message.
      if (!existing || existing.fromUid !== myUid) {
        return;
      }

      const editedAt = new Date();

      // The old translations no longer match the new text, so they are dropped
      // and built again for whoever is in the room.
      await messagesCollection().updateOne(
        { _id: existing._id },
        { $set: { text: cleanText, translations: {}, editedAt } }
      );

      const updated = { ...existing, text: cleanText, translations: {}, editedAt };

      // Everyone in the room sees the new wording, each in their own language.
      await sendToEachLanguage(io, updated, {
        eventName: "chat:message:edited",
      });
    });

    // Delete one of your own messages.
    socket.on("chat:delete", async ({ messageId } = {}) => {
      if (!messageId || !ObjectId.isValid(messageId)) {
        return;
      }

      const existing = await messagesCollection().findOne({
        _id: new ObjectId(messageId),
      });

      // Only the author may delete their own message.
      if (!existing || existing.fromUid !== myUid) {
        return;
      }

      await messagesCollection().deleteOne({ _id: existing._id });

      // Everyone in the room removes it. No translation needed.
      io.to(existing.roomId).emit("chat:message:deleted", {
        id: String(existing._id),
        roomId: existing.roomId,
      });
    });
  });
};