import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Platform, Statement, Reconciliation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Upload, ArrowRight, CheckCircle2, AlertCircle, Clock, Receipt, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: platforms = [], isLoading: loadingP } = useQuery<Platform[]>({ queryKey: ["/api/platforms"] });
  const { data: statements = [] } = useQuery<Statement[]>({ queryKey: ["/api/statements"] });
  const { data: reconciliations = [] } = useQuery<Reconciliation[]>({ queryKey: ["/api/reconciliations"] });

  const activePlatforms = platforms.filter(p => p.isActive);
  const latestStatement = statements[0];
  const latestReconciliation = reconciliations[0];
  const matchedCount = (latestReconciliation?.platformResults as any[])?.filter((r: any) => r.status === "matched").length ?? 0;
  const missingCount = latestReconciliation ? activePlatforms.length - matchedCount : null;
  const unmatchedTx = (latestReconciliation?.missingReceipts as any[])?.length ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest mb-2" style={{ color: "#F2C831" }}>MONATLICHER WORKFLOW</p>
          <h1 className="text-3xl font-extrabold text-white" style={{ fontFamily: "'Inter Tight', sans-serif", letterSpacing: "-0.03em" }}>
            Belegverwaltung
          </h1>
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>
            Kreditkarte abgleichen, Belege finden, fertig.
          </p>
        </div>
        <Link href="/upload">
          <Button
            className="gap-2 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all duration-200 hover:scale-105"
            style={{ background: "#F2C831", color: "#001F26", border: "none" }}
            data-testid="button-upload"
          >
            <Upload size={15} />
            Neue Abrechnung
          </Button>
        </Link>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Plattformen" value={String(activePlatforms.length)} icon="⚙️" accent="#00B6DF" />
        <StatCard label="Abgeglichen" value={latestReconciliation ? String(matchedCount) : "–"} icon="✓" accent="#4ade80" />
        <StatCard label="Fehlende Belege" value={missingCount !== null ? String(missingCount) : "–"} icon="!" accent={missingCount && missingCount > 0 ? "#F2C831" : "#4ade80"} />
        <StatCard label="Offen" value={latestReconciliation ? String(unmatchedTx) : "–"} icon="#" accent="rgba(255,255,255,0.4)" />
      </div>

      {/* ── 3-Step workflow ─────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(0,76,93,0.25)", border: "1px solid rgba(0,182,223,0.12)" }}>
        <div className="px-6 py-4" style={{ borderBottom: "1px solid rgba(0,182,223,0.1)" }}>
          <h2 className="text-sm font-bold tracking-wide" style={{ color: "#00B6DF" }}>WORKFLOW</h2>
        </div>
        <div className="divide-y" style={{ divideColor: "rgba(0,182,223,0.08)" }}>
          <WorkflowStep
            step={1} title="Kreditkartenabrechnung hochladen"
            description="PDF von PostFinance, Raiffeisen, ZKB oder UBS – Transaktionen werden automatisch erkannt"
            done={!!latestStatement} href="/upload" cta="PDF hochladen"
          />
          <WorkflowStep
            step={2} title="Automatischer Abgleich"
            description="Plattformen werden automatisch eingeloggt und Belege geholt"
            done={!!latestReconciliation}
            href={latestStatement ? `/reconciliation` : "/upload"} cta="Abgleich starten"
            disabled={!latestStatement}
          />
          <WorkflowStep
            step={3} title="Fehlende Belege prüfen"
            description="Sieh was noch fehlt – Tanken, Essen, etc."
            done={false}
            href={latestReconciliation ? `/reconciliation/${latestReconciliation.id}` : "/reconciliation"} cta="Ergebnis ansehen"
            disabled={!latestReconciliation}
          />
        </div>
      </div>

      {/* ── Platform grid ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold tracking-wide" style={{ color: "#00B6DF" }}>PLATTFORMEN ({activePlatforms.length})</h2>
          <Link href="/platforms">
            <a className="text-xs flex items-center gap-1 transition-colors hover:opacity-80" style={{ color: "#F2C831" }}>
              Verwalten <ArrowRight size={12} />
            </a>
          </Link>
        </div>
        {loadingP ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" style={{ background: "rgba(0,76,93,0.3)" }} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {activePlatforms.map(p => {
              const result = (latestReconciliation?.platformResults as any[])?.find((r: any) => r.platformId === p.id);
              const status = result?.status;
              return (
                <div
                  key={p.id}
                  data-testid={`platform-card-${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 hover:scale-[1.02]"
                  style={{
                    background: status === "matched" ? "rgba(74,222,128,0.06)" : "rgba(0,76,93,0.25)",
                    border: status === "matched" ? "1px solid rgba(74,222,128,0.2)" : "1px solid rgba(0,182,223,0.1)",
                  }}
                >
                  <StatusDot status={status} />
                  <span className="text-sm font-medium truncate" style={{ color: "rgba(255,255,255,0.85)" }}>{p.name}</span>
                  {p.has2fa && (
                    <span className="ml-auto text-xs px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ background: "rgba(242,200,49,0.12)", color: "#F2C831", border: "1px solid rgba(242,200,49,0.2)" }}>2FA</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Recent statements ───────────────────────────────────────────── */}
      {statements.length > 0 && (
        <div>
          <h2 className="text-sm font-bold tracking-wide mb-4" style={{ color: "#00B6DF" }}>LETZTE ABRECHNUNGEN</h2>
          <div className="space-y-2">
            {statements.slice(0, 3).map(s => {
              const recon = reconciliations.find(r => r.statementId === s.id);
              return (
                <div key={s.id} className="flex items-center justify-between px-5 py-3 rounded-xl"
                  style={{ background: "rgba(0,76,93,0.2)", border: "1px solid rgba(0,182,223,0.1)" }}>
                  <div>
                    <p className="text-sm font-semibold text-white">{s.filename}</p>
                    <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {(s.transactions as any[])?.length ?? 0} Transaktionen · {s.month}
                    </p>
                  </div>
                  {recon && (
                    <Link href={`/reconciliation/${recon.id}`}>
                      <a className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
                        style={{ background: "rgba(242,200,49,0.1)", color: "#F2C831", border: "1px solid rgba(242,200,49,0.2)" }}>
                        Abgleich <ArrowRight size={11} />
                      </a>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: string; accent: string }) {
  return (
    <div className="rounded-2xl px-5 py-5 transition-all duration-200 hover:scale-[1.02]"
      style={{ background: "rgba(0,76,93,0.25)", border: "1px solid rgba(0,182,223,0.1)" }}>
      <div className="text-xl mb-1">{icon}</div>
      <p className="stat-number text-2xl text-white">{value}</p>
      <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</p>
      <div className="mt-3 h-0.5 w-8 rounded-full" style={{ background: accent }} />
    </div>
  );
}

function StatusDot({ status }: { status?: string }) {
  const colors: Record<string, string> = {
    matched: "#4ade80",
    no_invoice: "rgba(255,255,255,0.2)",
    needs_manual: "#F2C831",
    waiting_2fa: "#F2C831",
    pending: "rgba(255,255,255,0.2)",
  };
  return <span className="flex-shrink-0 w-2 h-2 rounded-full" style={{ background: colors[status ?? "pending"] ?? "rgba(255,255,255,0.2)" }} />;
}

function WorkflowStep({ step, title, description, done, href, cta, disabled }: {
  step: number; title: string; description: string; done: boolean;
  href: string; cta: string; disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-5 px-6 py-5">
      <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
        style={done
          ? { background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }
          : { background: "rgba(0,182,223,0.08)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(0,182,223,0.15)" }
        }>
        {done ? "✓" : step}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: done ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.9)" }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{description}</p>
      </div>
      {!disabled && (
        <Link href={href}>
          <a className="flex-shrink-0 text-xs px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5 transition-all hover:scale-105"
            style={done
              ? { background: "rgba(74,222,128,0.1)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.2)" }
              : { background: "#F2C831", color: "#001F26" }
            }>
            {cta} {!done && <ArrowRight size={12} />}
          </a>
        </Link>
      )}
    </div>
  );
}
