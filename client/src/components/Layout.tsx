import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import {
  LayoutDashboard, Upload, FileText, Settings,
  Sun, Moon, Menu, X, Mail, Monitor, Apple,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import PerplexityAttribution from "@/components/PerplexityAttribution";
import bbLogoSrc from "@assets/bb-logo.svg";
const bbLogo = bbLogoSrc;

const navItems = [
  { href: "/",                  label: "Dashboard",   icon: LayoutDashboard },
  { href: "/upload",            label: "Abrechnung",  icon: Upload },
  { href: "/reconciliation",    label: "Abgleich",    icon: FileText },
  { href: "/platforms",         label: "Plattformen", icon: Settings },
];

const toolItems = [
  { href: "/apple-receipts",    label: "Apple Belege",    icon: Apple },
  { href: "/email-scanner",     label: "E-Mail Scanner",  icon: Mail },
  { href: "/desktop-receipts",  label: "Desktop Apps",    icon: Monitor },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useHashLocation();
  const [dark, setDark] = useState(true); // BB is dark-first
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
  }, [dark]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bb-black)" }}>
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className={cn(
        "flex flex-col border-r z-40 transition-all duration-300",
        "fixed inset-y-0 left-0 w-64 -translate-x-full md:relative md:translate-x-0",
        mobileOpen && "translate-x-0"
      )}
        style={{
          background: "linear-gradient(180deg, #001F26 0%, #002d38 100%)",
          borderColor: "rgba(0,182,223,0.12)",
        }}
      >
        {/* Logo area – Blockbusterli logo top */}
        <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: "rgba(0,182,223,0.1)" }}>
          <div className="flex items-start justify-between">
            {/* BB Logo SVG – transparent background, white + yellow */}
            <div>
              <img
                src={bbLogo}
                alt="Blockbusterli"
                style={{ height: 32, width: "auto", display: "block" }}
              />
              <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md"
                style={{ background: "rgba(242,200,49,0.12)", border: "1px solid rgba(242,200,49,0.25)" }}>
                <span style={{ color: "#F2C831", fontSize: "0.6rem", letterSpacing: "0.14em", fontFamily: "'Inter Tight', sans-serif", fontWeight: 700 }}>
                  BELEGMASTER
                </span>
              </div>
            </div>
            <button className="md:hidden text-white/50 hover:text-white mt-1" onClick={() => setMobileOpen(false)}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = location === href || (href !== "/" && location.startsWith(href));
            return (
              <Link key={href} href={href}>
                <a
                  data-testid={`nav-${label.toLowerCase()}`}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                    active
                      ? "text-white"
                      : "text-white/50 hover:text-white/80 hover:bg-white/5"
                  )}
                  style={active ? {
                    background: "linear-gradient(135deg, rgba(242,200,49,0.15), rgba(0,182,223,0.08))",
                    border: "1px solid rgba(242,200,49,0.2)",
                    color: "#F2C831",
                  } : {}}
                >
                  <Icon size={17} className={active ? "" : "opacity-60"} />
                  {label}
                  {active && <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "#F2C831" }} />}
                </a>
              </Link>
            );
          })}

          {/* Belege-Tools section */}
          <div className="pt-3 pb-1">
            <p className="px-4 text-xs font-semibold tracking-widest mb-2" style={{ color: "rgba(0,182,223,0.5)" }}>
              BELEGE-TOOLS
            </p>
            {toolItems.map(({ href, label, icon: Icon }) => {
              const active = location.startsWith(href);
              return (
                <Link key={href} href={href}>
                  <a
                    data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                      active
                        ? "text-white"
                        : "text-white/40 hover:text-white/70 hover:bg-white/5"
                    )}
                    style={active ? {
                      background: "linear-gradient(135deg, rgba(242,200,49,0.12), rgba(0,182,223,0.06))",
                      border: "1px solid rgba(242,200,49,0.18)",
                      color: "#F2C831",
                    } : {}}
                  >
                    <Icon size={15} className={active ? "" : "opacity-50"} />
                    {label}
                    {active && <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "#F2C831" }} />}
                  </a>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 space-y-2" style={{ borderTop: "1px solid rgba(0,182,223,0.1)" }}>
          <button
            onClick={() => setDark(d => !d)}
            data-testid="theme-toggle"
            className="flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm transition-colors text-white/40 hover:text-white/70 hover:bg-white/5"
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
            {dark ? "Helles Design" : "Dunkles Design"}
          </button>
          <PerplexityAttribution />
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setMobileOpen(false)} />
      )}

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile topbar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3"
          style={{ background: "#001F26", borderBottom: "1px solid rgba(0,182,223,0.12)" }}>
          <button onClick={() => setMobileOpen(true)} className="text-white/60">
            <Menu size={20} />
          </button>
          <img src={bbLogo} alt="Blockbusterli" style={{ height: 24, width: "auto" }} />
        </div>

        <main className="flex-1 overflow-y-auto p-6 md:p-8"
          style={{ background: "linear-gradient(135deg, #001F26 0%, #001a20 100%)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
