import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Platform, InsertPlatform } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Trash2, ExternalLink, Eye, EyeOff, AlertTriangle, Shield, Zap, Key, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  "AI / Voice", "AI / Video", "AI", "Cloud / Storage", "File Transfer",
  "Marketing", "Musik", "Online Shop", "Projektmanagement", "Video",
  "Werbung", "Software", "Reise", "Sonstiges",
];

const emptyForm = {
  name: "", url: "", username: "", password: "",
  isActive: true, has2fa: false, notes: "", category: "Software",
  lastChecked: null as null, lastInvoiceAmount: null as null, lastInvoiceCurrency: null as null,
};

export default function Platforms() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: platforms = [], isLoading } = useQuery<Platform[]>({ queryKey: ["/api/platforms"] });
  const [dialog, setDialog] = useState<{ open: boolean; editing?: Platform }>({ open: false });
  const [form, setForm] = useState({ ...emptyForm });
  const [showPass, setShowPass] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [testingLogin, setTestingLogin] = useState<number | null>(null);

  const openAdd = () => { setForm({ ...emptyForm }); setShowPass(false); setDialog({ open: true }); };
  const openEdit = (p: Platform) => {
    setForm({ name: p.name, url: p.url, username: p.username, password: p.password, isActive: p.isActive, has2fa: p.has2fa, notes: p.notes, category: p.category, lastChecked: null, lastInvoiceAmount: null, lastInvoiceCurrency: null });
    setDialog({ open: true, editing: p });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (dialog.editing) return apiRequest("PUT", `/api/platforms/${dialog.editing.id}`, form).then(r => r.json());
      return apiRequest("POST", `/api/platforms`, form).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platforms"] });
      toast({ title: dialog.editing ? "Plattform aktualisiert" : "Plattform hinzugefügt" });
      setDialog({ open: false });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/platforms/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platforms"] });
      toast({ title: "Plattform gelöscht" });
      setDeleteConfirm(null);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PUT", `/api/platforms/${id}`, { isActive }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/platforms"] }),
  });

  const testLoginMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/auto-login/${id}`).then(r => r.json()),
    onSuccess: (data, id) => {
      setTestingLogin(null);
      if (data.requires2fa) {
        const code = window.prompt(`2FA-Code für ${data.platformName}:`);
        if (code) {
          apiRequest("POST", `/api/auto-login/${id}/verify-2fa`, { code, sessionId: data.sessionId })
            .then(() => toast({ title: "Login erfolgreich ✓" }))
            .catch(() => toast({ title: "2FA fehlgeschlagen", variant: "destructive" }));
        }
      } else if (data.success) {
        toast({ title: `Login erfolgreich – Beleg: ${data.invoiceAmount ?? "gefunden"}` });
      } else {
        toast({ title: data.message || "Login fehlgeschlagen", description: "Bitte Login-Daten prüfen", variant: "destructive" });
      }
    },
    onError: (e: Error, id) => {
      setTestingLogin(null);
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    },
  });

  const byCategory = platforms.reduce<Record<string, Platform[]>>((acc, p) => {
    (acc[p.category || "Software"] = acc[p.category || "Software"] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto space-y-7">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest mb-2" style={{ color: "#F2C831" }}>KONFIGURATION</p>
          <h1 className="text-3xl font-extrabold text-white" style={{ fontFamily: "'Inter Tight', sans-serif", letterSpacing: "-0.03em" }}>
            Plattformen
          </h1>
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
            Login-Daten, 2FA und automatischer Beleg-Download
          </p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105"
          style={{ background: "#F2C831", color: "#001F26" }}
          data-testid="button-add-platform">
          <Plus size={15} /> Hinzufügen
        </button>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 p-4 rounded-2xl" style={{ background: "rgba(0,182,223,0.06)", border: "1px solid rgba(0,182,223,0.15)" }}>
        <Shield size={16} style={{ color: "#00B6DF", flexShrink: 0, marginTop: 2 }} />
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
          <span className="font-bold" style={{ color: "#00B6DF" }}>Datenschutz:</span> Zugangsdaten werden nur im Arbeitsspeicher dieser App gespeichert und nie an Dritte weitergegeben. Sie werden gelöscht wenn du die App schliesst.
        </p>
      </div>

      {/* Platform groups */}
      {Object.entries(byCategory).map(([category, items]) => (
        <div key={category}>
          <p className="text-xs font-bold tracking-widest mb-3" style={{ color: "rgba(0,182,223,0.6)" }}>{category.toUpperCase()}</p>
          <div className="space-y-2">
            {items.map(p => (
              <div key={p.id} data-testid={`platform-item-${p.id}`}
                className="rounded-2xl px-5 py-4 flex items-center gap-4 transition-all duration-200"
                style={{
                  background: p.isActive ? "rgba(0,76,93,0.3)" : "rgba(0,76,93,0.1)",
                  border: p.isActive ? "1px solid rgba(0,182,223,0.12)" : "1px solid rgba(0,182,223,0.05)",
                  opacity: p.isActive ? 1 : 0.5,
                }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white">{p.name}</span>
                    {p.has2fa && (
                      <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "rgba(242,200,49,0.1)", color: "#F2C831", border: "1px solid rgba(242,200,49,0.2)" }}>
                        <Key size={9} /> 2FA
                      </span>
                    )}
                    {!p.username && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(242,200,49,0.08)", color: "#F2C831", border: "1px solid rgba(242,200,49,0.15)" }}>
                        Kein Login
                      </span>
                    )}
                    {p.username && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(74,222,128,0.08)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.15)" }}>
                        Bereit
                      </span>
                    )}
                  </div>
                  <p className="text-xs truncate mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{p.url}</p>
                  {p.notes && <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{p.notes}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.username && (
                    <button onClick={() => { setTestingLogin(p.id); testLoginMutation.mutate(p.id); }}
                      disabled={testLoginMutation.isPending}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all hover:scale-105 flex items-center gap-1"
                      style={{ background: "rgba(0,182,223,0.1)", color: "#00B6DF", border: "1px solid rgba(0,182,223,0.2)" }}
                      title="Auto-Login testen">
                      {testingLogin === p.id && testLoginMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                      Test
                    </button>
                  )}
                  <Switch checked={p.isActive} onCheckedChange={v => toggleActiveMutation.mutate({ id: p.id, isActive: v })}
                    data-testid={`switch-active-${p.id}`} />
                  <a href={p.url} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 transition-colors" style={{ color: "rgba(255,255,255,0.3)" }}>
                    <ExternalLink size={14} />
                  </a>
                  <button onClick={() => openEdit(p)} className="p-1.5 transition-colors hover:opacity-70"
                    style={{ color: "rgba(255,255,255,0.4)" }} data-testid={`button-edit-${p.id}`}>
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => setDeleteConfirm(p.id)} className="p-1.5 transition-colors hover:opacity-70"
                    style={{ color: "rgba(255,255,255,0.25)" }} data-testid={`button-delete-${p.id}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add/Edit dialog */}
      <Dialog open={dialog.open} onOpenChange={o => !o && setDialog({ open: false })}>
        <DialogContent className="max-w-md" style={{ background: "#001F26", border: "1px solid rgba(0,182,223,0.2)" }}>
          <DialogHeader>
            <DialogTitle className="text-white" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
              {dialog.editing ? "Plattform bearbeiten" : "Neue Plattform"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>NAME</Label>
                <Input placeholder="z.B. Dropbox" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={{ background: "rgba(0,76,93,0.3)", border: "1px solid rgba(0,182,223,0.15)", color: "white" }}
                  data-testid="input-platform-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>KATEGORIE</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger style={{ background: "rgba(0,76,93,0.3)", border: "1px solid rgba(0,182,223,0.15)", color: "white" }} data-testid="select-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ background: "#001F26", border: "1px solid rgba(0,182,223,0.2)" }}>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c} style={{ color: "white" }}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>URL (BILLING-SEITE)</Label>
              <Input placeholder="https://..." value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                style={{ background: "rgba(0,76,93,0.3)", border: "1px solid rgba(0,182,223,0.15)", color: "white" }}
                data-testid="input-platform-url" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>E-MAIL / BENUTZERNAME</Label>
              <Input placeholder="deine@email.com" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                style={{ background: "rgba(0,76,93,0.3)", border: "1px solid rgba(0,182,223,0.15)", color: "white" }}
                data-testid="input-platform-username" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>PASSWORT</Label>
              <div className="relative">
                <Input type={showPass ? "text" : "password"} placeholder="••••••••" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  style={{ background: "rgba(0,76,93,0.3)", border: "1px solid rgba(0,182,223,0.15)", color: "white", paddingRight: "2.5rem" }}
                  data-testid="input-platform-password" />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
                  style={{ color: "rgba(255,255,255,0.4)" }}>
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: "rgba(242,200,49,0.05)", border: "1px solid rgba(242,200,49,0.1)" }}>
              <div>
                <p className="text-sm font-semibold text-white">Zwei-Faktor-Authentifizierung</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>App fragt beim Login nach dem Code</p>
              </div>
              <Switch checked={form.has2fa} onCheckedChange={v => setForm(f => ({ ...f, has2fa: v }))} data-testid="switch-2fa" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>NOTIZEN (OPTIONAL)</Label>
              <Input placeholder="z.B. Firmenkonto, Quartalsabrechnung…" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                style={{ background: "rgba(0,76,93,0.3)", border: "1px solid rgba(0,182,223,0.15)", color: "white" }}
                data-testid="input-platform-notes" />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setDialog({ open: false })} className="px-4 py-2 rounded-xl text-sm transition-colors"
              style={{ color: "rgba(255,255,255,0.4)" }}>
              Abbrechen
            </button>
            <button onClick={() => saveMutation.mutate()} disabled={!form.name || !form.url || saveMutation.isPending}
              className="px-5 py-2 rounded-xl font-bold text-sm transition-all hover:scale-105"
              style={{ background: form.name && form.url ? "#F2C831" : "rgba(242,200,49,0.3)", color: "#001F26" }}
              data-testid="button-save-platform">
              {dialog.editing ? "Speichern" : "Hinzufügen"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteConfirm !== null} onOpenChange={o => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm" style={{ background: "#001F26", border: "1px solid rgba(0,76,93,0.5)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <AlertTriangle size={18} style={{ color: "#F2C831" }} />
              Plattform löschen?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Login-Daten werden ebenfalls gelöscht.</p>
          <DialogFooter>
            <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-xl text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
              Abbrechen
            </button>
            <button onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)}
              className="px-5 py-2 rounded-xl font-bold text-sm" style={{ background: "rgba(255,80,80,0.8)", color: "white" }}>
              Löschen
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
