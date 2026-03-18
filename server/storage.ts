import {
  Platform, InsertPlatform,
  Statement, InsertStatement,
  Reconciliation, InsertReconciliation,
  MatchRule, InsertMatchRule,
  Transaction, PlatformResult,
} from "@shared/schema";

export interface IStorage {
  // Platforms
  getPlatforms(): Promise<Platform[]>;
  getPlatform(id: number): Promise<Platform | undefined>;
  createPlatform(data: InsertPlatform): Promise<Platform>;
  updatePlatform(id: number, data: Partial<InsertPlatform>): Promise<Platform | undefined>;
  deletePlatform(id: number): Promise<boolean>;

  // Statements
  getStatements(): Promise<Statement[]>;
  getStatement(id: number): Promise<Statement | undefined>;
  createStatement(data: InsertStatement): Promise<Statement>;
  deleteStatement(id: number): Promise<boolean>;

  // Reconciliations
  getReconciliations(): Promise<Reconciliation[]>;
  getReconciliation(id: number): Promise<Reconciliation | undefined>;
  getReconciliationByStatement(statementId: number): Promise<Reconciliation | undefined>;
  createReconciliation(data: InsertReconciliation): Promise<Reconciliation>;
  updateReconciliation(id: number, data: Partial<InsertReconciliation>): Promise<Reconciliation | undefined>;

  // Match Rules (learned mappings)
  getMatchRules(): Promise<MatchRule[]>;
  createMatchRule(data: InsertMatchRule): Promise<MatchRule>;
  deleteMatchRule(id: number): Promise<boolean>;
}

class MemStorage implements IStorage {
  private platforms: Map<number, Platform> = new Map();
  private statements: Map<number, Statement> = new Map();
  private reconciliations: Map<number, Reconciliation> = new Map();
  private matchRulesMap: Map<number, MatchRule> = new Map();
  private nextId = { platform: 1, statement: 1, reconciliation: 1, matchRule: 1 };

  constructor() {
    // Seed default platforms
    const defaultPlatforms: InsertPlatform[] = [
      { name: "ElevenLabs", url: "https://elevenlabs.io/app/subscription", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "AI / Voice", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Mocoapp", url: "https://lucianomast.mocoapp.com/settings/subscription?tab=history", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "Projektmanagement", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Blackmagic Design", url: "https://apps.cloud.blackmagicdesign.com/profile", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "Video", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "WeTransfer", url: "https://wetransfer.com/", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "File Transfer", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Mailchimp", url: "https://mailchimp.com/", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "Marketing", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Musicbed", url: "https://www.musicbed.com/account/billing", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "Musik", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Higgsfield AI", url: "https://higgsfield.ai/", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "AI / Video", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Google One", url: "https://one.google.com/about/plans?hl=de", username: "", password: "", isActive: true, has2fa: true, notes: "Google 2FA aktiv", category: "Cloud / Storage", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Claude.ai", url: "https://claude.ai/settings/billing", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "AI", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Galaxus", url: "https://www.galaxus.ch/de/order?skipAppLink=true", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "Online Shop", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Digitec", url: "https://www.digitec.ch/de/order", username: "", password: "", isActive: true, has2fa: false, notes: "", category: "Online Shop", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
      { name: "Facebook Ads", url: "https://business.facebook.com/billing_hub/payment_settings/", username: "", password: "", isActive: true, has2fa: true, notes: "Meta 2FA aktiv", category: "Werbung", lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null },
    ];
    defaultPlatforms.forEach(p => this.createPlatform(p));
  }

  // ── Platforms ──
  async getPlatforms() { return Array.from(this.platforms.values()); }
  async getPlatform(id: number) { return this.platforms.get(id); }
  async createPlatform(data: InsertPlatform): Promise<Platform> {
    const id = this.nextId.platform++;
    const p: Platform = { id, ...data, username: data.username ?? "", password: data.password ?? "", isActive: data.isActive ?? true, has2fa: data.has2fa ?? false, notes: data.notes ?? "", category: data.category ?? "Software", lastChecked: data.lastChecked ?? null, lastInvoiceAmount: data.lastInvoiceAmount ?? null, lastInvoiceCurrency: data.lastInvoiceCurrency ?? null };
    this.platforms.set(id, p);
    return p;
  }
  async updatePlatform(id: number, data: Partial<InsertPlatform>) {
    const existing = this.platforms.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.platforms.set(id, updated);
    return updated;
  }
  async deletePlatform(id: number) {
    return this.platforms.delete(id);
  }

  // ── Statements ──
  async getStatements() { return Array.from(this.statements.values()).sort((a, b) => b.id - a.id); }
  async getStatement(id: number) { return this.statements.get(id); }
  async createStatement(data: InsertStatement): Promise<Statement> {
    const id = this.nextId.statement++;
    const s: Statement = { id, ...data, transactions: (data.transactions as any) ?? [] };
    this.statements.set(id, s);
    return s;
  }
  async deleteStatement(id: number) { return this.statements.delete(id); }

  // ── Reconciliations ──
  async getReconciliations() { return Array.from(this.reconciliations.values()).sort((a, b) => b.id - a.id); }
  async getReconciliation(id: number) { return this.reconciliations.get(id); }
  async getReconciliationByStatement(statementId: number) {
    return Array.from(this.reconciliations.values()).find(r => r.statementId === statementId);
  }
  async createReconciliation(data: InsertReconciliation): Promise<Reconciliation> {
    const id = this.nextId.reconciliation++;
    const r: Reconciliation = { id, ...data, platformResults: (data.platformResults as any) ?? [], missingReceipts: (data.missingReceipts as any) ?? [], totalMatched: data.totalMatched ?? 0, totalUnmatched: data.totalUnmatched ?? 0 };
    this.reconciliations.set(id, r);
    return r;
  }
  async updateReconciliation(id: number, data: Partial<InsertReconciliation>) {
    const existing = this.reconciliations.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.reconciliations.set(id, updated);
    return updated;
  }

  // ── Match Rules ──
  async getMatchRules() { return Array.from(this.matchRulesMap.values()); }
  async createMatchRule(data: InsertMatchRule): Promise<MatchRule> {
    const id = this.nextId.matchRule++;
    const r: MatchRule = { id, ...data, processorAlias: data.processorAlias ?? null };
    this.matchRulesMap.set(id, r);
    return r;
  }
  async deleteMatchRule(id: number) { return this.matchRulesMap.delete(id); }
}

export const storage = new MemStorage();
