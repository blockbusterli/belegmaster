import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Reconciliation, PlatformResult, Transaction } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, AlertCircle, Clock, ExternalLink, Receipt,
  ChevronDown, ChevronUp, FileText, Zap, HelpCircle,
  ThumbsUp, ThumbsDown, ArrowRightLeft, TrendingUp, Apple, ChevronRight,
  Mail, Monitor, Download,
} from "lucide-react";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const STATUS_CONFIG = {
  matched:      { label: "Abgeglichen",     color: "#4ade80", bg: "rgba(74,222,128,0.08)",  border: "rgba(74,222,128,0.2)" },
  fuzzy_match:  { label: "Vorschlag",       color: "#F2C831", bg: "rgba(242,200,49,0.08)",  border: "rgba(242,200,49,0.25)" },
  no_invoice:   { label: "Kein Beleg",      color: "#7dd3e8", bg: "rgba(0,182,223,0.05)",   border: "rgba(0,182,223,0.12)" },
  needs_manual: { label: "Manuell prüfen",  color: "#F2C831", bg: "rgba(242,200,49,0.08)",  border: "rgba(242,200,49,0.2)" },
  waiting_2fa:  { label: "2FA nötig",       color: "#F2C831", bg: "rgba(242,200,49,0.08)",  border: "rgba(242,200,49,0.2)" },
  pending:      { label: "Ausstehend",      color: "#7dd3e8", bg: "rgba(0,182,223,0.05)",   border: "rgba(0,182,223,0.12)" },
};

const CAT_EMOJI: Record<string, string> = {
  Tanken: "⛽", Essen: "🍕", Reise: "🚆", "Abo/Streaming": "📺", Sonstiges: "💳",
};

export default function ReconciliationPage() {
  const { id } = useParams<{ id?: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: reconciliations = [] } = useQuery<Reconciliation[]>({ queryKey: ["/api/reconciliations"] });
  const recon = id ? reconciliations.find(r => r.id === parseInt(id)) : reconciliations[0];
  const [expandedMissing, setExpandedMissing] = useState(false);

  // Apple transactions detection for banner
  const { data: appleTxData } = useQuery({
    queryKey: ["/api/apple/transactions", recon?.id],
    enabled: !!recon?.id,
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/apple/transactions/${recon!.id}`);
      return r.json() as Promise<{ transactions: Transaction[]; count: number }>;
    },
  });

  const markMutation = useMutation({
    mutationFn: ({ platformId, status, notes }: { platformId: number; status: string; notes?: string }) =>
      apiRequest("PUT", `/api/reconciliations/${recon!.id}/platform/${platformId}`, { status, notes }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliations"] });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (platformId: number) =>
      apiRequest("POST", `/api/reconciliations/${recon!.id}/confirm-match/${platformId}`).then(r => r.json()),
    onSuccess: (_, platformId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliations"] });
      toast({ title: "✓ Zuordnung gespeichert – wird beim nächsten Abgleich automatisch erkannt" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (platformId: number) =>
      apiRequest("POST", `/api/reconciliations/${recon!.id}/reject-match/${platformId}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliations"] });
      toast({ title: "Vorschlag abgelehnt" });
    },
  });

  const autoLoginMutation = useMutation({
    mutationFn: ({ platformId }: { platformId: number }) =>
      apiRequest("POST", `/api/auto-login/${platformId}`).then(r => r.json()),
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliations"] });
      if (data.requires2fa) {
        const code = window.prompt(`2FA-Code für ${data.platformName} eingeben:`);
        if (code) {
          apiRequest("POST", `/api/auto-login/${vars.platformId}/verify-2fa`, { code, sessionId: data.sessionId })
            .then(r => r.json())
            .then(() => { queryClient.invalidateQueries({ queryKey: ["/api/reconciliations"] }); toast({ title: "Login erfolgreich" }); })
            .catch(() => toast({ title: "2FA fehlgeschlagen", variant: "destructive" }));
        }
      } else if (data.success) {
        markMutation.mutate({ platformId: vars.platformId, status: "matched", notes: `Auto-Login: ${data.invoiceAmount} ${data.invoiceCurrency}` });
        toast({ title: `${data.platformName}: Beleg gefunden` });
      } else {
        toast({ title: data.message || "Login fehlgeschlagen", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  if (!recon) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <p className="text-xs font-semibold tracking-widest mb-2" style={{ color: "#F2C831" }}>SCHRITT 3</p>
        <h1 className="text-3xl font-extrabold text-white" style={{ fontFamily: "'Inter Tight', sans-serif", letterSpacing: "-0.03em" }}>
          Abgleich
        </h1>
        <div className="rounded-2xl p-12 text-center" style={{ background: "rgba(0,76,93,0.2)", border: "1px solid rgba(0,182,223,0.1)" }}>
          <FileText size={40} className="mx-auto mb-4" style={{ color: "rgba(0,182,223,0.4)" }} />
          <p className="font-bold text-white mb-2">Noch kein Abgleich vorhanden</p>
          <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>Lade zuerst eine Kreditkartenabrechnung hoch</p>
          <Link href="/upload">
            <a className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm" style={{ background: "#F2C831", color: "#001F26" }}>
              <Zap size={15} /> Abrechnung hochladen
            </a>
          </Link>
        </div>
      </div>
    );
  }

  const platformResults = recon.platformResults as PlatformResult[];
  const missingReceipts = recon.missingReceipts as Transaction[];
  const matched = platformResults.filter(r => r.status === "matched");
  const fuzzy = platformResults.filter(r => r.status === "fuzzy_match");
  const noInvoice = platformResults.filter(r => r.status === "no_invoice");
  const manual = platformResults.filter(r => ["needs_manual", "waiting_2fa"].includes(r.status));
  const progressPct = platformResults.length ? (matched.length / platformResults.length) * 100 : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest mb-2" style={{ color: "#F2C831" }}>SCHRITT 3</p>
          <h1 className="text-3xl font-extrabold text-white" style={{ fontFamily: "'Inter Tight', sans-serif", letterSpacing: "-0.03em" }}>
            Abgleich-Ergebnis
          </h1>
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
            {new Date(recon.createdAt).toLocaleDateString("de-CH", { day: "2-digit", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {matched.length > 0 && <Badge label={`${matched.length} OK`} color="#4ade80" />}
          {fuzzy.length > 0 && <Badge label={`${fuzzy.length} Vorschlag`} color="#F2C831" />}
          {noInvoice.length > 0 && <Badge label={`${noInvoice.length} Offen`} color="rgba(0,182,223,0.7)" />}
          {matched.length > 0 && (
            <a
              href={`/api/reconciliations/${recon.id}/download-zip`}
              download
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all hover:scale-105 hover:opacity-90"
              style={{ background: "#F2C831", color: "#001F26" }}
              title={`${matched.length} abgeglichene Belege als ZIP herunterladen`}
            >
              <Download size={13} />
              ZIP ({matched.length} Belege)
            </a>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="rounded-2xl p-5" style={{ background: "rgba(0,76,93,0.25)", border: "1px solid rgba(0,182,223,0.1)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold tracking-wide" style={{ color: "#00B6DF" }}>FORTSCHRITT</p>
          <p className="text-sm font-bold text-white">
            {matched.length}<span style={{ color: "rgba(255,255,255,0.3)" }}>/{platformResults.length}</span>
          </p>
        </div>
        <div className="bb-progress h-2">
          <div className="bb-progress-bar h-2" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* ── Belege-Tools banners ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Apple banner – only when Apple tx detected */}
        {appleTxData && appleTxData.count > 0 && (
          <Link href="/apple-receipts">
            <a
              data-testid="banner-apple-receipts"
              className="flex items-center gap-3 rounded-2xl px-5 py-4 transition-all hover:scale-[1.01] cursor-pointer"
              style={{ background: "rgba(242,200,49,0.07)", border: "1px solid rgba(242,200,49,0.35)" }}
            >
              <div className="p-2 rounded-xl flex-shrink-0" style={{ background: "rgba(242,200,49,0.12)" }}>
                <Apple size={18} style={{ color: "#F2C831" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">
                  {appleTxData.count} Apple-Buchung{appleTxData.count !== 1 ? "en" : ""} auf Kreditkarte
                </p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                  Belege automatisch von reportaproblem.apple.com holen
                </p>
              </div>
              <ChevronRight size={16} style={{ color: "rgba(242,200,49,0.6)" }} className="flex-shrink-0" />
            </a>
          </Link>
        )}

        {/* E-Mail Scanner banner – always visible */}
        <Link href="/email-scanner">
          <a
            data-testid="banner-email-scanner"
            className="flex items-center gap-3 rounded-2xl px-5 py-4 transition-all hover:scale-[1.01] cursor-pointer"
            style={{ background: "rgba(0,182,223,0.05)", border: "1px solid rgba(0,182,223,0.15)" }}
          >
            <div className="p-2 rounded-xl flex-shrink-0" style={{ background: "rgba(0,182,223,0.1)" }}>
              <Mail size={18} style={{ color: "#00B6DF" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">E-Mail Rechnungen scannen</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                Gmail, iCloud Mail, Outlook – nur kreditkartengematchte Rechnungen
              </p>
            </div>
            <ChevronRight size={16} style={{ color: "rgba(0,182,223,0.4)" }} className="flex-shrink-0" />
          </a>
        </Link>

        {/* Desktop Apps banner – always visible */}
        <Link href="/desktop-receipts">
          <a
            data-testid="banner-desktop-receipts"
            className="flex items-center gap-3 rounded-2xl px-5 py-4 transition-all hover:scale-[1.01] cursor-pointer"
            style={{ background: "rgba(0,182,223,0.05)", border: "1px solid rgba(0,182,223,0.12)" }}
          >
            <div className="p-2 rounded-xl flex-shrink-0" style={{ background: "rgba(0,182,223,0.08)" }}>
              <Monitor size={18} style={{ color: "#00B6DF" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">Desktop-App Belege holen</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                Soundly, Figma, Notion & mehr – direkt aus dem Kundenportal
              </p>
            </div>
            <ChevronRight size={16} style={{ color: "rgba(0,182,223,0.4)" }} className="flex-shrink-0" />
          </a>
        </Link>
      </div>

      {/* ── Fuzzy matches – need confirmation ─────────────────────────────── */}
      {fuzzy.length > 0 && (
        <Section title="VORSCHLÄGE PRÜFEN" count={fuzzy.length} color="#F2C831"
          subtitle="Betrag stimmt überein, Name weicht ab – bitte bestätigen">
          {fuzzy.map(r => (
            <FuzzyCard
              key={r.platformId}
              result={r}
              onConfirm={() => confirmMutation.mutate(r.platformId)}
              onReject={() => rejectMutation.mutate(r.platformId)}
              isPending={confirmMutation.isPending || rejectMutation.isPending}
            />
          ))}
        </Section>
      )}

      {/* ── Confirmed matches ──────────────────────────────────────────────── */}
      {matched.length > 0 && (
        <Section title="ABGEGLICHEN" count={matched.length} color="#4ade80">
          {matched.map(r => (
            <PlatformCard key={r.platformId} result={r}
              onMark={markMutation.mutate}
              onAutoLogin={autoLoginMutation.mutate}
              autoLoginPending={autoLoginMutation.isPending}
            />
          ))}
        </Section>
      )}

      {/* ── No invoice found ───────────────────────────────────────────────── */}
      {noInvoice.length > 0 && (
        <Section title="KEIN BELEG GEFUNDEN" count={noInvoice.length} color="rgba(0,182,223,0.6)">
          {noInvoice.map(r => (
            <PlatformCard key={r.platformId} result={r}
              onMark={markMutation.mutate}
              onAutoLogin={autoLoginMutation.mutate}
              autoLoginPending={autoLoginMutation.isPending}
            />
          ))}
        </Section>
      )}

      {/* ── Needs manual ───────────────────────────────────────────────────── */}
      {manual.length > 0 && (
        <Section title="MANUELL PRÜFEN" count={manual.length} color="#F2C831">
          {manual.map(r => (
            <PlatformCard key={r.platformId} result={r}
              onMark={markMutation.mutate}
              onAutoLogin={autoLoginMutation.mutate}
              autoLoginPending={autoLoginMutation.isPending}
            />
          ))}
        </Section>
      )}

      {/* ── Unmatched transactions ─────────────────────────────────────────── */}
      {missingReceipts.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(242,200,49,0.04)", border: "1px solid rgba(242,200,49,0.15)" }}>
          <button className="flex items-center gap-3 px-6 py-4 w-full" onClick={() => setExpandedMissing(e => !e)} data-testid="button-toggle-missing">
            <Receipt size={16} style={{ color: "#F2C831" }} />
            <span className="text-xs font-bold tracking-wide" style={{ color: "#F2C831" }}>
              OFFENE TRANSAKTIONEN ({missingReceipts.length})
            </span>
            <span className="ml-auto" style={{ color: "rgba(255,255,255,0.3)" }}>
              {expandedMissing ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
          </button>
          {expandedMissing && (
            <div className="px-6 pb-4 space-y-2">
              <p className="text-xs mb-4" style={{ color: "rgba(255,255,255,0.35)" }}>
                Kreditkarten-Transaktionen ohne zugeordneten Plattform-Beleg
              </p>
              {missingReceipts.map((tx, i) => (
                <div key={i} className="flex items-center justify-between py-2.5" style={{ borderBottom: "1px solid rgba(0,182,223,0.08)" }}>
                  <div className="flex items-center gap-3">
                    <span className="text-base">{CAT_EMOJI[tx.category ?? "Sonstiges"] ?? "💳"}</span>
                    <div>
                      <p className="text-sm font-medium text-white truncate max-w-[260px]">{tx.description}</p>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>{tx.date} · {tx.category}</p>
                    </div>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <span className="font-bold text-sm block" style={{ color: "#F2C831" }}>
                      {tx.amount.toFixed(2)} {tx.currency}
                    </span>
                    {tx.currency !== "CHF" && (
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>≈ CHF</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-xs px-3 py-1 rounded-full" style={{ background: "rgba(0,76,93,0.4)", color, border: `1px solid ${color}30` }}>
      {label}
    </span>
  );
}

function Section({ title, count, color, subtitle, children }: {
  title: string; count: number; color: string; subtitle?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 mb-3 w-full text-left">
        <span className="text-xs font-bold tracking-wide" style={{ color }}>{title}</span>
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,76,93,0.5)", color: "rgba(255,255,255,0.4)" }}>{count}</span>
        {subtitle && <span className="text-xs ml-1" style={{ color: "rgba(255,255,255,0.3)" }}>– {subtitle}</span>}
        <span className="ml-auto" style={{ color: "rgba(255,255,255,0.25)" }}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

// Fuzzy match card with big confirm/reject buttons
function FuzzyCard({ result, onConfirm, onReject, isPending }: {
  result: PlatformResult;
  onConfirm: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  const tx = result.matchedTransaction;
  return (
    <div className="rounded-xl p-4" style={{ background: "rgba(242,200,49,0.06)", border: "1px solid rgba(242,200,49,0.3)" }}
      data-testid={`fuzzy-card-${result.platformId}`}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="mt-0.5 flex-shrink-0">
          <ArrowRightLeft size={16} style={{ color: "#F2C831" }} />
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-white">{result.platformName}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "rgba(242,200,49,0.12)", color: "#F2C831", border: "1px solid rgba(242,200,49,0.3)" }}>
              {result.matchConfidence}% Übereinstimmung
            </span>
          </div>
          {/* Match reason */}
          {result.matchReason && (
            <p className="text-xs mt-1.5 font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>
              {result.matchReason}
            </p>
          )}
          {/* Card transaction details */}
          {tx && (
            <div className="mt-2 rounded-lg px-3 py-2 flex items-center justify-between"
              style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div>
                <p className="text-xs font-medium text-white truncate max-w-[240px]">{tx.description}</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{tx.date}</p>
              </div>
              <div className="text-right ml-3 flex-shrink-0">
                <p className="text-sm font-bold" style={{ color: "#F2C831" }}>
                  {tx.amount.toFixed(2)} {tx.currency}
                </p>
                {result.invoiceAmountChf && tx.currency !== "CHF" && (
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                    = CHF {result.invoiceAmountChf.toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          )}
          {/* Hint */}
          <p className="text-xs mt-2" style={{ color: "rgba(255,255,255,0.3)" }}>
            Gehört diese Kreditkarten-Buchung zu <strong style={{ color: "rgba(255,255,255,0.55)" }}>{result.platformName}</strong>?
            Bei Bestätigung wird das automatisch gelernt.
          </p>
        </div>
        {/* Action buttons */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            onClick={onConfirm}
            disabled={isPending}
            data-testid={`btn-confirm-${result.platformId}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
            style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }}
          >
            <ThumbsUp size={13} /> Ja
          </button>
          <button
            onClick={onReject}
            disabled={isPending}
            data-testid={`btn-reject-${result.platformId}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
            style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <ThumbsDown size={13} /> Nein
          </button>
        </div>
      </div>
    </div>
  );
}

function PlatformCard({ result, onMark, onAutoLogin, autoLoginPending }: {
  result: PlatformResult;
  onMark: (args: { platformId: number; status: string; notes?: string }) => void;
  onAutoLogin: (args: { platformId: number }) => void;
  autoLoginPending: boolean;
}) {
  const cfg = STATUS_CONFIG[result.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
  const tx = result.matchedTransaction;

  return (
    <div className="rounded-xl px-5 py-4 flex items-center gap-4 transition-all duration-200"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
      data-testid={`platform-result-${result.platformId}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm text-white">{result.platformName}</span>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
            {cfg.label}
          </span>
          {result.matchConfidence !== undefined && result.matchConfidence >= 90 && (
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              {result.matchConfidence}%
            </span>
          )}
        </div>
        {/* Matched transaction details */}
        {result.status === "matched" && tx && (
          <div className="mt-1">
            <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.4)" }}>
              {tx.date} · {tx.description}
            </p>
            <p className="text-xs font-semibold mt-0.5" style={{ color: "#4ade80" }}>
              {tx.amount.toFixed(2)} {tx.currency}
              {result.invoiceAmountChf && tx.currency !== "CHF" && (
                <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}> = CHF {result.invoiceAmountChf.toFixed(2)}</span>
              )}
            </p>
          </div>
        )}
        {result.notes && result.status !== "matched" && (
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{result.notes}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <a href={result.platformUrl} target="_blank" rel="noopener noreferrer"
          className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: "rgba(255,255,255,0.3)" }}>
          <ExternalLink size={13} />
        </a>
        {result.status !== "matched" && (
          <button
            onClick={() => onAutoLogin({ platformId: result.platformId })}
            disabled={autoLoginPending}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all hover:scale-105"
            style={{ background: "rgba(0,182,223,0.1)", color: "#00B6DF", border: "1px solid rgba(0,182,223,0.2)" }}
          >
            Auto-Login
          </button>
        )}
        {result.status !== "matched" ? (
          <button
            onClick={() => onMark({ platformId: result.platformId, status: "matched", notes: "Manuell bestätigt" })}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all hover:scale-105"
            style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.2)" }}
          >
            ✓ OK
          </button>
        ) : (
          <button
            onClick={() => onMark({ platformId: result.platformId, status: "needs_manual", notes: "" })}
            className="text-xs px-2 py-1.5 rounded-lg transition-all"
            style={{ color: "rgba(255,255,255,0.25)" }}
          >
            ↩
          </button>
        )}
      </div>
    </div>
  );
}
