// @ts-nocheck
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const appRole = v.union(v.literal("user"), v.literal("admin"), v.literal("dev"));
const dayMs = 24 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function userToClient(user) {
  if (!user) return null;
  return {
    id: user._id,
    email: user.email,
    created_at: new Date(user.createdAt).toISOString(),
    last_sign_in_at: user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : null,
  };
}

function profileToClient(user) {
  return {
    user_id: user._id,
    username: user.username,
    created_at: new Date(user.createdAt).toISOString(),
    updated_at: new Date(user.updatedAt).toISOString(),
  };
}

function publicDeckToClient(row) {
  return {
    id: row.deckId,
    name: row.name,
    description: row.description || "",
    deck_group: row.deckGroup ?? null,
    categories: row.categories ?? null,
    questions: row.questions || [],
    question_count: row.questionCount || 0,
    version: row.version || 1,
    source: row.source || "public-db",
    is_archived: row.isArchived === true,
    updated_by: row.updatedBy || null,
    created_at: new Date(row.createdAt).toISOString(),
    updated_at: new Date(row.updatedAt).toISOString(),
  };
}

function visibilityToClient(row) {
  return {
    deck_id: row.deckId,
    is_hidden: row.isHidden === true,
    updated_by: row.updatedBy || null,
    created_at: new Date(row.createdAt).toISOString(),
    updated_at: new Date(row.updatedAt).toISOString(),
  };
}

function sharedDeckToClient(row) {
  return {
    id: row.sharedDeckId,
    owner_user_id: row.ownerUserId,
    owner_username: row.ownerUsername || "",
    source_deck_id: row.sourceDeckId,
    name: row.name,
    description: row.description || "",
    deck_group: row.deckGroup ?? null,
    categories: row.categories ?? null,
    questions: row.questions || [],
    question_count: row.questionCount || 0,
    is_published: row.isPublished === true,
    created_at: new Date(row.createdAt).toISOString(),
    updated_at: new Date(row.updatedAt).toISOString(),
  };
}

async function getUserBySessionHash(ctx, tokenHash) {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!session || session.expiresAt <= now()) {
    return null;
  }
  return await ctx.db.get(session.userId);
}

async function requireUserBySessionHash(ctx, tokenHash) {
  const user = await getUserBySessionHash(ctx, tokenHash);
  if (!user) throw new Error("Brak aktywnej sesji. Zaloguj się ponownie.");
  return user;
}

async function requireAdminUser(ctx, tokenHash) {
  const user = await requireUserBySessionHash(ctx, tokenHash);
  if (user.role !== "admin" && user.role !== "dev") {
    throw new Error("Brak uprawnień.");
  }
  return user;
}

async function canAccessAnswerVoteTarget(ctx, user, targetScope, targetDeckId) {
  if (targetScope === "public") return String(targetDeckId || "").trim().length > 0;
  if (targetScope !== "shared") return false;

  const sharedDeck = await ctx.db
    .query("sharedDecks")
    .withIndex("by_shared_deck_id", (q) => q.eq("sharedDeckId", targetDeckId))
    .unique();
  if (!sharedDeck) return false;
  if (sharedDeck.isPublished) return true;
  if (!user) return false;
  if (String(sharedDeck.ownerUserId) === String(user._id)) return true;

  const sub = await ctx.db
    .query("sharedDeckSubscriptions")
    .withIndex("by_user_shared", (q) => q.eq("userId", user._id).eq("sharedDeckId", targetDeckId))
    .unique();
  return Boolean(sub);
}

export const getUserPrivateByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("users"),
      email: v.string(),
      passwordSalt: v.string(),
      passwordHash: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(args.email)))
      .unique();
    if (!user) return null;
    return {
      id: user._id,
      email: user.email,
      passwordSalt: user.passwordSalt,
      passwordHash: user.passwordHash,
    };
  },
});

export const createUser = internalMutation({
  args: {
    email: v.string(),
    passwordSalt: v.string(),
    passwordHash: v.string(),
    username: v.string(),
    role: v.optional(appRole),
  },
  returns: v.object({ user: v.any() }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) throw new Error("Konto o tym adresie e-mail już istnieje.");

    const username = normalizeUsername(args.username);
    const takenUsername = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (takenUsername) throw new Error("Nie udało się wygenerować unikalnej nazwy użytkownika.");

    const ts = now();
    const userId = await ctx.db.insert("users", {
      email,
      passwordSalt: args.passwordSalt,
      passwordHash: args.passwordHash,
      role: args.role || "user",
      username,
      createdAt: ts,
      updatedAt: ts,
      lastSignInAt: ts,
    });
    const user = await ctx.db.get(userId);
    return { user: userToClient(user) };
  },
});

export const createSession = internalMutation({
  args: {
    userId: v.id("users"),
    tokenHash: v.string(),
  },
  returns: v.object({ session: v.any() }),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Nie znaleziono użytkownika.");
    const ts = now();
    await ctx.db.insert("sessions", {
      userId: args.userId,
      tokenHash: args.tokenHash,
      createdAt: ts,
      updatedAt: ts,
      expiresAt: ts + 30 * dayMs,
    });
    await ctx.db.patch(args.userId, { lastSignInAt: ts, updatedAt: ts });
    const freshUser = await ctx.db.get(args.userId);
    return {
      session: {
        user: userToClient(freshUser),
        expires_at: new Date(ts + 30 * dayMs).toISOString(),
      },
    };
  },
});

export const getSession = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.union(v.null(), v.object({ session: v.any() })),
  handler: async (ctx, args) => {
    const user = await getUserBySessionHash(ctx, args.tokenHash);
    if (!user) return null;
    return { session: { user: userToClient(user) } };
  },
});

export const deleteSession = internalMutation({
  args: { tokenHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (session) await ctx.db.delete(session._id);
    return null;
  },
});

export const currentRole = internalQuery({
  args: { tokenHash: v.string() },
  returns: appRole,
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    return user.role || "user";
  },
});

export const adminListUsers = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireAdminUser(ctx, args.tokenHash);
    const users = await ctx.db.query("users").collect();
    return users
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((user) => ({
        user_id: user._id,
        email: user.email,
        created_at: new Date(user.createdAt).toISOString(),
        last_sign_in_at: user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : null,
        role: user.role || "user",
      }));
  },
});

export const adminSetUserRole = internalMutation({
  args: {
    tokenHash: v.string(),
    targetUserId: v.id("users"),
    nextRole: appRole,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireAdminUser(ctx, args.tokenHash);
    if (args.nextRole === "dev") throw new Error("Rola dev nie może być ustawiana z panelu.");
    const target = await ctx.db.get(args.targetUserId);
    if (!target) throw new Error("Nie znaleziono użytkownika.");
    const current = target.role || "user";
    if (current === "dev") throw new Error("Nie można zmieniać roli konta dev.");
    if (actor.role === "admin" && !(current === "user" && args.nextRole === "admin")) {
      throw new Error("Admin może tylko promować user -> admin.");
    }
    if (actor.role === "dev") {
      const allowed = (current === "user" && args.nextRole === "admin") || (current === "admin" && args.nextRole === "user");
      if (!allowed) throw new Error("Dev może wykonywać tylko user -> admin albo admin -> user.");
    }
    await ctx.db.patch(args.targetUserId, { role: args.nextRole, updatedAt: now() });
    return null;
  },
});

export const fetchMyProfile = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    return profileToClient(user);
  },
});

export const updateMyUsername = internalMutation({
  args: { tokenHash: v.string(), username: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    const username = normalizeUsername(args.username);
    if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
      throw new Error("Nazwa użytkownika musi mieć 3-24 znaki: a-z, 0-9, _, . lub -.");
    }
    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (existing && String(existing._id) !== String(user._id)) {
      throw new Error("Ta nazwa użytkownika jest już zajęta.");
    }
    await ctx.db.patch(user._id, { username, updatedAt: now() });

    const owned = await ctx.db
      .query("sharedDecks")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
      .collect();
    await Promise.all(owned.map((row) => ctx.db.patch(row._id, { ownerUsername: username, updatedAt: now() })));
    return profileToClient({ ...user, username, updatedAt: now() });
  },
});

export const fetchAllUserStorage = internalQuery({
  args: { tokenHash: v.string(), userId: v.id("users") },
  returns: v.array(v.object({ key: v.string(), value: v.any() })),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    if (String(user._id) !== String(args.userId)) throw new Error("Brak uprawnień do tego magazynu.");
    const rows = await ctx.db
      .query("userStorage")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return rows.map((row) => ({ key: row.key, value: row.value }));
  },
});

export const upsertUserStorage = internalMutation({
  args: { tokenHash: v.string(), userId: v.id("users"), key: v.string(), value: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    if (String(user._id) !== String(args.userId)) throw new Error("Brak uprawnień do tego magazynu.");
    const existing = await ctx.db
      .query("userStorage")
      .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
      .unique();
    const ts = now();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: ts });
    } else {
      await ctx.db.insert("userStorage", { userId: args.userId, key: args.key, value: args.value, createdAt: ts, updatedAt: ts });
    }
    return null;
  },
});

export const deleteUserStorageKeys = internalMutation({
  args: { tokenHash: v.string(), userId: v.id("users"), keys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    if (String(user._id) !== String(args.userId)) throw new Error("Brak uprawnień do tego magazynu.");
    for (const key of args.keys) {
      const existing = await ctx.db
        .query("userStorage")
        .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", key))
        .unique();
      if (existing) await ctx.db.delete(existing._id);
    }
    return null;
  },
});

export const fetchPublicDecks = internalQuery({
  args: { includeArchived: v.boolean() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("publicDecks").collect();
    return rows
      .filter((row) => args.includeArchived || row.isArchived !== true)
      .sort((a, b) => a.name.localeCompare(b.name, "pl"))
      .map(publicDeckToClient);
  },
});

export const upsertPublicDeck = internalMutation({
  args: { tokenHash: v.string(), deck: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await requireAdminUser(ctx, args.tokenHash);
    const deck = args.deck || {};
    const deckId = String(deck.id || "").trim();
    if (!deckId) throw new Error("Brak identyfikatora talii.");
    const existing = await ctx.db
      .query("publicDecks")
      .withIndex("by_deck_id", (q) => q.eq("deckId", deckId))
      .unique();
    const ts = now();
    const patch = {
      deckId,
      name: String(deck.name || deckId),
      description: String(deck.description || ""),
      deckGroup: deck.deck_group ?? null,
      categories: deck.categories ?? null,
      questions: Array.isArray(deck.questions) ? deck.questions : [],
      questionCount: Number(deck.question_count) || (Array.isArray(deck.questions) ? deck.questions.length : 0),
      version: Number(deck.version) || 1,
      source: String(deck.source || "public-db"),
      isArchived: deck.is_archived === true,
      updatedBy: user._id,
      updatedAt: ts,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return publicDeckToClient({ ...existing, ...patch });
    }
    const id = await ctx.db.insert("publicDecks", { ...patch, createdAt: ts });
    return publicDeckToClient(await ctx.db.get(id));
  },
});

export const archivePublicDeck = internalMutation({
  args: { tokenHash: v.string(), deckId: v.string(), isArchived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdminUser(ctx, args.tokenHash);
    const row = await ctx.db
      .query("publicDecks")
      .withIndex("by_deck_id", (q) => q.eq("deckId", args.deckId))
      .unique();
    if (row) await ctx.db.patch(row._id, { isArchived: args.isArchived, updatedAt: now() });
    return null;
  },
});

export const fetchPublicDeckVisibility = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const rows = await ctx.db.query("publicDeckVisibility").collect();
    return rows.sort((a, b) => a.deckId.localeCompare(b.deckId)).map(visibilityToClient);
  },
});

export const setPublicDeckVisibility = internalMutation({
  args: { tokenHash: v.string(), deckId: v.string(), isHidden: v.boolean() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const user = await requireAdminUser(ctx, args.tokenHash);
    const deckId = String(args.deckId || "").trim();
    if (!deckId) throw new Error("Brak identyfikatora talii.");
    const existing = await ctx.db
      .query("publicDeckVisibility")
      .withIndex("by_deck_id", (q) => q.eq("deckId", deckId))
      .unique();
    if (!args.isHidden) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const ts = now();
    const patch = { deckId, isHidden: true, updatedBy: user._id, updatedAt: ts };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return visibilityToClient({ ...existing, ...patch });
    }
    const id = await ctx.db.insert("publicDeckVisibility", { ...patch, createdAt: ts });
    return visibilityToClient(await ctx.db.get(id));
  },
});

export const searchSharedDecks = internalQuery({
  args: { query: v.string(), page: v.number(), pageSize: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const needle = String(args.query || "").trim().toLowerCase();
    const pageSize = Math.max(1, args.pageSize || 20);
    const page = Math.max(1, args.page || 1);
    const rows = (await ctx.db
      .query("sharedDecks")
      .withIndex("by_published_updated", (q) => q.eq("isPublished", true))
      .collect())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((row) => {
        if (!needle) return true;
        return `${row.name || ""} ${row.description || ""}`.toLowerCase().includes(needle);
      });
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize).map(sharedDeckToClient), total: rows.length, page, pageSize };
  },
});

export const publishSharedDeck = internalMutation({
  args: { tokenHash: v.string(), deck: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    const deck = args.deck || {};
    const sharedDeckId = String(deck.id || "").trim();
    if (!sharedDeckId) throw new Error("Brak identyfikatora udostępnionej talii.");
    const sourceDeckId = String(deck.source_deck_id || "").trim();
    if (!sourceDeckId) throw new Error("Brak identyfikatora źródłowej talii.");
    const existingByOwnerSource = await ctx.db
      .query("sharedDecks")
      .withIndex("by_owner_source", (q) => q.eq("ownerUserId", user._id).eq("sourceDeckId", sourceDeckId))
      .unique();
    const existingById = await ctx.db
      .query("sharedDecks")
      .withIndex("by_shared_deck_id", (q) => q.eq("sharedDeckId", sharedDeckId))
      .unique();
    const existing = existingByOwnerSource || existingById;
    if (existing && String(existing.ownerUserId) !== String(user._id)) {
      throw new Error("Ten identyfikator udostępnionej talii jest już zajęty.");
    }
    const ts = now();
    const patch = {
      sharedDeckId,
      ownerUserId: user._id,
      ownerUsername: user.username || "unknown",
      sourceDeckId,
      name: String(deck.name || sourceDeckId),
      description: String(deck.description || ""),
      deckGroup: deck.deck_group ?? null,
      categories: deck.categories ?? null,
      questions: Array.isArray(deck.questions) ? deck.questions : [],
      questionCount: Number(deck.question_count) || (Array.isArray(deck.questions) ? deck.questions.length : 0),
      isPublished: true,
      updatedAt: ts,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return sharedDeckToClient({ ...existing, ...patch });
    }
    const id = await ctx.db.insert("sharedDecks", { ...patch, createdAt: ts });
    return sharedDeckToClient(await ctx.db.get(id));
  },
});

export const unpublishSharedDeck = internalMutation({
  args: { tokenHash: v.string(), sharedDeckId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    const row = await ctx.db
      .query("sharedDecks")
      .withIndex("by_shared_deck_id", (q) => q.eq("sharedDeckId", args.sharedDeckId))
      .unique();
    if (!row || String(row.ownerUserId) !== String(user._id)) throw new Error("Nie znaleziono własnej talii.");
    const patch = { isPublished: false, updatedAt: now() };
    await ctx.db.patch(row._id, patch);
    return sharedDeckToClient({ ...row, ...patch });
  },
});

export const fetchMySubscriptions = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    const subs = await ctx.db
      .query("sharedDeckSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const rows = [];
    for (const sub of subs.sort((a, b) => b.createdAt - a.createdAt)) {
      const deck = await ctx.db
        .query("sharedDecks")
        .withIndex("by_shared_deck_id", (q) => q.eq("sharedDeckId", sub.sharedDeckId))
        .unique();
      rows.push({
        user_id: sub.userId,
        shared_deck_id: sub.sharedDeckId,
        created_at: new Date(sub.createdAt).toISOString(),
        shared_decks: deck ? sharedDeckToClient(deck) : null,
      });
    }
    return rows;
  },
});

export const subscribeToSharedDeck = internalMutation({
  args: { tokenHash: v.string(), sharedDeckId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    const deck = await ctx.db
      .query("sharedDecks")
      .withIndex("by_shared_deck_id", (q) => q.eq("sharedDeckId", args.sharedDeckId))
      .unique();
    if (!deck || !deck.isPublished) throw new Error("Talia nie jest dostępna.");
    if (String(deck.ownerUserId) === String(user._id)) throw new Error("Nie możesz subskrybować własnej talii.");
    const existing = await ctx.db
      .query("sharedDeckSubscriptions")
      .withIndex("by_user_shared", (q) => q.eq("userId", user._id).eq("sharedDeckId", args.sharedDeckId))
      .unique();
    if (existing) {
      return { user_id: user._id, shared_deck_id: args.sharedDeckId, created_at: new Date(existing.createdAt).toISOString() };
    }
    const ts = now();
    await ctx.db.insert("sharedDeckSubscriptions", { userId: user._id, sharedDeckId: args.sharedDeckId, createdAt: ts });
    return { user_id: user._id, shared_deck_id: args.sharedDeckId, created_at: new Date(ts).toISOString() };
  },
});

export const unsubscribeFromSharedDeck = internalMutation({
  args: { tokenHash: v.string(), sharedDeckId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    const existing = await ctx.db
      .query("sharedDeckSubscriptions")
      .withIndex("by_user_shared", (q) => q.eq("userId", user._id).eq("sharedDeckId", args.sharedDeckId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

export const fetchAnswerVoteSummary = internalQuery({
  args: {
    tokenHash: v.optional(v.string()),
    targetScope: v.union(v.literal("public"), v.literal("shared")),
    targetDeckId: v.string(),
    questionIds: v.array(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const user = args.tokenHash ? await getUserBySessionHash(ctx, args.tokenHash) : null;
    const allowed = await canAccessAnswerVoteTarget(ctx, user, args.targetScope, args.targetDeckId);
    if (!allowed) throw new Error("Brak uprawnień do tej talii.");
    const questionSet = new Set(args.questionIds);
    const rows = [];
    for (const questionId of questionSet) {
      const votes = await ctx.db
        .query("answerVotes")
        .withIndex("by_target_question", (q) =>
          q.eq("targetScope", args.targetScope).eq("targetDeckId", args.targetDeckId).eq("questionId", questionId)
        )
        .collect();
      const byAnswer = new Map();
      for (const vote of votes) {
        const current = byAnswer.get(vote.answerId) || { plus_count: 0, minus_count: 0, user_vote: 0 };
        if (vote.vote === 1) current.plus_count += 1;
        if (vote.vote === -1) current.minus_count += 1;
        if (user && String(vote.userId) === String(user._id)) current.user_vote = vote.vote;
        byAnswer.set(vote.answerId, current);
      }
      for (const [answerId, counts] of byAnswer.entries()) {
        rows.push({ question_id: questionId, answer_id: answerId, ...counts });
      }
    }
    return rows.sort((a, b) => `${a.question_id}:${a.answer_id}`.localeCompare(`${b.question_id}:${b.answer_id}`));
  },
});

export const setAnswerVote = internalMutation({
  args: {
    tokenHash: v.string(),
    targetScope: v.union(v.literal("public"), v.literal("shared")),
    targetDeckId: v.string(),
    questionId: v.string(),
    answerId: v.string(),
    vote: v.union(v.literal(-1), v.literal(0), v.literal(1)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUserBySessionHash(ctx, args.tokenHash);
    const allowed = await canAccessAnswerVoteTarget(ctx, user, args.targetScope, args.targetDeckId);
    if (!allowed) throw new Error("Brak uprawnień do tej talii.");
    const existing = await ctx.db
      .query("answerVotes")
      .withIndex("by_vote_key", (q) =>
        q.eq("targetScope", args.targetScope)
          .eq("targetDeckId", args.targetDeckId)
          .eq("questionId", args.questionId)
          .eq("answerId", args.answerId)
          .eq("userId", user._id)
      )
      .unique();
    if (args.vote === 0) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const ts = now();
    const patch = {
      targetScope: args.targetScope,
      targetDeckId: args.targetDeckId,
      questionId: args.questionId,
      answerId: args.answerId,
      userId: user._id,
      vote: args.vote,
      updatedAt: ts,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("answerVotes", { ...patch, createdAt: ts });
    }
    return null;
  },
});
