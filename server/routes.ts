import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { storage } from "./storage";
import { InsertPlatform, InsertStatement, Transaction, PlatformResult, MatchRule } from "@shared/schema";
import { performAutoLogin, verify2FA } from "./auto-login";
import { startAppleLogin, verifyApple2FA, fetchAppleReceipts, closeAppleSession } from "./apple-receipts";
import { connectEmail, scanEmailsForTransactions, closeEmailSession, IMAP_PRESETS } from "./email-scanner";
import { DESKTOP_APPS, loginDesktopApp, verifyDesktop2FA, fetchDesktopReceipts, closeDesktopSession } from "./desktop-receipts";

// ── Currency conversion (live rates via open API) ──────────────────────────────
// Cache rates for the session to avoid hitting the API too often
const fxCache: Record<string, { rate: number; ts: number }> = {};

async function convertToChf(amount: number, currency: string): Promise<number> {
  if (currency === "CHF") return amount;
  const key = currency.toUpperCase();
  const now = Date.now();
  // Refresh cache every 6 hours
  if (!fxCache[key] || now - fxCache[key].ts > 6 * 3600 * 1000) {
    try {
      const res = await fetch(`https://api.frankfurter.app/latest?from=${key}&to=CHF`);
      const data = await res.json() as any;
      fxCache[key] = { rate: data.rates?.CHF ?? 1, ts: now };
    } catch {
      // Fallback static rates if API fails
      const fallback: Record<string, number> = { USD: 0.906, EUR: 0.975, GBP: 1.14 };
      fxCache[key] = { rate: fallback[key] ?? 1, ts: now };
    }
  }
  return Math.round(amount * fxCache[key].rate * 100) / 100;
}

const upload = multer({ dest: "/tmp/uploads/" });

// ── PDF text extraction (pure JS, no native deps) ──────────────────────────────
async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    // Dynamic import to avoid issues
    const pdfParse = await import("pdf-parse").then(m => m.default || m);
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (e) {
    console.error("PDF parse error:", e);
    return "";
  }
}

// ── Smart transaction parser ───────────────────────────────────────────────────
function parseTransactionsFromText(text: string): Transaction[] {
  const transactions: Transaction[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // Common Swiss bank statement patterns
  // PostFinance, Raiffeisen, ZKB, UBS, Credit Suisse
  // Pattern: date | description | amount
  const patterns = [
    // PostFinance: "01.02.2025 Description CHF 12.50"
    /(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+(CHF|EUR|USD)\s+([\d'.,]+)/i,
    // "2025-02-01 Description 12.50 CHF"
    /(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([\d'.,]+)\s+(CHF|EUR|USD)/i,
    // Raiffeisen: "01.02.25 Description -12.50"
    /(\d{2}\.\d{2}\.\d{2})\s+(.+?)\s+(-?[\d'.,]+)/,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        let date = match[1];
        let description = match[2].trim();
        let currency = "CHF";
        let amount: number;

        if (match[4] && /CHF|EUR|USD/i.test(match[4])) {
          // Pattern 2: amount before currency
          amount = parseFloat(match[3].replace(/'/g, "").replace(",", "."));
          currency = match[4].toUpperCase();
        } else if (match[3] && /CHF|EUR|USD/i.test(match[3])) {
          // Pattern 1: currency before amount
          currency = match[3].toUpperCase();
          amount = parseFloat(match[4].replace(/'/g, "").replace(",", "."));
        } else {
          amount = parseFloat(match[3].replace(/'/g, "").replace(",", "."));
        }

        if (!isNaN(amount) && Math.abs(amount) > 0) {
          transactions.push({
            date,
            description,
            amount: Math.abs(amount),
            currency,
            matched: false,
            category: categorizeTransaction(description),
          });
          break;
        }
      }
    }
  }

  // Fallback: extract any line with a CHF amount
  if (transactions.length === 0) {
    for (const line of lines) {
      const match = line.match(/([\d]{1,2}[.\/]\d{1,2}[.\/]\d{2,4}).*?([\d'.,]+)\s*(CHF|EUR|USD)?/i);
      if (match) {
        const amount = parseFloat(match[2].replace(/'/g, "").replace(",", "."));
        if (!isNaN(amount) && amount > 0.5 && amount < 100000) {
          transactions.push({
            date: match[1],
            description: line.substring(0, 80),
            amount,
            currency: match[3]?.toUpperCase() || "CHF",
            matched: false,
            category: categorizeTransaction(line),
          });
        }
      }
    }
  }

  return transactions;
}

function categorizeTransaction(description: string): string {
  const d = description.toLowerCase();
  if (/tank|petrol|shell|avia|migrol|bp |esso|coop presto/i.test(d)) return "Tanken";
  if (/uber eats|lieferando|just eat|domino|pizza|restaurant|café|bistro|mcdo|burger|sushi/i.test(d)) return "Essen";
  if (/elevenlabs|eleven labs/i.test(d)) return "ElevenLabs";
  if (/moco|mocoapp/i.test(d)) return "Mocoapp";
  if (/blackmagic|davinci/i.test(d)) return "Blackmagic";
  if (/wetransfer|we transfer/i.test(d)) return "WeTransfer";
  if (/mailchimp/i.test(d)) return "Mailchimp";
  if (/musicbed/i.test(d)) return "Musicbed";
  if (/higgsfield/i.test(d)) return "Higgsfield";
  if (/google/i.test(d)) return "Google";
  if (/claude|anthropic/i.test(d)) return "Claude";
  if (/galaxus/i.test(d)) return "Galaxus";
  if (/digitec/i.test(d)) return "Digitec";
  if (/facebook|meta |instagram/i.test(d)) return "Facebook Ads";
  if (/spotify|netflix|disney|apple/i.test(d)) return "Abo/Streaming";
  if (/train|sbb|cff|bls|postauto/i.test(d)) return "Reise";
  return "Sonstiges";
}

// ── Known payment processor aliases ─────────────────────────────────────────────────
const PROCESSOR_KEYWORDS = [
  "paddle", "stripe", "paypal", "braintree", "adyen", "mollie",
  "fastspring", "gumroad", "lemonsqueezy", "lemon squeezy",
  "recurly", "chargebee", "zuora", "2checkout", "cleverbridge",
];

// Known platform name → card keywords map
const PLATFORM_KEYWORDS: Record<string, string[]> = {
  "ElevenLabs": ["elevenlabs", "eleven labs", "eleven-labs"],
  "Mocoapp": ["moco", "mocoapp"],
  "Blackmagic Design": ["blackmagic", "davinci", "blackmagicdesign"],
  "WeTransfer": ["wetransfer", "we transfer"],
  "Mailchimp": ["mailchimp", "intuit mailchimp"],
  "Musicbed": ["musicbed", "music bed"],
  "Higgsfield AI": ["higgsfield"],
  "Google One": ["google", "google one"],
  "Claude.ai": ["claude", "anthropic"],
  "Galaxus": ["galaxus"],
  "Digitec": ["digitec"],
  "Facebook Ads": ["facebook", "meta ", "instagram ads", "fb ads"],
  "Soundly": ["soundly"],
};

// Parse a date string (various formats) to a Date object
function parseDate(s: string): Date | null {
  // DD.MM.YYYY
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  // DD.MM.YY
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (m) return new Date(2000 + +m[3], +m[2] - 1, +m[1]);
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function daysDiff(a: string, b: string): number {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return 999;
  return Math.abs((da.getTime() - db.getTime()) / 86400000);
}

// ── Smart reconciliation matching ─────────────────────────────────────────────
async function matchTransactionsToPlatforms(
  transactions: Transaction[],
  platforms: Awaited<ReturnType<typeof storage.getPlatforms>>,
  matchRules: MatchRule[]
): Promise<{ platformResults: PlatformResult[]; missingReceipts: Transaction[] }> {
  // Pre-convert all transaction amounts to CHF for comparison
  const txChf: number[] = await Promise.all(
    transactions.map(tx => convertToChf(tx.amount, tx.currency))
  );

  const used = new Set<number>();
  const platformResults: PlatformResult[] = [];

  for (const platform of platforms.filter(p => p.isActive)) {
    const keywords = [
      ...(PLATFORM_KEYWORDS[platform.name] || [platform.name.toLowerCase()]),
      // Add learned card patterns from match rules
      ...matchRules.filter(r => r.platformId === platform.id).map(r => r.cardPattern.toLowerCase()),
    ];

    // --- Pass 1: Exact name match (high confidence)
    let bestIdx = -1;
    let bestScore = 0;
    let bestReason = "";

    transactions.forEach((tx, i) => {
      if (used.has(i)) return;
      const desc = tx.description.toLowerCase();
      if (keywords.some(kw => desc.includes(kw))) {
        // Boost score if amount also matches a known invoice
        const score = 90;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
          bestReason = `Name übereinstimmung: «${tx.description}»`;
        }
      }
    });

    // --- Pass 2: Amount-based matching (fuzzy, name may differ)
    // Only run if no name match found, or to boost confidence
    if (platform.lastInvoiceAmount && platform.lastInvoiceCurrency) {
      const invoiceChf = await convertToChf(platform.lastInvoiceAmount, platform.lastInvoiceCurrency);
      transactions.forEach((tx, i) => {
        if (used.has(i)) return;
        const cardAmtChf = txChf[i];
        const pctDiff = Math.abs(cardAmtChf - invoiceChf) / invoiceChf;
        if (pctDiff <= 0.02) { // within 2%
          const score = bestIdx === i ? 98 : 75; // higher if also name-matched
          if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
            bestReason = `Betrag übereinstimmung: ${tx.currency} ${tx.amount} ≈ CHF ${invoiceChf.toFixed(2)}`;
          }
        }
      });
    }

    // --- Pass 3: Amount-only match against all transactions (no prior invoice known)
    // Look for transactions where amount in CHF is plausible and processor is known
    if (bestIdx === -1) {
      transactions.forEach((tx, i) => {
        if (used.has(i)) return;
        const desc = tx.description.toLowerCase();
        const isViaProcessor = PROCESSOR_KEYWORDS.some(p => desc.includes(p));
        if (isViaProcessor) {
          // Can't determine platform from amount alone without prior data
          // Mark as needs_manual but score low
        }
      });
    }

    if (bestIdx >= 0) {
      const tx = transactions[bestIdx];
      const chfAmt = txChf[bestIdx];
      used.add(bestIdx);
      const isFuzzy = bestScore < 90;
      platformResults.push({
        platformId: platform.id,
        platformName: platform.name,
        platformUrl: platform.url,
        status: isFuzzy ? "fuzzy_match" : "matched",
        invoiceAmount: tx.amount,
        invoiceCurrency: tx.currency,
        invoiceAmountChf: chfAmt,
        matchedTransaction: tx,
        matchConfidence: bestScore,
        matchReason: bestReason,
        needsConfirmation: isFuzzy,
      });
    } else {
      platformResults.push({
        platformId: platform.id,
        platformName: platform.name,
        platformUrl: platform.url,
        status: "no_invoice",
        notes: "Kein passender Eintrag in der Abrechnung gefunden",
        matchConfidence: 0,
      });
    }
  }

  // Remaining unmatched transactions = missing receipts
  const missingReceipts = transactions.filter((_, i) => !used.has(i));
  return { platformResults, missingReceipts };
}

export async function registerRoutes(httpServer: Server, app: Express) {
  // ── Platforms ──────────────────────────────────────────────────────────────
  app.get("/api/platforms", async (_req, res) => {
    const platforms = await storage.getPlatforms();
    res.json(platforms);
  });

  app.post("/api/platforms", async (req, res) => {
    const data = req.body as InsertPlatform;
    const platform = await storage.createPlatform(data);
    res.json(platform);
  });

  app.put("/api/platforms/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const updated = await storage.updatePlatform(id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/platforms/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const ok = await storage.deletePlatform(id);
    res.json({ success: ok });
  });

  // ── Statements (PDF upload) ────────────────────────────────────────────────
  app.get("/api/statements", async (_req, res) => {
    res.json(await storage.getStatements());
  });

  app.post("/api/statements/upload", upload.single("file"), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "Keine Datei hochgeladen" });

    const text = await extractTextFromPDF(req.file.path);
    const transactions = parseTransactionsFromText(text);

    // Cleanup temp file
    try { fs.unlinkSync(req.file.path); } catch {}

    // Guess month from filename or current date
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const statement = await storage.createStatement({
      filename: req.file.originalname,
      uploadedAt: new Date().toISOString(),
      month,
      transactions: transactions as any,
    });

    res.json({ statement, transactionCount: transactions.length, rawTextPreview: text.substring(0, 500) });
  });

  app.delete("/api/statements/:id", async (req, res) => {
    await storage.deleteStatement(parseInt(req.params.id));
    res.json({ success: true });
  });

  // ── Reconciliation ─────────────────────────────────────────────────────────
  app.post("/api/reconcile/:statementId", async (req, res) => {
    const statementId = parseInt(req.params.statementId);
    const statement = await storage.getStatement(statementId);
    if (!statement) return res.status(404).json({ error: "Statement nicht gefunden" });

    const platforms = await storage.getPlatforms();
    const transactions = statement.transactions as Transaction[];

    const matchRules = await storage.getMatchRules();
    const { platformResults, missingReceipts } = await matchTransactionsToPlatforms(transactions, platforms, matchRules);

    const totalMatched = platformResults.filter(r => r.status === "matched").length;
    const totalUnmatched = missingReceipts.length;

    // Remove old reconciliation for this statement if exists
    const existing = await storage.getReconciliationByStatement(statementId);
    if (existing) {
      await storage.updateReconciliation(existing.id, {
        createdAt: new Date().toISOString(),
        platformResults: platformResults as any,
        missingReceipts: missingReceipts as any,
        totalMatched,
        totalUnmatched,
      });
      return res.json(await storage.getReconciliation(existing.id));
    }

    const reconciliation = await storage.createReconciliation({
      statementId,
      createdAt: new Date().toISOString(),
      platformResults: platformResults as any,
      missingReceipts: missingReceipts as any,
      totalMatched,
      totalUnmatched,
    });

    res.json(reconciliation);
  });

  app.get("/api/reconciliations", async (_req, res) => {
    res.json(await storage.getReconciliations());
  });

  app.get("/api/reconciliations/:id", async (req, res) => {
    const r = await storage.getReconciliation(parseInt(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  });

  // Manual override: mark platform result
  app.put("/api/reconciliations/:id/platform/:platformId", async (req, res) => {
    const r = await storage.getReconciliation(parseInt(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });

    const results = r.platformResults as PlatformResult[];
    const idx = results.findIndex(p => p.platformId === parseInt(req.params.platformId));
    if (idx === -1) return res.status(404).json({ error: "Platform not in reconciliation" });

    results[idx] = { ...results[idx], ...req.body };
    await storage.updateReconciliation(r.id, { platformResults: results as any });
    res.json(results[idx]);
  });

  // ── Match Rules (learned mappings) ───────────────────────────────────────────
  app.get("/api/match-rules", async (_req, res) => {
    res.json(await storage.getMatchRules());
  });

  // Save a confirmed fuzzy match as a rule for future use
  app.post("/api/match-rules", async (req, res) => {
    const { platformId, platformName, cardPattern, processorAlias } = req.body;
    if (!platformId || !platformName || !cardPattern)
      return res.status(400).json({ error: "platformId, platformName, cardPattern erforderlich" });
    const rule = await storage.createMatchRule({
      platformId, platformName, cardPattern,
      processorAlias: processorAlias || null,
      confirmedAt: new Date().toISOString(),
    });
    res.json(rule);
  });

  app.delete("/api/match-rules/:id", async (req, res) => {
    await storage.deleteMatchRule(parseInt(req.params.id));
    res.json({ success: true });
  });

  // Confirm a fuzzy match: sets status to matched + saves rule
  app.post("/api/reconciliations/:id/confirm-match/:platformId", async (req, res) => {
    const r = await storage.getReconciliation(parseInt(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });

    const results = r.platformResults as PlatformResult[];
    const idx = results.findIndex(p => p.platformId === parseInt(req.params.platformId));
    if (idx === -1) return res.status(404).json({ error: "Platform not in reconciliation" });

    const result = results[idx];
    // Save the card description pattern as a learned rule
    if (result.matchedTransaction?.description) {
      await storage.createMatchRule({
        platformId: result.platformId,
        platformName: result.platformName,
        cardPattern: result.matchedTransaction.description,
        processorAlias: null,
        confirmedAt: new Date().toISOString(),
      });
    }
    // Mark as confirmed matched
    results[idx] = { ...result, status: "matched", needsConfirmation: false, matchConfidence: 100 };
    await storage.updateReconciliation(r.id, { platformResults: results as any });
    res.json(results[idx]);
  });

  // Reject a fuzzy match suggestion
  app.post("/api/reconciliations/:id/reject-match/:platformId", async (req, res) => {
    const r = await storage.getReconciliation(parseInt(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });
    const results = r.platformResults as PlatformResult[];
    const idx = results.findIndex(p => p.platformId === parseInt(req.params.platformId));
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    results[idx] = { ...results[idx], status: "no_invoice", needsConfirmation: false, matchedTransaction: undefined, matchConfidence: 0, notes: "Manuell abgelehnt" };
    await storage.updateReconciliation(r.id, { platformResults: results as any });
    res.json(results[idx]);
  });

  // FX rate endpoint for frontend display
  app.get("/api/fx/:currency", async (req, res) => {
    const currency = req.params.currency.toUpperCase();
    const chfAmount = await convertToChf(1, currency);
    res.json({ currency, chfRate: chfAmount, timestamp: new Date().toISOString() });
  });

  // ── Auto-Login ──────────────────────────────────────────────────────────────
  app.post("/api/auto-login/:platformId", async (req, res) => {
    const platformId = parseInt(req.params.platformId);
    const result = await performAutoLogin(platformId);
    res.json(result);
  });

  app.post("/api/auto-login/:platformId/verify-2fa", async (req, res) => {
    const { code, sessionId } = req.body;
    if (!code || !sessionId) return res.status(400).json({ error: "Code und sessionId erforderlich" });
    const result = await verify2FA(sessionId, code);
    res.json(result);
  });

  // ── Apple "Report a Problem" ──────────────────────────────────────────────────

  // Detect Apple transactions in a reconciliation
  app.get("/api/apple/transactions/:reconciliationId", async (req, res) => {
    const recon = await storage.getReconciliation(parseInt(req.params.reconciliationId));
    if (!recon) return res.status(404).json({ error: "Not found" });

    const statement = await storage.getStatement(recon.statementId);
    if (!statement) return res.status(404).json({ error: "Statement not found" });

    const APPLE_KEYWORDS = [
      "apple", "itunes", "app store", "apple.com/bill", "apple music",
      "apple tv", "icloud", "apple one", "apple arcade", "apple news",
    ];

    const allTx = statement.transactions as Transaction[];
    const appleTx = allTx.filter(tx =>
      APPLE_KEYWORDS.some(kw => tx.description.toLowerCase().includes(kw))
    );

    res.json({ transactions: appleTx, count: appleTx.length });
  });

  // Start Apple login
  app.post("/api/apple/login", async (req, res) => {
    const { appleId, password } = req.body;
    if (!appleId || !password)
      return res.status(400).json({ error: "appleId und password erforderlich" });
    const result = await startAppleLogin(appleId, password);
    res.json(result);
  });

  // Submit Apple 2FA code
  app.post("/api/apple/verify-2fa", async (req, res) => {
    const { sessionId, code } = req.body;
    if (!sessionId || !code)
      return res.status(400).json({ error: "sessionId und code erforderlich" });
    const result = await verifyApple2FA(sessionId, code);
    res.json(result);
  });

  // Fetch receipts for specific transactions
  // Only processes transactions that match Apple keywords AND are on the credit card
  app.post("/api/apple/fetch-receipts", async (req, res) => {
    const { sessionId, reconciliationId } = req.body;
    if (!sessionId || !reconciliationId)
      return res.status(400).json({ error: "sessionId und reconciliationId erforderlich" });

    const recon = await storage.getReconciliation(parseInt(reconciliationId));
    if (!recon) return res.status(404).json({ error: "Abgleich nicht gefunden" });

    const statement = await storage.getStatement(recon.statementId);
    if (!statement) return res.status(404).json({ error: "Abrechnung nicht gefunden" });

    // CRITICAL: Only process Apple transactions that are on the credit card statement
    const APPLE_KEYWORDS = [
      "apple", "itunes", "app store", "apple.com", "apple music",
      "apple tv", "icloud", "apple one", "apple arcade",
    ];
    const allTx = statement.transactions as Transaction[];
    const appleTxOnCard = allTx.filter(tx =>
      APPLE_KEYWORDS.some(kw => tx.description.toLowerCase().includes(kw))
    );

    if (appleTxOnCard.length === 0) {
      return res.json({ results: [], message: "Keine Apple-Transaktionen auf der Kreditkarte" });
    }

    const results = await fetchAppleReceipts(sessionId, appleTxOnCard);
    res.json({ results });
  });

  // Close Apple session
  app.post("/api/apple/close", async (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) closeAppleSession(sessionId);
    res.json({ success: true });
  });

  // ── E-Mail Scanner ───────────────────────────────────────────────────────────

  // Get IMAP presets for common providers
  app.get("/api/email/presets", (_req, res) => {
    // Return presets without credentials
    const presets = Object.entries(IMAP_PRESETS).map(([id, cfg]) => ({
      id,
      label: id === "gmail" ? "Gmail" :
             id === "icloud" ? "iCloud Mail (Apple Mail)" :
             id === "outlook" ? "Outlook / Hotmail" :
             "Google Workspace",
      host: cfg.host,
      port: cfg.port,
      tls: cfg.tls,
    }));
    res.json({ presets });
  });

  // Connect to email account
  app.post("/api/email/connect", async (req, res) => {
    const { host, port, user, password, tls } = req.body;
    if (!host || !user || !password)
      return res.status(400).json({ error: "host, user und password erforderlich" });
    const result = await connectEmail({ host, port: port || 993, user, password, tls: tls !== false });
    res.json(result);
  });

  // Scan emails for transactions that are on the credit card
  // CRITICAL: Only returns emails matching credit card transactions
  app.post("/api/email/scan", async (req, res) => {
    const { sessionId, reconciliationId } = req.body;
    if (!sessionId || !reconciliationId)
      return res.status(400).json({ error: "sessionId und reconciliationId erforderlich" });

    const recon = await storage.getReconciliation(parseInt(reconciliationId));
    if (!recon) return res.status(404).json({ error: "Abgleich nicht gefunden" });

    const statement = await storage.getStatement(recon.statementId);
    if (!statement) return res.status(404).json({ error: "Abrechnung nicht gefunden" });

    // Only scan for transactions on the credit card
    const allTx = statement.transactions as Transaction[];

    const results = await scanEmailsForTransactions(sessionId, allTx);
    res.json({ results });
  });

  // Close email session
  app.post("/api/email/close", async (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) closeEmailSession(sessionId);
    res.json({ success: true });
  });

  // ── Desktop App Receipts ─────────────────────────────────────────────────────

  // List supported desktop apps
  app.get("/api/desktop/apps", (_req, res) => {
    res.json({ apps: DESKTOP_APPS });
  });

  // Login to a desktop app portal
  app.post("/api/desktop/login", async (req, res) => {
    const { appId, username, password } = req.body;
    if (!appId || !username || !password)
      return res.status(400).json({ error: "appId, username und password erforderlich" });
    const result = await loginDesktopApp(appId, username, password);
    res.json(result);
  });

  // Submit 2FA for desktop app
  app.post("/api/desktop/verify-2fa", async (req, res) => {
    const { sessionId, code } = req.body;
    if (!sessionId || !code)
      return res.status(400).json({ error: "sessionId und code erforderlich" });
    const result = await verifyDesktop2FA(sessionId, code);
    res.json(result);
  });

  // Fetch desktop app receipts for card-matched transactions
  app.post("/api/desktop/fetch-receipts", async (req, res) => {
    const { sessionId, reconciliationId } = req.body;
    if (!sessionId || !reconciliationId)
      return res.status(400).json({ error: "sessionId und reconciliationId erforderlich" });

    const recon = await storage.getReconciliation(parseInt(reconciliationId));
    if (!recon) return res.status(404).json({ error: "Abgleich nicht gefunden" });

    const statement = await storage.getStatement(recon.statementId);
    if (!statement) return res.status(404).json({ error: "Abrechnung nicht gefunden" });

    const allTx = statement.transactions as Transaction[];
    const results = await fetchDesktopReceipts(sessionId, allTx);
    res.json({ results });
  });

  // Close desktop session
  app.post("/api/desktop/close", async (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) closeDesktopSession(sessionId);
    res.json({ success: true });
  });

  // ── ZIP Download: alle abgeglichenen Belege als ZIP ──────────────────────────
  app.get("/api/reconciliations/:id/download-zip", async (req, res) => {
    const r = await storage.getReconciliation(parseInt(req.params.id));
    if (!r) return res.status(404).json({ error: "Abgleich nicht gefunden" });

    const statement = await storage.getStatement(r.statementId);
    const platformResults = r.platformResults as PlatformResult[];
    const matched = platformResults.filter(p =>
      p.status === "matched" && p.matchedTransaction
    );

    const month = statement?.month ?? new Date().toISOString().slice(0, 7);
    const zipName = `Belege_${month}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    // Create a human-readable summary CSV
    const csvLines = [
      "Plattform,Datum,Beschreibung,Betrag,Währung,Status",
      ...matched.map(p => {
        const tx = p.matchedTransaction!;
        return [
          `"${p.platformName}"`,
          `"${tx.date}"`,
          `"${tx.description.replace(/"/g, '""')}"`,
          tx.amount.toFixed(2),
          tx.currency,
          "Abgeglichen"
        ].join(",");
      }),
    ];
    archive.append(csvLines.join("\n"), { name: "Abgleich_Zusammenfassung.csv" });

    // Create a detailed HTML receipt for each matched platform
    for (const p of matched) {
      const tx = p.matchedTransaction!;
      const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <title>Beleg – ${p.platformName}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; color: #001F26; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .label { color: #666; font-size: 12px; text-transform: uppercase; margin-top: 16px; }
    .value { font-size: 16px; font-weight: bold; margin-top: 2px; }
    .amount { font-size: 28px; font-weight: bold; color: #004C5D; margin: 20px 0; }
    .footer { margin-top: 40px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 12px; }
    .badge { display: inline-block; background: #e6f9ef; color: #15803d; border-radius: 6px; padding: 3px 10px; font-size: 12px; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Beleg</h1>
  <span class="badge">✓ Abgeglichen</span>

  <div class="label">Plattform</div>
  <div class="value">${p.platformName}</div>

  <div class="label">Datum</div>
  <div class="value">${tx.date}</div>

  <div class="label">Beschreibung (Kreditkarte)</div>
  <div class="value">${tx.description}</div>

  <div class="label">Betrag</div>
  <div class="amount">${tx.amount.toFixed(2)} ${tx.currency}${p.invoiceAmountChf && tx.currency !== "CHF" ? ` (≈ CHF ${p.invoiceAmountChf.toFixed(2)})` : ""}</div>

  ${p.matchReason ? `<div class="label">Abgleich-Methode</div><div class="value" style="font-size:13px;color:#555">${p.matchReason}</div>` : ""}

  <div class="footer">
    Erstellt von Belegmaster &middot; Blockbusterli &middot; ${new Date().toLocaleDateString("de-CH")} &middot; ${month}
  </div>
</body>
</html>`;

      const safeName = p.platformName.replace(/[^a-z0-9äöü_-]/gi, "_");
      archive.append(html, { name: `belege/${safeName}_${tx.date.replace(/[./]/g, "-")}.html` });
    }

    // Also include a text README
    const readme = [
      `BELEGMASTER – Abgleich ${month}`,
      "=".repeat(40),
      "",
      `Erstellt: ${new Date().toLocaleDateString("de-CH")}`,
      `Abgeglichene Belege: ${matched.length}`,
      "",
      "Enthaltene Dateien:",
      "  Abgleich_Zusammenfassung.csv  – Übersicht aller abgeglichenen Buchungen",
      "  belege/                       – Einzelbelege pro Plattform (HTML)",
      "",
      "Für MOCO: CSV direkt importieren oder PDFs aus den HTML-Belegen drucken.",
    ].join("\n");
    archive.append(readme, { name: "README.txt" });

    await archive.finalize();
  });

  return httpServer;
}
