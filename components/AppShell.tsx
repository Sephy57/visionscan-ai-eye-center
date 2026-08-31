"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, IconName } from "./icons";

/**
 * Single application shell.
 * - ONE desktop sidebar (sticky)
 * - ONE topbar
 * - ONE mobile drawer (rendered ONLY when open; never duplicated into content)
 * - Research-environment banner (compact, always visible)
 */

const NAV: Array<{ section?: string; href?: string; label?: string; icon?: IconName }> = [
  { section: "Workspace" },
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/analyze", label: "New Analysis", icon: "analysis" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/compare", label: "Compare", icon: "compare" },
  { section: "Clinical" },
  { href: "/clinician", label: "Clinical Review", icon: "review" },
  { href: "/report", label: "Reports", icon: "reports" },
  { section: "System" },
  { href: "/devices", label: "Devices", icon: "devices" },
  { href: "/admin", label: "System Status", icon: "status" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {NAV.map((item) =>
        item.section ? (
          <div className="nav-section" key={item.section}>{item.section}</div>
        ) : (
          <Link
            key={item.href}
            href={item.href!}
            className={`nav-link${pathname === item.href ? " active" : ""}`}
            onClick={onNavigate}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            <Icon name={item.icon!} size={16} />
            {item.label}
          </Link>
        )
      )}
    </>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string>("light");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? "light");
  }, []);
  function toggle() {
    const t = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("vsa-theme", t); } catch {}
    setTheme(t);
  }
  return (
    <button className="btn ghost sm icon-btn" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title="Toggle dark mode">
      <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
    </button>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on navigation.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  // Escape closes the drawer; focus returns to the toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="banner-strip" role="note">
        <span className="banner-icon" aria-hidden="true">⚠</span>
        <span className="banner-text">
          <strong>RESEARCH ENVIRONMENT</strong>
          <span>Not validated for clinical use · Not a medical device · Demo/synthetic analysis</span>
        </span>
      </div>

      <div className="shell">
        <aside className="sidebar" aria-label="Main navigation">
          <Link href="/" className="brand">
            <span className="logo-mark" aria-hidden="true"><Icon name="eye" size={17} /></span>
            <span>VisionScan<span className="brand-sub"> AI</span></span>
          </Link>
          <NavLinks />
          <div className="sidebar-footer">
            <div>Research build · v0.4.0</div>
            <div>All analysis components: <strong>not validated</strong></div>
          </div>
        </aside>

        <div className="main-col">
          <header className="topbar">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="btn ghost sm icon-btn mobile-only-flex" onClick={() => setDrawerOpen(true)} aria-label="Open navigation menu" aria-expanded={drawerOpen}>
                <Icon name="menu" size={16} />
              </button>
              <span className="page-crumb mobile-only-flex" style={{ fontWeight: 700 }}>VisionScan AI</span>
            </div>
            <div className="topbar-actions">
              <Link href="/admin" className="status-chip" title="Open system status">
                <span className="dot dot-amber" aria-hidden="true" />
                Research environment
              </Link>
              <ThemeToggle />
            </div>
          </header>

          <main className="content" id="main-content">{children}</main>

          <footer className="app-footer">
            VisionScan AI is a clinical decision-support <strong>architecture</strong> under development. It does not
            diagnose disease, does not replace professional eye care, and has no regulatory authorization. Automated
            results are probabilistic, may be wrong, and require review by a qualified eye-care professional.
          </footer>
        </div>
      </div>

      {drawerOpen && (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <nav className="drawer" aria-label="Mobile navigation" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span className="brand"><span className="logo-mark"><Icon name="eye" size={17} /></span>VisionScan AI</span>
              <button className="btn ghost sm icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
                <Icon name="close" size={16} />
              </button>
            </div>
            <NavLinks onNavigate={() => setDrawerOpen(false)} />
          </nav>
        </div>
      )}
    </>
  );
}
