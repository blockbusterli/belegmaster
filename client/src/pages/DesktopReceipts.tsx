/**
 * Desktop App Receipts Seite
 * Für macOS-Apps wie Soundly, Figma, Notion etc. die kein Web-Login über
 * die Auto-Login-Seite haben – nutzt das jeweilige Kundenportal.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Reconciliation, Transaction } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Monitor, Lock, Eye, EyeOff, ChevronRight, ArrowLeft,
  Loader2, CheckCircle2, AlertCircle, ShieldCheck, Camera,
  Apple,
} from "lucide-react";
import { Link } from "wouter";

type FlowStep = "select" | "login" | "twofa" | "fetching" | "done";

interface DesktopApp {
  id: string;
  name: string;
  type: string;
  portalUrl?: string;
  notes?: string;
}

interface ReceiptResult {
  transaction: Transaction;
  found: boolean;
  screenshotBase64?: string;
  message?: string;
}

export default function DesktopReceiptsPage() {
  const { toast } = useToast();
  const { data: reconciliations = [] } = useQuery<Reconciliation[]>({ queryKey: ["/api/reconciliations"] });
  const recon = reconciliations[0];

  const { data: appsData } = useQuery({
    queryKey: ["/api/desktop/apps"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/desktop/apps");
      return r.json() as Promise<{ apps: DesktopApp[] }>;
    },
  });

  const [step, setStep] = useState<FlowStep>("select");
  const [selectedApp, setSelectedApp] = useState<DesktopApp | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [results, setResults] = useState<ReceiptResult[]>([]);
  const [progress, setProgress] = useState(0);

  const loginMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/desktop/login", {
        appId: selectedApp!.id,
        username,
        password,
      }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.requires2fa) {
        setSessionId(data.sessionId);
        setStep("twofa");
      } else if (data.success) {
        setSessionId(data.sessionId);
        startFetching(data.sessionId);
      } else {
        toast({ title: data.message || "Login fehlgeschlagen", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const twoFaMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/desktop/verify-2fa", { sessionId, code: twoFaCode }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.success) {
        startFetching(sessionId);
      } else {
        toast({ title: data.message || "Code falsch", variant: "destructive" });
      }
    },
  });

  const fetchMutation = useMutation({
    mutationFn: (sid: string) =>
      apiRequest("POST", "/api/desktop/fetch-receipts", {
        sessionId: sid,
        reconciliationId: recon!.id,
      }).then(r => r.json()),
    onSuccess: (data) => {
      setResults(data.results || []);
      setStep("done");
      apiRequest("POST", "/api/desktop/close", { sessionId }).catch(() => {});
    },
    onError: (e: Error) => {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
      setStep("login");
    },
  });

  function startFetching(sid: string) {
    setStep("fetching");
    setProgress(0);
    const iv = setInterval(() => setProgress(p => p >= 90 ? (clearInterval(iv), 90) : p + 12), 700);
    fetchMutation.mutate(sid, { onSettled: () => { clearInterval(iv); setProgress(100); } });
  }

  const apps = appsData?.apps || [];
  const portalApps = apps.filter(a => a.type === "portal");
  const appStoreApps = apps.filter(a => a.type === "app_store");
  const foundCount = results.filter(r => r.found).length;

  if (!recon) {
    return (
      <div className="max-w-lg mx-auto space-y-6 pt-4">
        <BackLink />
        <div className="rounded-2xl p-12 text-center" style={{ background: "rgba(0,76,93,0.2)", border: "1px solid rgba(0,182,223,0.1)" }}>
          <Monitor size={36} className="mx-auto mb-4" style={{ color: "rgba(0,182,223,0.4)" }} />
          <p className="font-bold text-white mb-2">Kein Abgleich vorhanden</p>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
            Lade zuerst eine Kreditkartenabrechnung hoch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6 pt-4">
      <BackLink />

      {/* Header */}
      <div>
        <p className="text-xs font-semibold tracking-widest mb-2" style={{ color: "#F2C831" }}>
          DESKTOP APPS
        </p>
        <h1 className="text-3xl font-extrabold text-white"
          style={{ fontFamily: "'Inter Tight', sans-serif", letterSpacing: "-0.03em" }}>
          Desktop-App Belege
        </h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          Rechnungen aus macOS-Apps automatisch holen – Soundly, Figma, Notion & mehr.
        </p>
      </div>

      {/* ── Select App ────────────────────────────────────────────── */}
      {step === "select" && (
        <div className="space-y-4">
          {/* Portal Apps */}
          {portalApps.length > 0 && (
            <StepCard>
              <p className="text-xs font-bold tracking-wide mb-3" style={{ color: "#00B6DF" }}>
                APP-PORTALE
              </p>
              <div className="space-y-2">
                {portalApps.map(app => (
                  <button
                    key={app.id}
                    onClick={() => { setSelectedApp(app); setStep("login"); }}
                    data-testid={`app-${app.id}`}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.01]"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,182,223,0.12)" }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(242,200,49,0.3)")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(0,182,223,0.12)")}
                  >
                    <div className="p-2 rounded-lg flex-shrink-0"
                      style={{ background: "rgba(0,182,223,0.08)" }}>
                      <Monitor size={16} style={{ color: "#00B6DF" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{app.name}</p>
                      {app.notes && (
                        <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.35)" }}>
                          {app.notes}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={15} style={{ color: "rgba(255,255,255,0.25)" }} />
                  </button>
                ))}
              </div>
            </StepCard>
          )}

          {/* App Store hint */}
          {appStoreApps.length > 0 && (
            <div className="rounded-2xl p-5"
              style={{ background: "rgba(242,200,49,0.05)", border: "1px solid rgba(242,200,49,0.2)" }}>
              <div className="flex items-start gap-3">
                <Apple size={18} style={{ color: "#F2C831" }} className="flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-white mb-1">Mac App Store-Apps</p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                    Apps die über den Mac App Store gekauft wurden (Luminar, Screenium etc.)
                    erscheinen auf reportaproblem.apple.com – nutze den Apple Belege-Flow.
                  </p>
                  <Link href="/apple-receipts">
                    <a className="inline-flex items-center gap-1.5 text-xs font-semibold mt-2 transition-colors"
                      style={{ color: "#F2C831" }}>
                      Apple Belege-Flow öffnen <ChevronRight size={12} />
                    </a>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Login ─────────────────────────────────────────────────── */}
      {step === "login" && selectedApp && (
        <StepCard>
          <button
            onClick={() => setStep("select")}
            className="flex items-center gap-1.5 text-xs mb-4 transition-colors"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            <ArrowLeft size={13} /> App-Auswahl
          </button>

          <div className="flex items-center gap-3 mb-5 p-3 rounded-xl"
            style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(0,182,223,0.1)" }}>
            <div className="p-2 rounded-lg" style={{ background: "rgba(0,182,223,0.1)" }}>
              <Monitor size={16} style={{ color: "#00B6DF" }} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">{selectedApp.name}</p>
              {selectedApp.portalUrl && (
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>{selectedApp.portalUrl}</p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                E-Mail / Benutzername
              </label>
              <input
                type="email"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="name@example.com"
                data-testid="input-desktop-username"
                className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none transition-all"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,182,223,0.2)" }}
                onFocus={e => e.target.style.borderColor = "rgba(242,200,49,0.5)"}
                onBlur={e => e.target.style.borderColor = "rgba(0,182,223,0.2)"}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                Passwort
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  data-testid="input-desktop-password"
                  className="w-full px-4 py-3 pr-10 rounded-xl text-sm text-white outline-none transition-all"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,182,223,0.2)" }}
                  onFocus={e => e.target.style.borderColor = "rgba(242,200,49,0.5)"}
                  onBlur={e => e.target.style.borderColor = "rgba(0,182,223,0.2)"}
                  onKeyDown={e => e.key === "Enter" && loginMutation.mutate()}
                />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "rgba(255,255,255,0.3)" }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            <Lock size={12} className="mt-0.5 flex-shrink-0" />
            <p>Zugangsdaten werden nur für diese Session verwendet und nie gespeichert.</p>
          </div>

          <button
            onClick={() => loginMutation.mutate()}
            disabled={!username || !password || loginMutation.isPending}
            data-testid="btn-desktop-login"
            className="mt-5 w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] disabled:opacity-40"
            style={{ background: "#F2C831", color: "#001F26" }}
          >
            {loginMutation.isPending
              ? <><Loader2 size={15} className="animate-spin" /> Einloggen…</>
              : <><Monitor size={15} /> Einloggen & Belege holen <ChevronRight size={15} /></>
            }
          </button>
        </StepCard>
      )}

      {/* ── 2FA ───────────────────────────────────────────────────── */}
      {step === "twofa" && (
        <StepCard>
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 rounded-xl"
              style={{ background: "rgba(242,200,49,0.12)", border: "1px solid rgba(242,200,49,0.25)" }}>
              <ShieldCheck size={20} style={{ color: "#F2C831" }} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">2-Faktor-Authentifizierung</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                Code an {selectedApp?.name} eingeben
              </p>
            </div>
          </div>
          <input
            type="text" inputMode="numeric" maxLength={6}
            value={twoFaCode}
            onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            data-testid="input-desktop-2fa"
            className="w-full px-4 py-4 rounded-xl text-center text-2xl font-bold tracking-[0.5em] text-white outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(242,200,49,0.3)", fontFamily: "'Inter Tight', sans-serif" }}
            onKeyDown={e => e.key === "Enter" && twoFaCode.length >= 6 && twoFaMutation.mutate()}
            autoFocus
          />
          <button
            onClick={() => twoFaMutation.mutate()}
            disabled={twoFaCode.length < 6 || twoFaMutation.isPending}
            data-testid="btn-desktop-2fa-submit"
            className="mt-4 w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] disabled:opacity-40"
            style={{ background: "#F2C831", color: "#001F26" }}
          >
            {twoFaMutation.isPending
              ? <><Loader2 size={15} className="animate-spin" /> Prüfen…</>
              : <>Bestätigen & weiter <ChevronRight size={15} /></>
            }
          </button>
        </StepCard>
      )}

      {/* ── Fetching ──────────────────────────────────────────────── */}
      {step === "fetching" && (
        <StepCard>
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
              style={{ background: "rgba(242,200,49,0.1)", border: "1px solid rgba(242,200,49,0.25)" }}>
              <Camera size={28} style={{ color: "#F2C831" }} />
            </div>
            <p className="font-bold text-white mb-1">Belege werden abgerufen…</p>
            <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>
              {selectedApp?.name} – Rechnungsseite wird durchsucht
            </p>
            <div className="bb-progress h-2 mb-3">
              <div className="bb-progress-bar h-2 transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{progress}%</p>
          </div>
        </StepCard>
      )}

      {/* ── Done ──────────────────────────────────────────────────── */}
      {step === "done" && (
        <div className="space-y-4">
          <StepCard>
            <div className="flex items-center gap-3 mb-4">
              {foundCount > 0
                ? <CheckCircle2 size={22} style={{ color: "#4ade80" }} />
                : <AlertCircle size={22} style={{ color: "#F2C831" }} />}
              <p className="font-bold text-white">
                {foundCount} von {results.length} Belege gefunden – {selectedApp?.name}
              </p>
            </div>
            <div className="space-y-3">
              {results.map((r, i) => (
                <div key={i} className="rounded-xl overflow-hidden"
                  style={{ border: `1px solid ${r.found ? "rgba(74,222,128,0.2)" : "rgba(242,200,49,0.2)"}` }}>
                  <div className="px-4 py-3 flex items-center justify-between"
                    style={{ background: r.found ? "rgba(74,222,128,0.06)" : "rgba(242,200,49,0.04)" }}>
                    <div>
                      <p className="text-sm font-medium text-white truncate max-w-[240px]">
                        {r.transaction.description}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                        {r.transaction.date} · {r.transaction.amount.toFixed(2)} {r.transaction.currency}
                      </p>
                      {r.message && (
                        <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>{r.message}</p>
                      )}
                    </div>
                    <span className="text-xs px-2 py-1 rounded-lg flex-shrink-0 ml-3 font-semibold"
                      style={{
                        background: r.found ? "rgba(74,222,128,0.12)" : "rgba(242,200,49,0.1)",
                        color: r.found ? "#4ade80" : "#F2C831",
                      }}>
                      {r.found ? "✓ Screenshot" : "Manuell prüfen"}
                    </span>
                  </div>
                  {r.screenshotBase64 && (
                    <div className="p-3" style={{ background: "rgba(0,0,0,0.15)" }}>
                      <img
                        src={`data:image/png;base64,${r.screenshotBase64}`}
                        alt="Receipt Screenshot"
                        className="w-full rounded-lg"
                        style={{ maxHeight: 180, objectFit: "cover", objectPosition: "top" }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </StepCard>

          <div className="flex gap-3">
            <button
              onClick={() => { setStep("select"); setResults([]); setSelectedApp(null); }}
              className="flex-1 py-3 rounded-xl font-bold text-sm transition-all"
              style={{ background: "rgba(0,182,223,0.08)", color: "#00B6DF", border: "1px solid rgba(0,182,223,0.2)" }}
            >
              Andere App
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
