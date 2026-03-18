import { useState, useCallback } from "react";
import { useHashLocation } from "wouter/use-hash-location";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, X, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface UploadResult {
  statement: { id: number; filename: string; month: string };
  transactionCount: number;
}

export default function UploadPage() {
  const [, navigate] = useHashLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/statements/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<UploadResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/statements"] });
      toast({ title: `${data.transactionCount} Transaktionen erkannt` });
    },
    onError: (e: Error) => {
      toast({ title: "Fehler beim Upload", description: e.message, variant: "destructive" });
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async (statementId: number) => {
      return apiRequest("POST", `/api/reconcile/${statementId}`).then(r => r.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliations"] });
      navigate(`/reconciliation/${data.id}`);
    },
    onError: (e: Error) => {
      toast({ title: "Fehler beim Abgleich", description: e.message, variant: "destructive" });
    },
  });

  const handleFiles = useCallback((files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (f.type !== "application/pdf") {
      toast({ title: "Nur PDF-Dateien erlaubt", variant: "destructive" });
      return;
    }
    uploadMutation.mutate(f);
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold tracking-widest mb-2" style={{ color: "#F2C831" }}>SCHRITT 1</p>
        <h1 className="text-3xl font-extrabold text-white" style={{ fontFamily: "'Inter Tight', sans-serif", letterSpacing: "-0.03em" }}>
          Abrechnung hochladen
        </h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          Lade deine Kreditkartenabrechnung als PDF hoch
        </p>
      </div>

      {!result ? (
        <label
          data-testid="upload-dropzone"
          className={`dropzone flex flex-col items-center justify-center gap-5 p-14 cursor-pointer text-center ${dragging ? "active" : ""}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        >
          <input type="file" accept="application/pdf" className="hidden"
            onChange={e => handleFiles(e.target.files)} data-testid="input-file" />

          {uploadMutation.isPending ? (
            <>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center bb-glow-pulse"
                style={{ background: "rgba(242,200,49,0.1)", border: "1px solid rgba(242,200,49,0.3)" }}>
                <Loader2 size={28} className="animate-spin" style={{ color: "#F2C831" }} />
              </div>
              <div>
                <p className="text-base font-bold text-white">PDF wird eingelesen…</p>
                <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>Transaktionen werden erkannt</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center transition-all"
                style={{ background: "rgba(0,182,223,0.1)", border: "1px solid rgba(0,182,223,0.25)" }}>
                <Upload size={28} style={{ color: "#00B6DF" }} />
              </div>
              <div>
                <p className="text-base font-bold text-white">PDF hier ablegen</p>
                <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>oder klicken zum Auswählen</p>
              </div>
              <span className="text-xs px-3 py-1 rounded-full" style={{ background: "rgba(0,182,223,0.1)", color: "#00B6DF", border: "1px solid rgba(0,182,223,0.2)" }}>
                PostFinance · Raiffeisen · ZKB · UBS · Credit Suisse
              </span>
            </>
          )}
        </label>
      ) : (
        <div className="rounded-2xl p-6 space-y-5" style={{ background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.2)" }}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(74,222,128,0.1)" }}>
                <CheckCircle2 size={20} style={{ color: "#4ade80" }} />
              </div>
              <div>
                <p className="font-bold text-white">{result.statement.filename}</p>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{result.statement.month}</p>
              </div>
            </div>
            <button onClick={() => setResult(null)} style={{ color: "rgba(255,255,255,0.3)" }} className="hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background: "rgba(0,76,93,0.3)" }}>
            <div className="text-center">
              <p className="stat-number text-3xl text-white">{result.transactionCount}</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Transaktionen</p>
            </div>
            <div className="h-8 w-px" style={{ background: "rgba(0,182,223,0.2)" }} />
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
              {result.transactionCount === 0
                ? "Keine Transaktionen erkannt – das Format wird möglicherweise nicht unterstützt. Abgleich trotzdem möglich."
                : "Transaktionen erfolgreich eingelesen. Jetzt Abgleich starten."}
            </p>
          </div>

          {result.transactionCount === 0 && (
            <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(242,200,49,0.08)", border: "1px solid rgba(242,200,49,0.2)" }}>
              <AlertCircle size={16} style={{ color: "#F2C831", flexShrink: 0, marginTop: 2 }} />
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                Tipp: Lade das offizielle PDF direkt aus deiner Bank-App – keine gescannten Dokumente oder Screenshots.
              </p>
            </div>
          )}

          <button
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-xl"
            style={{ background: reconcileMutation.isPending ? "rgba(242,200,49,0.7)" : "#F2C831", color: "#001F26" }}
            onClick={() => reconcileMutation.mutate(result.statement.id)}
            disabled={reconcileMutation.isPending}
            data-testid="button-reconcile"
          >
            {reconcileMutation.isPending
              ? <><Loader2 size={16} className="animate-spin" /> Gleiche ab…</>
              : <><Zap size={16} /> Abgleich starten</>
            }
          </button>
        </div>
      )}

      {/* Tips */}
      <div className="rounded-2xl p-5" style={{ background: "rgba(0,76,93,0.2)", border: "1px solid rgba(0,182,223,0.1)" }}>
        <p className="text-xs font-bold tracking-wide mb-3" style={{ color: "#00B6DF" }}>TIPPS FÜR BESSERE ERKENNUNG</p>
        <ul className="space-y-2">
          {[
            "Offizielle PDF-Abrechnung direkt aus der Bank-App – keine Screenshots",
            "Kreditkartenabrechnung wählen (nicht Kontoauszug)",
            "Das PDF muss Text enthalten – keine gescannten Bilder",
            "Funktioniert mit PostFinance, Raiffeisen, ZKB, UBS, Credit Suisse",
          ].map((tip, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
              <span className="flex-shrink-0 w-5 h-5 rounded-full text-xs flex items-center justify-center mt-0.5"
                style={{ background: "rgba(0,182,223,0.1)", color: "#00B6DF", border: "1px solid rgba(0,182,223,0.2)" }}>
                {i + 1}
              </span>
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
