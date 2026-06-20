import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const role = v.union(v.literal("user"), v.literal("admin"), v.literal("dev"));

export default defineSchema({
  users: defineTable({
    email: v.string(),
    passwordSalt: v.string(),
    passwordHash: v.string(),
    role,
    username: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSignInAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_username", ["username"])
    .index("by_role", ["role"]),

  sessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user", ["userId"]),

  oauthStates: defineTable({
    stateHash: v.string(),
    redirectTo: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_state_hash", ["stateHash"])
    .index("by_expires_at", ["expiresAt"]),

  userStorage: defineTable({
    userId: v.id("users"),
    key: v.string(),
    value: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_key", ["userId", "key"]),

  publicDecks: defineTable({
    deckId: v.string(),
    name: v.string(),
    description: v.string(),
    deckGroup: v.optional(v.union(v.string(), v.null())),
    categories: v.optional(v.any()),
    questions: v.array(v.any()),
    questionCount: v.number(),
    version: v.number(),
    source: v.string(),
    isArchived: v.boolean(),
    updatedBy: v.optional(v.union(v.id("users"), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_deck_id", ["deckId"])
    .index("by_archived_name", ["isArchived", "name"]),

  publicDeckVisibility: defineTable({
    deckId: v.string(),
    isHidden: v.boolean(),
    updatedBy: v.optional(v.union(v.id("users"), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_deck_id", ["deckId"])
    .index("by_hidden", ["isHidden"]),

  imageAssets: defineTable({
    assetId: v.string(),
    contentType: v.string(),
    data: v.string(),
    byteLength: v.number(),
    createdBy: v.optional(v.union(v.id("users"), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_asset_id", ["assetId"])
    .index("by_created_by", ["createdBy"]),

  sharedDecks: defineTable({
    sharedDeckId: v.string(),
    ownerUserId: v.id("users"),
    ownerUsername: v.string(),
    sourceDeckId: v.string(),
    name: v.string(),
    description: v.string(),
    deckGroup: v.optional(v.union(v.string(), v.null())),
    categories: v.optional(v.any()),
    questions: v.array(v.any()),
    questionCount: v.number(),
    isPublished: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_shared_deck_id", ["sharedDeckId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_source", ["ownerUserId", "sourceDeckId"])
    .index("by_published_updated", ["isPublished", "updatedAt"]),

  sharedDeckSubscriptions: defineTable({
    userId: v.id("users"),
    sharedDeckId: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_shared", ["userId", "sharedDeckId"])
    .index("by_shared", ["sharedDeckId"]),

  answerVotes: defineTable({
    targetScope: v.union(v.literal("public"), v.literal("shared")),
    targetDeckId: v.string(),
    questionId: v.string(),
    answerId: v.string(),
    userId: v.id("users"),
    vote: v.union(v.literal(-1), v.literal(1)),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_vote_key", ["targetScope", "targetDeckId", "questionId", "answerId", "userId"])
    .index("by_target_question", ["targetScope", "targetDeckId", "questionId"])
    .index("by_target_answer", ["targetScope", "targetDeckId", "questionId", "answerId"])
    .index("by_user_target_question", ["userId", "targetScope", "targetDeckId", "questionId"]),
});
