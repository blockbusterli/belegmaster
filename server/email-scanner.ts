/**
 * E-Mail Scanner – sucht Rechnungs-E-Mails die zu Kreditkartentransaktionen passen
 *
 * WICHTIG: Nur E-Mails die zu einer Kreditkartenbuchung passen werden angezeigt.
 * Freelancer-Rechnungen, andere Dienste etc. werden ignoriert.
 *
 * Unterstützte Protokolle:
 *  - IMAP (Gmail, iCloud Mail, Outlook, jedes IMAP-fähige Konto)
 *
 * Flow:
 *  1. connectEmail(config) → verbindet sich via IMAP
 *  2. scanEmailsForTransactions(sessionId, transactions) → sucht Mails die zu Kreditkartenbuchungen passen
 *  3. closeEmailSession(sessionId) → trennt Verbindung
 */

import Imap from "imap";
import { simpleParser, ParsedMail } from "mailparser";
import { Transaction } from "@shared/schema";
import { Readable } from "stream";

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

export interface EmailReceiptResult {
  transaction: Transaction;
  found: boolean;
  emailSubject?: string;
  emailFrom?: string;
  emailDate?: string;
  emailBody?: string;   // first 500 chars of text body
  matchReason?: string;
  message?: string;
}

interface EmailSession {
  imap: Imap;
  connected: boolean;
}

const emailSessions = new Map<string, EmailSession>();

function makeSessionId() {
  return `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Known invoice sender domains – used to filter out non-receipt emails
const INVOICE_SENDER_DOMAINS = [
  "elevenlabs.io", "mocoapp.com", "blackmagicdesign.com",
  "wetransfer.com", "mailchimp.com", "intuit.com",
  "musicbed.com", "higgsfield.ai",
  "google.com", "googleone.com",
  "anthropic.com", "claude.ai",
  "galaxus.ch", "digitec.ch",
  "facebook.com", "meta.com",
  "apple.com", "itunes.com",
  "paddle.com", "paddle.net", "stripe.com", "paypal.com",
  "soundly.com", "invoice", "billing", "rechnung", "receipt",
  "noreply", "no-reply",
];

// Keywords in subject line that indicate an invoice/receipt
const INVOICE_SUBJECT_KEYWORDS = [
  "invoice", "rechnung", "receipt", "beleg", "quittung",
  "order confirmation", "bestellbestätigung", "payment confirmation",
  "zahlungsbestätigung", "your subscription", "dein abo",
  "billing", "abrechnung", "statement",
];

function isLikelyInvoiceEmail(subject: string, from: string): boolean {
  const subjectLower = subject.toLowerCase();
  const fromLower = from.toLowerCase();

  const subjectMatch = INVOICE_SUBJECT_KEYWORDS.some(kw => subjectLower.includes(kw));
  const domainMatch = INVOICE_SENDER_DOMAINS.some(d => fromLower.includes(d));

  return subjectMatch || domainMatch;
}

/**
 * Check if an email likely corresponds to a specific credit card transaction
 * by comparing amounts, dates, and merchant names.
 */
function matchEmailToTransaction(
  mail: ParsedMail,
  tx: Transaction
): { matches: boolean; reason: string } {
  const subject = (mail.subject || "").toLowerCase();
  const bodyText = (mail.text || "").toLowerCase();
  const combined = subject + " " + bodyText;

  // 1. Amount match: look for the transaction amount in the email
  const amountStr = tx.amount.toFixed(2);
  const amountStr2 = tx.amount.toFixed(0); // without decimals
  const hasAmount = combined.includes(amountStr) || combined.includes(amountStr2);

  // 2. Description keyword match: look for parts of the card description in the email
  const descWords = tx.description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3);

  const descMatch = descWords.some(word => combined.includes(word));

  // 3. Date proximity: email date should be within 7 days of transaction date
  let dateMatch = true;
  if (mail.date && tx.date) {
    const mailDate = new Date(mail.date).getTime();
    const txParts = tx.date.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (txParts) {
      const [, d, m, y] = txParts;
      const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
      const txDate = new Date(year, parseInt(m) - 1, parseInt(d)).getTime();
      const daysDiff = Math.abs(mailDate - txDate) / (1000 * 60 * 60 * 24);
      dateMatch = daysDiff <= 14; // 2 weeks tolerance
    }
  }

  if (hasAmount && descMatch && dateMatch) {
    return { matches: true, reason: `Betrag ${amountStr} + Händler-Keyword gefunden` };
  }
  if (hasAmount && dateMatch) {
    return { matches: true, reason: `Betrag ${amountStr} im Zeitraum gefunden` };
  }
  if (descMatch && dateMatch) {
    return { matches: true, reason: `Händler-Name im Zeitraum gefunden` };
  }

  return { matches: false, reason: "" };
}

export async function connectEmail(
  config: EmailConfig
): Promise<{ success: boolean; sessionId: string; message?: string }> {
  const sessionId = makeSessionId();

  return new Promise((resolve) => {
    const imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.tls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000,
    });

    imap.once("ready", () => {
      emailSessions.set(sessionId, { imap, connected: true });
      resolve({ success: true, sessionId });
    });

    imap.once("error", (err: Error) => {
      resolve({ success: false, sessionId, message: `Verbindung fehlgeschlagen: ${err.message}` });
    });

    imap.connect();
  });
}

export async function scanEmailsForTransactions(
  sessionId: string,
  transactions: Transaction[]
): Promise<EmailReceiptResult[]> {
  const session = emailSessions.get(sessionId);
  if (!session || !session.connected) {
    return transactions.map(tx => ({
      transaction: tx,
      found: false,
      message: "Keine E-Mail-Verbindung",
    }));
  }

  const { imap } = session;

  // Open INBOX (read-only)
  await new Promise<void>((resolve, reject) => {
    imap.openBox("INBOX", true, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Search for emails from last 90 days
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });

  const uids: number[] = await new Promise((resolve, reject) => {
    imap.search(["ALL", ["SINCE", sinceStr]], (err, results) => {
      if (err) reject(err);
      else resolve(results || []);
    });
  });

  if (uids.length === 0) {
    return transactions.map(tx => ({
      transaction: tx,
      found: false,
      message: "Keine E-Mails im Posteingang gefunden",
    }));
  }

  // Fetch emails (limit to last 200 for performance)
  const fetchUids = uids.slice(-200);
  const mails: ParsedMail[] = [];

  await new Promise<void>((resolve, reject) => {
    const fetch = imap.fetch(fetchUids, { bodies: ["HEADER.FIELDS (FROM SUBJECT DATE)", "TEXT"], struct: true });

    fetch.on("message", (msg) => {
      let headerBuffer = "";
      let bodyBuffer = "";

      msg.on("body", (stream, info) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          if (info.which.includes("HEADER")) {
            headerBuffer = Buffer.concat(chunks).toString("utf8");
          } else {
            bodyBuffer = Buffer.concat(chunks).toString("utf8");
          }
        });
      });

      msg.once("end", async () => {
        try {
          const combined = headerBuffer + "\r\n" + bodyBuffer;
          const readable = Readable.from([combined]);
          const parsed = await simpleParser(readable);
          mails.push(parsed);
        } catch {
          // skip unparseable emails
        }
      });
    });

    fetch.once("error", reject);
    fetch.once("end", () => setTimeout(resolve, 500));
  });

  // Filter to only likely invoice emails first
  const invoiceMails = mails.filter(m =>
    isLikelyInvoiceEmail(m.subject || "", m.from?.text || "")
  );

  // Now match each transaction to invoice emails
  const results: EmailReceiptResult[] = transactions.map(tx => {
    for (const mail of invoiceMails) {
      const { matches, reason } = matchEmailToTransaction(mail, tx);
      if (matches) {
        const bodyPreview = (mail.text || "").substring(0, 400).trim();
        return {
          transaction: tx,
          found: true,
          emailSubject: mail.subject || "(kein Betreff)",
          emailFrom: mail.from?.text || "",
          emailDate: mail.date?.toLocaleDateString("de-CH") || "",
          emailBody: bodyPreview,
          matchReason: reason,
        };
      }
    }
    return {
      transaction: tx,
      found: false,
      message: "Keine passende Rechnung in E-Mails gefunden",
    };
  });

  return results;
}

export function closeEmailSession(sessionId: string) {
  const session = emailSessions.get(sessionId);
  if (session) {
    try { session.imap.end(); } catch {}
    emailSessions.delete(sessionId);
  }
}

// Pre-configured IMAP settings for common providers
export const IMAP_PRESETS: Record<string, EmailConfig> = {
  gmail: {
    host: "imap.gmail.com",
    port: 993,
    user: "",
    password: "",
    tls: true,
  },
  icloud: {
    host: "imap.mail.me.com",
    port: 993,
    user: "",
    password: "",
    tls: true,
  },
  outlook: {
    host: "outlook.office365.com",
    port: 993,
    user: "",
    password: "",
    tls: true,
  },
  "google-workspace": {
    host: "imap.gmail.com",
    port: 993,
    user: "",
    password: "",
    tls: true,
  },
};
