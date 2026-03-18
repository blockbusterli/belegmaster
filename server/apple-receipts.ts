/**
 * Apple "Report a Problem" receipt automation
 *
 * Flow:
 *  1. startAppleLogin(appleId, password) → launches browser, fills login form
 *     - If 2FA needed: returns { requires2fa: true, sessionId }
 *     - If direct login: returns { success: true, sessionId }
 *  2. verifyApple2FA(sessionId, code) → submits 2FA code
 *  3. fetchAppleReceipts(sessionId, transactions) → finds matching purchases,
 *     takes screenshots, returns base64 PNG per transaction
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { Transaction } from "@shared/schema";

interface AppleSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  loggedIn: boolean;
}

// In-memory session store (keyed by sessionId)
const appleSessions = new Map<string, AppleSession>();

function makeSessionId() {
  return `apple_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function startAppleLogin(
  appleId: string,
  password: string
): Promise<{ success?: boolean; requires2fa?: boolean; sessionId: string; message?: string }> {
  const sessionId = makeSessionId();

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    appleSessions.set(sessionId, { browser, context, page, loggedIn: false });

    // Navigate to reportaproblem.apple.com
    await page.goto("https://reportaproblem.apple.com", { waitUntil: "domcontentloaded", timeout: 30000 });

    // Fill in Apple ID
    const emailInput = await page.waitForSelector('input[type="email"], input[name="account_name"], #account_name_text_field', { timeout: 15000 });
    await emailInput.fill(appleId);

    // Click Continue / Next
    const continueBtn = await page.waitForSelector('button[type="submit"], #sign-in, .button-action', { timeout: 8000 });
    await continueBtn.click();

    // Wait for password field
    await page.waitForTimeout(1500);
    const pwInput = await page.waitForSelector('input[type="password"], #password_text_field', { timeout: 12000 }).catch(() => null);

    if (pwInput) {
      await pwInput.fill(password);
      const signInBtn = await page.waitForSelector('button[type="submit"], #sign-in', { timeout: 8000 });
      await signInBtn.click();
      await page.waitForTimeout(2500);
    }

    // Check if 2FA is needed
    const twoFaIndicators = [
      'input[name="code"]',
      'input[inputmode="numeric"]',
      '.two-factor',
      '#char0',
      '[data-testid="two-factor-code"]',
    ];
    let has2fa = false;
    for (const sel of twoFaIndicators) {
      const el = await page.$(sel).catch(() => null);
      if (el) { has2fa = true; break; }
    }

    if (has2fa) {
      return { requires2fa: true, sessionId };
    }

    // Check if we're logged in (reportaproblem shows order list or search)
    const loggedIn = await page.url().includes("reportaproblem") &&
      !(await page.$('input[type="email"]').catch(() => null));

    if (loggedIn) {
      appleSessions.get(sessionId)!.loggedIn = true;
      return { success: true, sessionId };
    }

    return { requires2fa: true, sessionId }; // assume 2FA if unclear
  } catch (err: any) {
    console.error("[Apple] Login error:", err.message);
    return { sessionId, message: `Login fehlgeschlagen: ${err.message}` };
  }
}

export async function verifyApple2FA(
  sessionId: string,
  code: string
): Promise<{ success: boolean; message?: string }> {
  const session = appleSessions.get(sessionId);
  if (!session) return { success: false, message: "Session abgelaufen" };

  try {
    const { page } = session;

    // Try different 2FA input patterns
    // Pattern A: single input
    const singleInput = await page.$('input[name="code"], input[inputmode="numeric"]').catch(() => null);
    if (singleInput) {
      await singleInput.fill(code);
    } else {
      // Pattern B: individual digit inputs (#char0, #char1, ...)
      for (let i = 0; i < code.length; i++) {
        const digitInput = await page.$(`#char${i}, [data-testid="digit-${i}"]`).catch(() => null);
        if (digitInput) await digitInput.fill(code[i]);
      }
    }

    // Submit
    const submitBtn = await page.$('button[type="submit"], .verification-continue, #two-factor-continue').catch(() => null);
    if (submitBtn) await submitBtn.click();

    await page.waitForTimeout(3000);

    // Check if past 2FA
    const onReportPage = page.url().includes("reportaproblem");
    const noCodeInput = !(await page.$('input[name="code"], #char0').catch(() => null));

    if (onReportPage && noCodeInput) {
      session.loggedIn = true;
      return { success: true };
    }

    return { success: false, message: "2FA-Code falsch oder abgelaufen" };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export interface AppleReceiptResult {
  transaction: Transaction;
  screenshotBase64?: string;
  found: boolean;
  searchedDescription: string;
  message?: string;
}

export async function fetchAppleReceipts(
  sessionId: string,
  transactions: Transaction[]
): Promise<AppleReceiptResult[]> {
  const session = appleSessions.get(sessionId);
  if (!session || !session.loggedIn) {
    return transactions.map(tx => ({
      transaction: tx,
      found: false,
      searchedDescription: tx.description,
      message: "Nicht eingeloggt",
    }));
  }

  const { page } = session;
  const results: AppleReceiptResult[] = [];

  for (const tx of transactions) {
    try {
      // Extract a clean search term from the transaction description
      // e.g. "APPLE.COM/BILL" → search by amount + approximate date
      const amountStr = tx.amount.toFixed(2);

      // Navigate to reportaproblem.apple.com (should already be there)
      if (!page.url().includes("reportaproblem")) {
        await page.goto("https://reportaproblem.apple.com", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);
      }

      // Look for the transaction by amount in the purchase list
      // Apple shows a list of recent purchases – find matching amount
      await page.waitForSelector('.purchase-list, .order-list, [data-testid="purchase-list"], main', {
        timeout: 15000,
      }).catch(() => {});

      // Try to find a row matching the amount
      const rows = await page.$$('li, tr, .purchase-item, [data-testid*="purchase"]').catch(() => []);
      let matchedRow = null;

      for (const row of rows) {
        const text = await row.textContent().catch(() => "");
        if (text && text.includes(amountStr)) {
          matchedRow = row;
          break;
        }
      }

      if (matchedRow) {
        // Scroll into view and screenshot the receipt card
        await matchedRow.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(500);

        // Click to expand if needed
        await matchedRow.click().catch(() => {});
        await page.waitForTimeout(1000);

        const screenshot = await page.screenshot({ type: "png" });
        results.push({
          transaction: tx,
          found: true,
          searchedDescription: tx.description,
          screenshotBase64: screenshot.toString("base64"),
        });
      } else {
        // Take a full-page screenshot anyway for manual review
        const screenshot = await page.screenshot({ type: "png" });
        results.push({
          transaction: tx,
          found: false,
          searchedDescription: tx.description,
          screenshotBase64: screenshot.toString("base64"),
          message: `Betrag CHF ${amountStr} nicht gefunden – Screenshot zur manuellen Prüfung`,
        });
      }
    } catch (err: any) {
      results.push({
        transaction: tx,
        found: false,
        searchedDescription: tx.description,
        message: `Fehler: ${err.message}`,
      });
    }
  }

  return results;
}

export function closeAppleSession(sessionId: string) {
  const session = appleSessions.get(sessionId);
  if (session) {
    session.browser.close().catch(() => {});
    appleSessions.delete(sessionId);
  }
}
