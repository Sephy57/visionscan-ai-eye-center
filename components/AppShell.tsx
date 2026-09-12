"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  { href: "/patients", label: "Patients", icon: "review" },
  { href: "/clinician", label: "Clinical Review", icon: "review" },
  { href: "/report", label: "Reports", icon: "reports" },
  { section: "System" },
  { href: "/models", label: "Models", icon: "devices" },
  { href: "/evaluations", label: "Evaluations", icon: "status" },
  { href: "/validation", label: "Validation", icon: "status" },
  { href: "/validation-center", label: "Validation Center", icon: "status" },
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
  const [theme, setTheme] = useState<string>("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? "dark");
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

interface SessionInfo { authenticated: boolean; user?: { username: string; role: string } }

function UserMenu() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then(setSession).catch(() => setSession({ authenticated: false }));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (!session?.authenticated || !session.user) {
    return (
      <Link href="/login" className="btn secondary sm">Sign in</Link>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="status-chip" role="status" title={session.user.role} aria-label={`Signed in as ${session.user.username}, role ${session.user.role}`}>
        <span className="dot dot-amber" aria-hidden="true" />
        <span className="status-chip-label">{session.user.username} · {session.user.role}</span>
      </span>
      <button className="btn ghost sm" onClick={logout}>Sign out</button>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Close the drawer on navigation.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  // The mobile drawer is a modal navigation surface: trap keyboard focus,
  // support Escape, and restore focus to the trigger when it closes.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : menuButtonRef.current;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (previous ?? menuButtonRef.current)?.focus();
    };
  }, [drawerOpen]);

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <div className="banner-strip" role="region" aria-label="Research environment notice">
        <span className="banner-icon" aria-hidden="true">⚠</span>
        <span className="banner-text">
          <strong>RESEARCH ENVIRONMENT</strong>
          <span>Not validated for clinical use · Not a medical device · Local research analysis; demo/synthetic fallback only</span>
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
              <button ref={menuButtonRef} className="btn ghost sm icon-btn mobile-only-flex" onClick={() => setDrawerOpen(true)} aria-label="Open navigation menu" aria-expanded={drawerOpen} aria-controls="mobile-navigation-drawer">
                <Icon name="menu" size={16} />
              </button>
              <span className="page-crumb mobile-only-flex" style={{ fontWeight: 700 }}>VisionScan AI</span>
            </div>
            <div className="topbar-actions">
              <Link href="/admin" className="status-chip" title="Open system status" aria-label="Research environment — open system status">
                <span className="dot dot-amber" aria-hidden="true" />
                <span className="status-chip-label">Research environment</span>
              </Link>
              <UserMenu />
              <ThemeToggle />
            </div>
          </header>

          <main className="content" id="main-content" tabIndex={-1}>{children}</main>

          <footer className="app-footer">
            VisionScan AI is a clinical decision-support <strong>architecture</strong> under development. It does not
            diagnose disease, does not replace professional eye care, and has no regulatory authorization. Automated
            results are probabilistic, may be wrong, and require review by a qualified eye-care professional.
          </footer>
        </div>
      </div>

      {drawerOpen && (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <div ref={drawerRef} id="mobile-navigation-drawer" className="drawer" aria-label="Navigation menu" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span className="brand"><span className="logo-mark"><Icon name="eye" size={17} /></span>VisionScan AI</span>
              <button ref={closeButtonRef} className="btn ghost sm icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
                <Icon name="close" size={16} />
              </button>
            </div>
            <nav aria-label="Mobile navigation"><NavLinks onNavigate={() => setDrawerOpen(false)} /></nav>
          </div>
        </div>
      )}
    </>
  );
}
