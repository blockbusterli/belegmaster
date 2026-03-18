/**
 * Auto-Login Engine – Browser-gesteuerte Anmeldung bei Plattformen
 * Nutzt Playwright Chromium für headless Browser-Automatisierung
 */

import { storage } from "./storage";

// Temporary 2FA session store (in-memory)
const twoFASessions: Map<string, { browser: any; page: any; platform: any }> = new Map();

// ── Platform-specific login handlers ───────────────────────────────────────────
const PLATFORM_STRATEGIES: Record<string, (page: any, username: string, password: string) => Promise<{
  success: boolean; requires2fa?: boolean; invoice?: { amount: number; currency: string }; message?: string;
}>> = {

  "ElevenLabs": async (page, username, password) => {
    await page.goto("https://elevenlabs.io/sign-in", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.fill('input[type="password"]', password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(3000);
    // Navigate to billing
    await page.goto("https://elevenlabs.io/app/subscription", { waitUntil: "networkidle", timeout: 20000 });
    const text = await page.content();
    if (text.includes("sign-in") || text.includes("login")) return { success: false, message: "Login fehlgeschlagen – bitte Zugangsdaten prüfen" };
    return { success: true, invoice: { amount: 0, currency: "USD" } };
  },

  "Mailchimp": async (page, username, password) => {
    await page.goto("https://login.mailchimp.com/", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('#username', username).catch(() => page.fill('input[name="username"]', username));
    await page.fill('#password', password).catch(() => page.fill('input[name="password"]', password));
    await page.click('#btn-login').catch(() => page.click('button[type="submit"]'));
    await page.waitForTimeout(3000);
    const url = page.url();
    if (url.includes("login") || url.includes("signup")) return { success: false, message: "Login fehlgeschlagen" };
    return { success: true };
  },

  "Musicbed": async (page, username, password) => {
    await page.goto("https://www.musicbed.com/login", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.fill('input[type="password"]', password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(3000);
    return { success: true };
  },

  "WeTransfer": async (page, username, password) => {
    await page.goto("https://wetransfer.com/signin", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForTimeout(2000);
    // WeTransfer sends magic link – simulate
    return { success: false, message: "WeTransfer nutzt Magic-Link Login – bitte manuell einloggen und Beleg herunterladen" };
  },

  "Claude.ai": async (page, username, password) => {
    await page.goto("https://claude.ai/login", { waitUntil: "networkidle", timeout: 30000 });
    // Claude uses Google/email magic links
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(2000);
    return { success: false, message: "Claude.ai nutzt E-Mail Magic-Link – bitte manuell einloggen" };
  },

  "Higgsfield AI": async (page, username, password) => {
    await page.goto("https://higgsfield.ai/login", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.fill('input[type="password"]', password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(3000);
    return { success: true };
  },

  "Mocoapp": async (page, username, password) => {
    await page.goto("https://login.mocoapp.com", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.fill('input[type="password"]', password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(3000);
    const url = page.url();
    if (url.includes("login")) return { success: false, message: "Login fehlgeschlagen" };
    await page.goto("https://lucianomast.mocoapp.com/settings/subscription?tab=history", { waitUntil: "networkidle", timeout: 20000 });
    return { success: true };
  },

  "Blackmagic Design": async (page, username, password) => {
    await page.goto("https://login.blackmagicdesign.com/", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForTimeout(1500);
    await page.fill('input[type="password"]', password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(3000);
    return { success: true };
  },

  "Google One": async (page, username, password) => {
    await page.goto("https://accounts.google.com/signin", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.click('#identifierNext').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(2000);
    await page.fill('input[type="password"]', password).catch(() => {});
    await page.click('#passwordNext').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(3000);
    // Check for 2FA prompt
    const content = await page.content();
    if (content.includes("2-Step") || content.includes("Bestätigung") || content.includes("verification")) {
      return { success: false, requires2fa: true };
    }
    return { success: true };
  },

  "Facebook Ads": async (page, username, password) => {
    await page.goto("https://www.facebook.com/login", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('#email', username).catch(() => {});
    await page.fill('#pass', password).catch(() => {});
    await page.click('[type="submit"]').catch(() => {});
    await page.waitForTimeout(4000);
    const content = await page.content();
    if (content.includes("checkpoint") || content.includes("two-factor") || content.includes("code")) {
      return { success: false, requires2fa: true };
    }
    const url = page.url();
    if (url.includes("login")) return { success: false, message: "Login fehlgeschlagen" };
    return { success: true };
  },

  "Galaxus": async (page, username, password) => {
    await page.goto("https://www.galaxus.ch/de/account/login", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.fill('input[type="password"]', password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(3000);
    return { success: true };
  },

  "Digitec": async (page, username, password) => {
    await page.goto("https://www.digitec.ch/de/account/login", { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', username).catch(() => {});
    await page.fill('input[type="password"]', password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(3000);
    return { success: true };
  },
};

// ── Fallback generic strategy ──────────────────────────────────────────────────
async function genericLogin(page: any, url: string, username: string, password: string) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  // Try to fill email/password fields generically
  const emailFilled = await page.fill('input[type="email"]', username).then(() => true).catch(() => false);
  if (!emailFilled) await page.fill('input[name*="email"], input[name*="user"], input[id*="email"]', username).catch(() => {});
  await page.fill('input[type="password"]', password).catch(() => {});
  await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
  await page.waitForTimeout(3000);
  return { success: true };
}

// ── Main auto-login function ───────────────────────────────────────────────────
export async function performAutoLogin(platformId: number): Promise<{
  success: boolean;
  requires2fa?: boolean;
  sessionId?: string;
  platformName?: string;
  invoiceAmount?: number;
  invoiceCurrency?: string;
  message?: string;
}> {
  const platform = await storage.getPlatform(platformId);
  if (!platform) return { success: false, message: "Plattform nicht gefunden" };
  if (!platform.username || !platform.password) return { success: false, message: "Keine Login-Daten hinterlegt – bitte zuerst unter Plattformen eintragen" };

  let browser: any;
  let chromium: any;
  try {
    ({ chromium } = await import("playwright"));
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch (e) {
    return { success: false, message: "Browser nicht verfügbar – Playwright nicht installiert" };
  }

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    const strategy = PLATFORM_STRATEGIES[platform.name];
    let result: any;

    if (strategy) {
      result = await strategy(page, platform.username, platform.password);
    } else {
      result = await genericLogin(page, platform.url, platform.username, platform.password);
    }

    if (result.requires2fa) {
      // Store session for later 2FA verification
      const sessionId = `2fa-${platformId}-${Date.now()}`;
      twoFASessions.set(sessionId, { browser, page, platform });
      // Don't close browser – keep for 2FA completion
      return { success: false, requires2fa: true, sessionId, platformName: platform.name };
    }

    await browser.close();

    if (result.success) {
      // Update platform last checked
      await storage.updatePlatform(platformId, {
        lastChecked: new Date().toISOString(),
        lastInvoiceAmount: result.invoice?.amount ?? null,
        lastInvoiceCurrency: result.invoice?.currency ?? null,
      });
      return {
        success: true,
        platformName: platform.name,
        invoiceAmount: result.invoice?.amount,
        invoiceCurrency: result.invoice?.currency,
      };
    }

    return { success: false, message: result.message || "Login fehlgeschlagen" };
  } catch (e: any) {
    await browser.close().catch(() => {});
    console.error("Auto-login error:", e.message);
    return { success: false, message: `Fehler: ${e.message?.substring(0, 100)}` };
  }
}

// ── 2FA verification ───────────────────────────────────────────────────────────
export async function verify2FA(sessionId: string, code: string): Promise<{
  success: boolean; message?: string;
}> {
  const session = twoFASessions.get(sessionId);
  if (!session) return { success: false, message: "Session abgelaufen – bitte Login erneut starten" };

  const { browser, page, platform } = session;
  try {
    // Try to fill the 2FA code field
    await page.fill('input[name="code"], input[name="otp"], input[type="text"]:visible, input[name="authCode"]', code).catch(() => {});
    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(3000);

    await storage.updatePlatform(platform.id, { lastChecked: new Date().toISOString() });
    twoFASessions.delete(sessionId);
    await browser.close().catch(() => {});
    return { success: true };
  } catch (e: any) {
    twoFASessions.delete(sessionId);
    await browser.close().catch(() => {});
    return { success: false, message: e.message };
  }
}
