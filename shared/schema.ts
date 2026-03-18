import { pgTable, text, integer, boolean, jsonb, serial, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Platforms ──────────────────────────────────────────────────────────────────
export const platforms = pgTable("platforms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  username: text("username").notNull().default(""),
  password: text("password").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  has2fa: boolean("has_2fa").notNull().default(false),
  notes: text("notes").notNull().default(""),
  category: text("category").notNull().default("Software"),
  lastChecked: text("last_checked"),
  lastInvoiceAmount: real("last_invoice_amount"),
  lastInvoiceCurrency: text("last_invoice_currency"),
});

export const insertPlatformSchema = createInsertSchema(platforms).omit({ id: true });
export type InsertPlatform = z.infer<typeof insertPlatformSchema>;
export type Platform = typeof platforms.$inferSelect;

// ── Statements (uploaded PDFs) ─────────────────────────────────────────────────
export const statements = pgTable("statements", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  month: text("month").notNull(),
  transactions: jsonb("transactions").$type<Transaction[]>().notNull().default([]),
});

export const insertStatementSchema = createInsertSchema(statements).omit({ id: true });
export type InsertStatement = z.infer<typeof insertStatementSchema>;
export type Statement = typeof statements.$inferSelect;

// ── Reconciliation results ─────────────────────────────────────────────────────
export const reconciliations = pgTable("reconciliations", {
  id: serial("id").primaryKey(),
  statementId: integer("statement_id").notNull(),
  createdAt: text("created_at").notNull(),
  platformResults: jsonb("platform_results").$type<PlatformResult[]>().notNull().default([]),
  missingReceipts: jsonb("missing_receipts").$type<Transaction[]>().notNull().default([]),
  totalMatched: integer("total_matched").notNull().default(0),
  totalUnmatched: integer("total_unmatched").notNull().default(0),
});

export const insertReconciliationSchema = createInsertSchema(reconciliations).omit({ id: true });
export type InsertReconciliation = z.infer<typeof insertReconciliationSchema>;
export type Reconciliation = typeof reconciliations.$inferSelect;

// ── Match Rules (learned mappings) ───────────────────────────────────────────
// Stores confirmed matches: "PADDLE.NET*X" → platformId 5
export const matchRules = pgTable("match_rules", {
  id: serial("id").primaryKey(),
  platformId: integer("platform_id").notNull(),
  platformName: text("platform_name").notNull(),
  // The description pattern seen on the credit card statement
  cardPattern: text("card_pattern").notNull(),
  // Optional: payment processor alias (e.g. "paddle", "stripe")
  processorAlias: text("processor_alias"),
  confirmedAt: text("confirmed_at").notNull(),
});

export const insertMatchRuleSchema = createInsertSchema(matchRules).omit({ id: true });
export type InsertMatchRule = z.infer<typeof insertMatchRuleSchema>;
export type MatchRule = typeof matchRules.$inferSelect;

// ── Shared types ───────────────────────────────────────────────────────────────
export interface Transaction {
  date: string;
  description: string;
  amount: number;
  currency: string;
  matched?: boolean;
  matchedPlatform?: string;
  category?: string;
}

export type PlatformStatus = "matched" | "fuzzy_match" | "no_invoice" | "needs_manual" | "pending" | "waiting_2fa";

export interface PlatformResult {
  platformId: number;
  platformName: string;
  platformUrl: string;
  status: PlatformStatus;
  invoiceAmount?: number;
  invoiceCurrency?: string;
  invoiceAmountChf?: number;       // converted to CHF for comparison
  matchedTransaction?: Transaction;
  matchConfidence?: number;        // 0-100
  matchReason?: string;            // e.g. "Betrag übereinstimmung (USD 52.00 = CHF 47.20)"
  needsConfirmation?: boolean;     // fuzzy match waiting for user confirm
  notes?: string;
}
