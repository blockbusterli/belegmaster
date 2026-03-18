/**
 * Apple Receipts Page
 * Guided flow: detect Apple transactions on card → login → auto-fetch receipts
 * IMPORTANT: Only processes Apple transactions that appear on the credit card statement.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Reconciliation, Transaction } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Apple, ShieldCheck, Loader2, CheckCircle2, AlertCircle,
  Camera, ChevronRight, Lock, Eye, EyeOff, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

type FlowStep =
  | "detect"       // checking how many Apple tx are on card
  | "login"        // enter Apple ID + password
  | "twofa"        // enter 2FA code
  | "fetching"     // auto-fetching receipts
  | "done"         // all screenshots captured
  | "no_apple";    // no Apple transactions found

interface ReceiptResult {
  transaction: Transaction;
  found: boolean;
  screenshotBase64?: string;
  searchedDescription: string;
  message?: string;
}

export default function AppleReceiptsPage() {
  const { toast } = useToast();
  const { data: reconciliations = [] } = useQuery<Reconciliation[]>({ queryKey: ["/api/reconciliations"] });
  const recon = reconciliations[0];

  const [step, setStep] = useState<FlowStep>("detect");
  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [appleTx, setAppleTx] = useState<Transaction[]>([]);
  const [results, setResults] = useState<ReceiptResult[]>([]);
  const [progress, setProgress] = useState(0);

  // Detect Apple transactions
  const detectQuery = useQuery({
    queryKey: ["/api/apple/transactions", recon?.id],
    enabled: !!recon?.id,
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/apple/transactions/${recon!.id}`);
      const data = await r.json() as { transactions: Transaction[]; count: number };
      setAppleTx(data.transactions);
      if (data.count === 0) setStep("no_apple");
      else setStep("login");
      return data;
    },
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/apple/login", { appleId, password }).then(r => r.json()),
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

  // 2FA mutation
  const twoFaMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/apple/verify-2fa", { sessionId, code: twoFaCode }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.success) {
        startFetching(sessionId);
      } else {
        toast({ title: data.message || "Code falsch", variant: "destructive" });
      }
    },
  });

  // Fetch receipts mutation
  const fetchMutation = useMutation({
    mutationFn: (sid: string) =>
      apiRequest("POST", "/api/apple/fetch-receipts", {
        sessionId: sid,
        reconciliationId: recon!.id,
      }).then(r => r.json()),
    onSuccess: (data) => {
      setResults(data.results || []);
      setStep("done");
      // Close the browser session
      apiRequest("POST", "/api/apple/close", { sessionId }).catch(() => {});
    },
    onError: (e: Error) => {
      toast({ title: "Fehler beim Abrufen", description: e.message, variant: "destructive" });
      setStep("login");
    },
  });

  function startFetching(sid: string) {
    setStep("fetching");
    setProgress(0);
    // Simulate progress while fetching
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 90) { clearInterval(interval); return 90; }
        return p + 10;
      });
    }, 800);
    fetchMutation.mutate(sid, {
      onSettled: () => {
        clearInterval(interval);
        setProgress(100);
      },
    });
  }

  if (!recon) {
    return (
      <div className="max-w-lg mx-auto space-y-6 pt-4">
        <BackLink />
        <EmptyState
          icon={<Apple size={36} style={{ color: "rgba(0,182,223,0.4)" }} />}
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
          APPLE BELEGE
        </p>
        <h1 className="text-3xl font-extrabold text-white" style={{ fontFamily: "'Inter Tight', sans-serif", letterSpacing: "-0.03em" }}>
          Apple Receipts
        </h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          Nur Käufe die auch auf deiner Kreditkarte stehen werden abgerufen.
        </p>
      </div>

      {/* ── Step: Detect ───────────────────────────────────────── */}
      {step === "detect" && (
        <StepCard>
          <div className="flex items-center gap-3">
            <Loader2 size={20} className="animate-spin" style={{ color: "#00B6DF" }} />
            <p className="text-sm text-white">Apple-Transaktionen werden erkannt…</p>
          </div>
        </StepCard>
      )}

      {/* ── Step: No Apple transactions ────────────────────────── */}
      {step === "no_apple" && (
        <EmptyState
          icon={<CheckCircle2 size={36} style={{ color: "#4ade80" }} />}
          title="Keine Apple-Transaktionen gefunden"
          subtitle="Auf dieser Kreditkartenabrechnung sind keine Apple/iTunes/App Store Buchungen."
        />
      )}

      {/* ── Step: Login ────────────────────────────────────────── */}
      {step === "login" && (
        <StepCard>
          {/* Apple tx summary */}
          <div className="mb-5 rounded-xl p-4" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(0,182,223,0.12)" }}>
            <p className="text-xs font-bold tracking-wide mb-3" style={{ color: "#00B6DF" }}>
              {appleTx.length} APPLE-BUCHUNG{appleTx.length !== 1 ? "EN" : ""} AUF KREDITKARTE
            </p>
            <div className="space-y-2">
              {appleTx.map((tx, i) => (
                <div key={i} className="flex justify-between items-center">
                  <p className="text-xs text-white truncate max-w-[240px]">{tx.description}</p>
                  <span className="text-xs font-bold ml-2 flex-shrink-0" style={{ color: "#F2C831" }}>
                    {tx.amount.toFixed(2)} {tx.currency}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Login form */}
          <p className="text-sm font-semibold text-white mb-4">
            Apple ID eingeben – die App loggt selbständig ein
          </p>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "rgba(255,255,255,0.5)" }}>
                Apple ID (E-Mail)
              </label>
              <input
                type="email"
                value={appleId}
                onChange={e => setAppleId(e.target.value)}
                placeholder="name@example.com"
                data-testid="input-apple-id"
                className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none transition-all"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(0,182,223,0.2)",
                }}
                onFocus={e => e.target.style.borderColor = "rgba(242,200,49,0.5)"}
                onBlur={e => e.target.style.borderColor = "rgba(0,182,223,0.2)"}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "rgba(255,255,255,0.5)" }}>
                Passwort
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  data-testid="input-apple-password"
                  className="w-full px-4 py-3 pr-10 rounded-xl text-sm text-white outline-none transition-all"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(0,182,223,0.2)",
                  }}
                  onFocus={e => e.target.style.borderColor = "rgba(242,200,49,0.5)"}
                  onBlur={e => e.target.style.borderColor = "rgba(0,182,223,0.2)"}
                  onKeyDown={e => e.key === "Enter" && loginMutation.mutate()}
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

          <div className="mt-4 flex items-start gap-2 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            <Lock size={12} className="mt-0.5 flex-shrink-0" />
            <p>Login-Daten werden nur für diese Session verwendet und nie gespeichert.</p>
          </div>

          <button
            onClick={() => loginMutation.mutate()}
            disabled={!appleId || !password || loginMutation.isPending}
            data-testid="btn-apple-login"
            className="mt-5 w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] disabled:opacity-40"
            style={{ background: "#F2C831", color: "#001F26" }}
          >
            {loginMutation.isPending
              ? <><Loader2 size={15} className="animate-spin" /> Einloggen…</>
              : <><Apple size={15} /> Einloggen & Belege holen <ChevronRight size={15} /></>
            }
          </button>
        </StepCard>
      )}

      {/* ── Step: 2FA ──────────────────────────────────────────── */}
      {step === "twofa" && (
        <StepCard>
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 rounded-xl" style={{ background: "rgba(242,200,49,0.12)", border: "1px solid rgba(242,200,49,0.25)" }}>
              <ShieldCheck size={20} style={{ color: "#F2C831" }} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">2-Faktor-Authentifizierung</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                Apple hat einen Code an dein Gerät / deine E-Mail gesendet
              </p>
            </div>
          </div>

          {/* OTP input */}
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={twoFaCode}
            onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            data-testid="input-apple-2fa"
            className="w-full px-4 py-4 rounded-xl text-center text-2xl font-bold tracking-[0.5em] text-white outline-none transition-all"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(242,200,49,0.3)",
              fontFamily: "'Inter Tight', sans-serif",
            }}
            onKeyDown={e => e.key === "Enter" && twoFaCode.length === 6 && twoFaMutation.mutate()}
            autoFocus
          />

          <button
            onClick={() => twoFaMutation.mutate()}
            disabled={twoFaCode.length < 6 || twoFaMutation.isPending}
            data-testid="btn-apple-2fa-submit"
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

      {/* ── Step: Fetching ─────────────────────────────────────── */}
      {step === "fetching" && (
        <StepCard>
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
              style={{ background: "rgba(242,200,49,0.1)", border: "1px solid rgba(242,200,49,0.25)" }}>
              <Camera size={28} style={{ color: "#F2C831" }} />
            </div>
            <p className="text-base font-bold text-white mb-1">Belege werden abgerufen…</p>
            <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>
              Die App sucht {appleTx.length} Apple-Buchung{appleTx.length !== 1 ? "en" : ""} auf reportaproblem.apple.com
            </p>

            {/* Progress bar */}
            <div className="bb-progress h-2 mb-3">
              <div className="bb-progress-bar h-2 transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{progress}%</p>

            {/* Step list */}
            <div className="mt-6 space-y-2 text-left">
              {[
                "Auf reportaproblem.apple.com navigieren",
                "Käufe nach Betrag suchen",
                `${appleTx.length} Screenshot${appleTx.length !== 1 ? "s" : ""} aufnehmen`,
                "Belege im Abgleich speichern",
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3 text-xs"
                  style={{ color: progress > i * 25 ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)" }}>
                  {progress > (i + 1) * 25
                    ? <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
                    : progress > i * 25
                    ? <Loader2 size={14} className="animate-spin" style={{ color: "#F2C831" }} />
                    : <div className="w-3.5 h-3.5 rounded-full border" style={{ borderColor: "rgba(255,255,255,0.15)" }} />
                  }
                  {step}
                </div>
              ))}
            </div>
          </div>
        </StepCard>
      )}

      {/* ── Step: Done ─────────────────────────────────────────── */}
      {step === "done" && (
        <div className="space-y-4">
          <StepCard>
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 size={22} style={{ color: "#4ade80" }} />
              <p className="text-base font-bold text-white">
                {results.filter(r => r.found).length} von {results.length} Belege gefunden
              </p>
            </div>
            <div className="space-y-3">
              {results.map((r, i) => (
                <div key={i} className="rounded-xl overflow-hidden"
                  style={{ border: `1px solid ${r.found ? "rgba(74,222,128,0.2)" : "rgba(242,200,49,0.2)"}` }}>
                  <div className="px-4 py-3 flex items-center justify-between"
                    style={{ background: r.found ? "rgba(74,222,128,0.06)" : "rgba(242,200,49,0.06)" }}>
                    <div>
                      <p className="text-sm font-medium text-white truncate max-w-[260px]">
                        {r.transaction.description}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                        {r.transaction.date} · {r.transaction.amount.toFixed(2)} {r.transaction.currency}
                      </p>
                      {r.message && (
                        <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>{r.message}</p>
                      )}
                    </div>
                    <span className="text-xs px-2 py-1 rounded-lg flex-shrink-0 ml-3 font-semibold"
                      style={{
                        background: r.found ? "rgba(74,222,128,0.12)" : "rgba(242,200,49,0.12)",
                        color: r.found ? "#4ade80" : "#F2C831",
                      }}>
                      {r.found ? "✓ Screenshot" : "Manuell prüfen"}
                    </span>
                  </div>
                  {/* Screenshot preview */}
                  {r.screenshotBase64 && (
                    <div className="p-3" style={{ background: "rgba(0,0,0,0.15)" }}>
                      <img
                        src={`data:image/png;base64,${r.screenshotBase64}`}
                        alt="Apple Receipt Screenshot"
                        className="w-full rounded-lg"
                        style={{ maxHeight: 200, objectFit: "cover", objectPosition: "top" }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </StepCard>

          <Link href="/reconciliation">
            <a className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm transition-all hover:scale-[1.01]"
              style={{ background: "#F2C831", color: "#001F26" }}>
              Zum Abgleich <ChevronRight size={15} />
            </a>
          </Link>
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
