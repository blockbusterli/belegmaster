/**
 * E-Mail Scanner Seite
 * Verbindet sich via IMAP mit dem E-Mail-Konto und sucht Rechnungs-E-Mails
 * die zu Kreditkartentransaktionen passen.
 *
 * WICHTIG: Nur E-Mails die zu einer Kreditkartenbuchung passen werden angezeigt.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Reconciliation, Transaction } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, Lock, Eye, EyeOff, ChevronRight, ArrowLeft,
  Loader2, CheckCircle2, AlertCircle, Search,
  Server, Inbox, FileText,
} from "lucide-react";
import { Link } from "wouter";

type FlowStep = "setup" | "connecting" | "scanning" | "done" | "no_recon";

interface ImapPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  tls: boolean;
}

interface EmailResult {
  transaction: Transaction;
  found: boolean;
  emailSubject?: string;
  emailFrom?: string;
  emailDate?: string;
  emailBody?: string;
  matchReason?: string;
  message?: string;
}

export default function EmailScannerPage() {
  const { toast } = useToast();
  const { data: reconciliations = [] } = useQuery<Reconciliation[]>({ queryKey: ["/api/reconciliations"] });
  const recon = reconciliations[0];

  const { data: presetsData } = useQuery({
    queryKey: ["/api/email/presets"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/email/presets");
      return r.json() as Promise<{ presets: ImapPreset[] }>;
    },
  });

  const [step, setStep] = useState<FlowStep>("setup");
  const [selectedPreset, setSelectedPreset] = useState<ImapPreset | null>(null);
  const [customHost, setCustomHost] = useState("");
  const [customPort, setCustomPort] = useState("993");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [useCustom, setUseCustom] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [results, setResults] = useState<EmailResult[]>([]);

  const connectMutation = useMutation({
    mutationFn: () => {
      const host = useCustom ? customHost : selectedPreset!.host;
      const port = useCustom ? parseInt(customPort) : selectedPreset!.port;
      return apiRequest("POST", "/api/email/connect", {
        host, port, user, password, tls: true,
      }).then(r => r.json());
    },
    onSuccess: (data) => {
      if (data.success) {
        setSessionId(data.sessionId);
        setStep("scanning");
        scanMutation.mutate(data.sessionId);
      } else {
        toast({ title: data.message || "Verbindung fehlgeschlagen", variant: "destructive" });
        setStep("setup");
      }
    },
    onError: (e: Error) => {
      toast({ title: "Verbindungsfehler", description: e.message, variant: "destructive" });
      setStep("setup");
    },
  });

  const scanMutation = useMutation({
    mutationFn: (sid: string) =>
      apiRequest("POST", "/api/email/scan", {
        sessionId: sid,
        reconciliationId: recon!.id,
      }).then(r => r.json()),
    onSuccess: (data) => {
      setResults(data.results || []);
      setStep("done");
      // Close session
      apiRequest("POST", "/api/email/close", { sessionId }).catch(() => {});
    },
    onError: (e: Error) => {
      toast({ title: "Scan fehlgeschlagen", description: e.message, variant: "destructive" });
      setStep("setup");
    },
  });

  function handleConnect() {
    if (!user || !password) return;
    if (!useCustom && !selectedPreset) return;
    setStep("connecting");
    connectMutation.mutate();
  }

  const presets = presetsData?.presets || [];
  const foundCount = results.filter(r => r.found).length;

  if (!recon) {
    return (
      <div className="max-w-lg mx-auto space-y-6 pt-4">
        <BackLink />
        <EmptyState
          icon={<Mail size={36} style={{ color: "rgba(0,182,223,0.4)" }} />}
          title="Kein Abgleich vorhanden"
          subtitle="Lade zuerst eine Kreditkartenabrechnung hoch und führe den Abgleich durch."
        />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6 pt-4">
      <BackLink />

      {/* Header */}
      <div>
        <p className="text-xs font-semibold tracking-widest mb-2" style={{ color: "#F2C831" }}>
          E-MAIL SCANNER
        </p>
        <h1 className="text-3xl font-extrabold text-white"
          style={{ fontFamily: "'Inter Tight', sans-serif", letterSpacing: "-0.03em" }}>
          Rechnungen aus E-Mails
        </h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          Nur E-Mails die zu Kreditkartenbuchungen passen werden angezeigt.
        </p>
      </div>

      {/* ── Setup ─────────────────────────────────────────────────── */}
      {step === "setup" && (
        <StepCard>
          {/* Provider selection */}
          <p className="text-xs font-bold tracking-wide mb-3" style={{ color: "#00B6DF" }}>
            E-MAIL-ANBIETER
          </p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {presets.map(p => (
              <button
                key={p.id}
                onClick={() => { setSelectedPreset(p); setUseCustom(false); }}
                data-testid={`preset-${p.id}`}
                className="px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-all"
                style={{
                  background: selectedPreset?.id === p.id && !useCustom
                    ? "rgba(242,200,49,0.12)"
                    : "rgba(255,255,255,0.04)",
                  border: selectedPreset?.id === p.id && !useCustom
                    ? "1px solid rgba(242,200,49,0.4)"
                    : "1px solid rgba(255,255,255,0.08)",
                  color: selectedPreset?.id === p.id && !useCustom ? "#F2C831" : "rgba(255,255,255,0.6)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Inbox size={14} />
                  {p.label}
                </div>
              </button>
            ))}
            <button
              onClick={() => { setUseCustom(true); setSelectedPreset(null); }}
              data-testid="preset-custom"
              className="px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-all"
              style={{
                background: useCustom ? "rgba(242,200,49,0.12)" : "rgba(255,255,255,0.04)",
                border: useCustom ? "1px solid rgba(242,200,49,0.4)" : "1px solid rgba(255,255,255,0.08)",
                color: useCustom ? "#F2C831" : "rgba(255,255,255,0.6)",
              }}
            >
              <div className="flex items-center gap-2">
                <Server size={14} />
                Benutzerdefiniert
              </div>
            </button>
          </div>

          {/* Custom IMAP fields */}
          {useCustom && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="col-span-2">
                <label className="text-xs font-medium mb-1 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                  IMAP-Server
                </label>
                <input
                  type="text"
                  value={customHost}
                  onChange={e => setCustomHost(e.target.value)}
                  placeholder="imap.example.com"
                  data-testid="input-imap-host"
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,182,223,0.2)" }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Port
                </label>
                <input
                  type="number"
                  value={customPort}
                  onChange={e => setCustomPort(e.target.value)}
                  data-testid="input-imap-port"
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,182,223,0.2)" }}
                />
              </div>
            </div>
          )}

          {/* Credentials */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                {selectedPreset?.id === "gmail" || selectedPreset?.id === "google-workspace"
                  ? "Gmail-Adresse" : "E-Mail-Adresse"}
              </label>
              <input
                type="email"
                value={user}
                onChange={e => setUser(e.target.value)}
                placeholder="name@example.com"
                data-testid="input-email-user"
                className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none transition-all"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,182,223,0.2)" }}
                onFocus={e => e.target.style.borderColor = "rgba(242,200,49,0.5)"}
                onBlur={e => e.target.style.borderColor = "rgba(0,182,223,0.2)"}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                {selectedPreset?.id === "gmail"
                  ? "App-Passwort (Google → Sicherheit → App-Passwörter)"
                  : selectedPreset?.id === "icloud"
                  ? "App-Passwort (appleid.apple.com → Sicherheit)"
                  : "Passwort"}
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  data-testid="input-email-password"
                  className="w-full px-4 py-3 pr-10 rounded-xl text-sm text-white outline-none transition-all"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,182,223,0.2)" }}
                  onFocus={e => e.target.style.borderColor = "rgba(242,200,49,0.5)"}
                  onBlur={e => e.target.style.borderColor = "rgba(0,182,223,0.2)"}
                  onKeyDown={e => e.key === "Enter" && handleConnect()}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>

          {/* Gmail hint */}
          {(selectedPreset?.id === "gmail" || selectedPreset?.id === "google-workspace") && (
            <div className="mt-3 rounded-xl px-4 py-3 text-xs"
              style={{ background: "rgba(0,182,223,0.06)", border: "1px solid rgba(0,182,223,0.15)", color: "rgba(255,255,255,0.5)" }}>
              <p className="font-semibold mb-1" style={{ color: "#00B6DF" }}>Gmail App-Passwort erstellen:</p>
              <p>Google Konto → Sicherheit → 2-Schritt-Verifizierung → App-Passwörter → «Mail» wählen</p>
            </div>
          )}
          {selectedPreset?.id === "icloud" && (
            <div className="mt-3 rounded-xl px-4 py-3 text-xs"
              style={{ background: "rgba(0,182,223,0.06)", border: "1px solid rgba(0,182,223,0.15)", color: "rgba(255,255,255,0.5)" }}>
              <p className="font-semibold mb-1" style={{ color: "#00B6DF" }}>iCloud App-Passwort:</p>
              <p>appleid.apple.com → Anmelden → Sicherheit → App-spezifische Passwörter</p>
            </div>
          )}

          <div className="mt-4 flex items-start gap-2 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            <Lock size={12} className="mt-0.5 flex-shrink-0" />
            <p>Zugangsdaten werden nur für diese Session verwendet und nie gespeichert.</p>
          </div>

          <button
            onClick={handleConnect}
            disabled={!user || !password || (!selectedPreset && !useCustom) || (useCustom && !customHost)}
            data-testid="btn-email-connect"
            className="mt-5 w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] disabled:opacity-40"
            style={{ background: "#F2C831", color: "#001F26" }}
          >
            <Mail size={15} /> Verbinden & E-Mails scannen <ChevronRight size={15} />
          </button>
        </StepCard>
      )}

      {/* ── Connecting ─────────────────────────────────────────────── */}
      {step === "connecting" && (
        <StepCard>
          <div className="text-center py-6">
            <Loader2 size={32} className="animate-spin mx-auto mb-4" style={{ color: "#00B6DF" }} />
            <p className="font-bold text-white mb-1">Verbindung wird hergestellt…</p>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
              {selectedPreset?.label || customHost}
            </p>
          </div>
        </StepCard>
      )}

      {/* ── Scanning ──────────────────────────────────────────────── */}
      {step === "scanning" && (
        <StepCard>
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
              style={{ background: "rgba(242,200,49,0.1)", border: "1px solid rgba(242,200,49,0.25)" }}>
              <Search size={28} style={{ color: "#F2C831" }} className="animate-pulse" />
            </div>
            <p className="font-bold text-white mb-1">E-Mails werden durchsucht…</p>
            <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>
              Letzte 90 Tage · nur Rechnungen die auf der Kreditkarte sind
            </p>
            <div className="space-y-2 text-left">
              {[
                "Posteingang öffnen",
                "Rechnungs-E-Mails filtern",
                "Mit Kreditkartenbuchungen abgleichen",
                "Ergebnis aufbereiten",
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
                  <Loader2 size={13} className="animate-spin flex-shrink-0" style={{ color: "#F2C831" }} />
                  {s}
                </div>
              ))}
            </div>
          </div>
        </StepCard>
      )}

      {/* ── Done ──────────────────────────────────────────────────── */}
      {step === "done" && (
        <div className="space-y-4">
          <StepCard>
            {/* Summary */}
            <div className="flex items-center gap-3 mb-5">
              {foundCount > 0
                ? <CheckCircle2 size={22} style={{ color: "#4ade80" }} />
                : <AlertCircle size={22} style={{ color: "#F2C831" }} />
              }
              <div>
                <p className="font-bold text-white">
                  {foundCount} von {results.length} E-Mail-Rechnungen gefunden
                </p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Nur Buchungen von deiner Kreditkarte
                </p>
              </div>
            </div>

            {/* Results list */}
            <div className="space-y-3">
              {results.map((r, i) => (
                <div key={i} className="rounded-xl overflow-hidden"
                  style={{ border: `1px solid ${r.found ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.06)"}` }}>
                  <div className="px-4 py-3"
                    style={{ background: r.found ? "rgba(74,222,128,0.05)" : "rgba(255,255,255,0.02)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {r.transaction.description}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                          {r.transaction.date} · {r.transaction.amount.toFixed(2)} {r.transaction.currency}
                        </p>
                        {r.found && r.emailSubject && (
                          <p className="text-xs mt-2 font-medium" style={{ color: "#4ade80" }}>
                            ✓ {r.emailSubject}
                          </p>
                        )}
                        {r.found && r.emailFrom && (
                          <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                            {r.emailFrom} · {r.emailDate}
                          </p>
                        )}
                        {r.found && r.matchReason && (
                          <p className="text-xs mt-1" style={{ color: "rgba(0,182,223,0.7)" }}>
                            {r.matchReason}
                          </p>
                        )}
                        {!r.found && r.message && (
                          <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                            {r.message}
                          </p>
                        )}
                      </div>
                      <span className="text-xs px-2 py-1 rounded-lg flex-shrink-0 font-semibold"
                        style={{
                          background: r.found ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.05)",
                          color: r.found ? "#4ade80" : "rgba(255,255,255,0.3)",
                        }}>
                        {r.found ? "✓ Gefunden" : "Nicht gefunden"}
                      </span>
                    </div>

                    {/* Email body preview */}
                    {r.found && r.emailBody && (
                      <div className="mt-2 px-3 py-2 rounded-lg text-xs font-mono leading-relaxed"
                        style={{ background: "rgba(0,0,0,0.2)", color: "rgba(255,255,255,0.4)", maxHeight: 80, overflow: "hidden" }}>
                        {r.emailBody.substring(0, 200)}…
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </StepCard>

          {/* Re-scan & back buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => { setStep("setup"); setResults([]); setSessionId(""); }}
              className="flex-1 py-3 rounded-xl font-bold text-sm transition-all hover:scale-[1.01]"
              style={{ background: "rgba(0,182,223,0.08)", color: "#00B6DF", border: "1px solid rgba(0,182,223,0.2)" }}
            >
              Nochmals scannen
            </button>
            <Link href="/reconciliation">
              <a className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all hover:scale-[1.01]"
                style={{ background: "#F2C831", color: "#001F26" }}>
                Zum Abgleich <ChevronRight size={15} />
              </a>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StepCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-6" style={{ background: "rgba(0,76,93,0.2)", border: "1px solid rgba(0,182,223,0.12)" }}>
      {children}
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="rounded-2xl p-12 text-center" style={{ background: "rgba(0,76,93,0.2)", border: "1px solid rgba(0,182,223,0.1)" }}>
      <div className="flex justify-center mb-4">{icon}</div>
      <p className="font-bold text-white mb-2">{title}</p>
      <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>{subtitle}</p>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/reconciliation">
      <a className="inline-flex items-center gap-1.5 text-xs transition-colors"
        style={{ color: "rgba(255,255,255,0.35)" }}
        onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}>
        <ArrowLeft size={13} /> Zurück zum Abgleich
      </a>
    </Link>
  );
}
