/**
 * Desktop App Receipt Handler
 *
 * Für macOS-Apps wie Soundly, die keine Web-Login-Seite haben,
 * arbeiten wir mit zwei Ansätzen:
 *
 * 1. App Store Receipts: Über reportaproblem.apple.com (bereits in apple-receipts.ts)
 *    → Käufe über Mac App Store erscheinen dort ebenfalls
 *
 * 2. Direct invoice lookup: Viele Desktop-Apps (Soundly etc.) haben
 *    ein Kundenportal oder senden Rechnungen per E-Mail über Paddle/Stripe
 *
 * 3. Manual screenshot guidance: Für Apps die keine API haben,
 *    führt das Tool den User durch den manuellen Screenshot-Prozess
 *
 * Unterstützte Desktop-Apps:
 *  - Soundly (soundly.com – Paddle-basiert, Rechnungen per E-Mail)
 *  - Andere: Anleitung zum manuellen Screenshot
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { Transaction } from "@shared/schema";

export interface DesktopApp {
  id: string;
  name: string;
  type: "portal" | "email" | "app_store" | "manual";
  portalUrl?: string;
  loginSelector?: string;
  passwordSelector?: string;
  invoiceListSelector?: string;
  notes?: string;
}

export const DESKTOP_APPS: DesktopApp[] = [
  {
    id: "soundly",
    name: "Soundly",
    type: "portal",
    portalUrl: "https://soundly.com/account",
    loginSelector: 'input[type="email"], input[name="email"]',
    passwordSelector: 'input[type="password"]',
    invoiceListSelector: '.invoice, .billing-history, [data-testid="invoice"]',
    notes: "Soundly verwendet Paddle als Zahlungsanbieter. Rechnungen sind im Account-Portal verfügbar.",
  },
  {
    id: "affinity",
    name: "Affinity (Serif)",
    type: "portal",
    portalUrl: "https://affinity.serif.com/account/purchases",
    loginSelector: 'input[type="email"]',
    passwordSelector: 'input[type="password"]',
    invoiceListSelector: '.purchase-list, .order',
    notes: "Affinity-Lizenzen erscheinen im Serif-Konto unter Purchases.",
  },
  {
    id: "figma",
    name: "Figma",
    type: "portal",
    portalUrl: "https://www.figma.com/settings/billing",
    loginSelector: 'input[type="email"]',
    passwordSelector: 'input[type="password"]',
    invoiceListSelector: '.invoice-row, [data-testid="invoice"]',
  },
  {
    id: "notion",
    name: "Notion",
    type: "portal",
    portalUrl: "https://www.notion.so/my-account",
    loginSelector: 'input[type="email"]',
    passwordSelector: 'input[type="password"]',
    invoiceListSelector: '.invoice',
  },
  {
    id: "app_store",
    name: "Mac App Store",
    type: "app_store",
    portalUrl: "https://reportaproblem.apple.com",
    notes: "Mac App Store-Käufe erscheinen auf reportaproblem.apple.com. Nutze den Apple Belege-Flow.",
  },
];

interface DesktopSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  appId: string;
}

const desktopSessions = new Map<string, DesktopSession>();

function makeSessionId() {
  return `desktop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface DesktopReceiptResult {
  transaction: Transaction;
  found: boolean;
  screenshotBase64?: string;
  invoiceUrl?: string;
  message?: string;
}

export async function loginDesktopApp(
  appId: string,
  username: string,
  password: string
): Promise<{ success?: boolean; requires2fa?: boolean; sessionId: string; message?: string }> {
  const app = DESKTOP_APPS.find(a => a.id === appId);
  if (!app || !app.portalUrl) {
    return { sessionId: "", message: `App '${appId}' nicht gefunden` };
  }
  if (app.type === "app_store") {
    return { sessionId: "", message: "Mac App Store-Belege → Apple Belege-Flow verwenden" };
  }

  const sessionId = makeSessionId();

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    desktopSessions.set(sessionId, { browser, context, page, appId });

    await page.goto(app.portalUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Fill login form
    const emailInput = await page.waitForSelector(
      app.loginSelector || 'input[type="email"]',
      { timeout: 10000 }
    ).catch(() => null);

    if (!emailInput) {
      // Already logged in or different page structure
      desktopSessions.get(sessionId)!;
      return { success: true, sessionId };
    }

    await emailInput.fill(username);

    // Click continue/next if needed (some apps split email and password)
    const continueBtn = await page.$('button[type="submit"]:not([disabled])').catch(() => null);
    if (continueBtn) {
      await continueBtn.click();
      await page.waitForTimeout(1500);
    }

    const pwInput = await page.waitForSelector(
      app.passwordSelector || 'input[type="password"]',
      { timeout: 8000 }
    ).catch(() => null);

    if (pwInput) {
      await pwInput.fill(password);
      const signInBtn = await page.$('button[type="submit"]').catch(() => null);
      if (signInBtn) {
        await signInBtn.click();
        await page.waitForTimeout(3000);
      }
    }

    // Check for 2FA
    const twoFaInput = await page.$('input[inputmode="numeric"], input[name="code"], input[name="otp"]').catch(() => null);
    if (twoFaInput) {
      return { requires2fa: true, sessionId };
    }

    return { success: true, sessionId };
  } catch (err: any) {
    return { sessionId, message: `Login fehlgeschlagen: ${err.message}` };
  }
}

export async function verifyDesktop2FA(
  sessionId: string,
  code: string
): Promise<{ success: boolean; message?: string }> {
  const session = desktopSessions.get(sessionId);
  if (!session) return { success: false, message: "Session abgelaufen" };

  try {
    const { page } = session;
    const input = await page.$('input[inputmode="numeric"], input[name="code"], input[name="otp"]').catch(() => null);
    if (input) {
      await input.fill(code);
      const btn = await page.$('button[type="submit"]').catch(() => null);
      if (btn) await btn.click();
      await page.waitForTimeout(2500);
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export async function fetchDesktopReceipts(
  sessionId: string,
  transactions: Transaction[]
): Promise<DesktopReceiptResult[]> {
  const session = desktopSessions.get(sessionId);
  if (!session) {
    return transactions.map(tx => ({ transaction: tx, found: false, message: "Session abgelaufen" }));
  }

  const { page, appId } = session;
  const app = DESKTOP_APPS.find(a => a.id === appId);
  const results: DesktopReceiptResult[] = [];

  for (const tx of transactions) {
    try {
      // Navigate to billing/invoice page
      if (app?.portalUrl) {
        const billingUrl = app.portalUrl.includes("billing") || app.portalUrl.includes("invoice")
          ? app.portalUrl
          : app.portalUrl.replace(/\/?$/, "/billing");

        await page.goto(billingUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }

      // Try to find invoice matching the transaction amount
      const amountStr = tx.amount.toFixed(2);
      const rows = await page.$$(
        app?.invoiceListSelector || '.invoice, tr, li, [class*="invoice"], [class*="billing"]'
      ).catch(() => []);

      let found = false;
      for (const row of rows) {
        const text = await row.textContent().catch(() => "");
        if (text && text.includes(amountStr)) {
          await row.scrollIntoViewIfNeeded().catch(() => {});
          await row.click().catch(() => {});
          await page.waitForTimeout(1000);
          found = true;
          break;
        }
      }

      const screenshot = await page.screenshot({ type: "png" }).catch(() => null);
      results.push({
        transaction: tx,
        found,
        screenshotBase64: screenshot?.toString("base64"),
        message: found
          ? undefined
          : `Betrag CHF ${amountStr} nicht in Rechnungsliste gefunden`,
      });
    } catch (err: any) {
      results.push({ transaction: tx, found: false, message: `Fehler: ${err.message}` });
    }
  }

  return results;
}

export function closeDesktopSession(sessionId: string) {
  const session = desktopSessions.get(sessionId);
  if (session) {
    session.browser.close().catch(() => {});
    desktopSessions.delete(sessionId);
  }
}
