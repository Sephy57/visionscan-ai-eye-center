"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, IconName } from "./icons";
import { authFetch } from "@/lib/auth/clientFetch";

/**
 * Single application shell.
 * - ONE desktop sidebar (sticky, collapsible to an icon rail)
 * - ONE topbar with location, environment state, user and theme
 * - ONE mobile drawer (rendered ONLY when open; never duplicated into content)
 * - Research-environment boundary strip (compact, always visible)
 *
 * Every nav entry is a real route in app/. Do not add entries without a page.
 */

type NavItem = { href: string; label: string; icon: IconName };
const NAV: Array<{ section: string; items: NavItem[] }> = [
  { section: "Overview", items: [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  ] },
  { section: "Clinical workspace", items: [
    { href: "/patients", label: "Patients", icon: "patients" },
    { href: "/analyze", label: "New Analysis", icon: "analysis" },
    { href: "/history", label: "Studies & History", icon: "history" },
    { href: "/compare", label: "Compare", icon: "compare" },
  ] },
  { section: "Review", items: [
    { href: "/clinician", label: "Clinical Review", icon: "review" },
    { href: "/report", label: "Reports", icon: "reports" },
  ] },
  { section: "AI & Research", items: [
    { href: "/models", label: "Models", icon: "model" },
    { href: "/evaluations", label: "Evaluations", icon: "flask" },
    { href: "/validation", label: "Validation", icon: "shield" },
    { href: "/validation-center", label: "Validation Center", icon: "layers" },
  ] },
  { section: "System", items: [
    { href: "/devices", label: "Devices", icon: "devices" },
    { href: "/admin", label: "System Status", icon: "activity" },
    { href: "/settings", label: "Settings", icon: "settings" },
  ] },
];

/** Location labels for routes that are reached from inside a workflow rather than the nav. */
const WORKFLOW_ROUTES: Record<string, [string, string]> = {
  "/processing": ["Clinical workspace", "Analysis in progress"],
  "/result": ["Clinical workspace", "Results workspace"],
  "/login": ["", "Sign in"],
  "/access-denied": ["", "Access denied"],
  "/": ["", "Overview"],
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function locationFor(pathname: string): [string, string] {
  for (const group of NAV) {
    const item = group.items.find((i) => isActive(pathname, i.href));
    if (item) return [group.section, item.label];
  }
  return WORKFLOW_ROUTES[pathname] ?? ["", "VisionScan AI"];
}

function PendingHint() {
  const { pending } = useLinkStatus();
  return pending ? <span className="spinner sm" aria-hidden="true" style={{ marginLeft: "auto" }} /> : null;
}

function NavLinks({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <>
      {NAV.map((group) => (
        <div className="nav-group" key={group.section}>
          <div className="nav-section" aria-hidden={collapsed || undefined}><span className="nav-section-label">{group.section}</span></div>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link${active ? " active" : ""}`}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
              >
                <Icon name={item.icon} size={17} />
                <span className="nav-label">{item.label}</span>
                <PendingHint />
              </Link>
            );
          })}
        </div>
      ))}
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
    <button className="btn ghost sm icon-btn" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title="Toggle colour theme">
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

  const [logoutError, setLogoutError] = useState<string | null>(null);
  async function logout() {
    setLogoutError(null);
    const res = await authFetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    // Never show the sign-in screen while the session is still active.
    if (!res?.ok) {
      setLogoutError("Sign-out did not complete — your session is still active. Reload the page and try again.");
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  if (!session?.authenticated || !session.user) {
    return <Link href="/login" className="btn secondary sm">Sign in</Link>;
  }
  const initials = session.user.username.slice(0, 2).toUpperCase();
  return (
    <div className="user-chip">
      <span className="status-chip" role="status" aria-label={`Signed in as ${session.user.username}, role ${session.user.role}`}>
        <span className="avatar" aria-hidden="true">{initials}</span>
        <span className="status-chip-label"><span className="user-name">{session.user.username}</span> · {session.user.role}</span>
      </span>
      <button className="btn ghost sm" onClick={logout}><Icon name="logout" size={14} /> Sign out</button>
      {logoutError && <span className="logout-error" role="alert">{logoutError}</span>}
    </div>
  );
}

const COLLAPSE_KEY = "vsa-sidebar-collapsed";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [section, page] = locationFor(pathname);
  const wide = pathname === "/result" || pathname === "/clinician";

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* storage blocked: stay expanded */ }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch {}
      return !c;
    });
  }

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
        <span className="banner-icon" aria-hidden="true"><Icon name="shield" size={13} /></span>
        <span className="banner-text">
          <strong>RESEARCH ENVIRONMENT</strong>
          <span className="banner-detail">Not validated for clinical use</span>
          <span className="banner-sep banner-detail" aria-hidden="true" />
          <span className="banner-detail">Not a medical device</span>
          <span className="banner-sep banner-detail" aria-hidden="true" />
          <span className="banner-detail">Every AI output requires qualified human review</span>
        </span>
      </div>

      <div className={`shell${collapsed ? " collapsed" : ""}`}>
        <aside className="sidebar" aria-label="Main navigation">
          <Link href="/" className="brand" title={collapsed ? "VisionScan AI — overview" : undefined}>
            <span className="logo-mark" aria-hidden="true"><Icon name="eye" size={18} /></span>
            <span className="brand-text">
              <span className="brand-name">VisionScan <em>AI</em></span>
              <span className="brand-sub">Eye Center Intelligence</span>
            </span>
          </Link>
          <NavLinks collapsed={collapsed} />
          <div className="sidebar-footer">
            <div className="sidebar-footer-text">Research build · all analysis components <strong>not clinically validated</strong></div>
            <button className="btn ghost sm icon-btn collapse-btn" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed}>
              <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={15} />
            </button>
          </div>
        </aside>

        <div className="main-col">
          <header className="topbar">
            <div className="topbar-left">
              <button ref={menuButtonRef} className="btn ghost sm icon-btn mobile-only-flex" onClick={() => setDrawerOpen(true)} aria-label="Open navigation menu" aria-expanded={drawerOpen} aria-controls="mobile-navigation-drawer">
                <Icon name="menu" size={17} />
              </button>
              <span className="page-crumb">
                {section && <>{section} <span aria-hidden="true">/</span> </>}<strong>{page}</strong>
              </span>
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

          <main className={`content${wide ? " wide" : ""}`} id="main-content" tabIndex={-1}>{children}</main>

          <footer className="app-footer">
            <Icon name="shield" size={15} />
            <span>
              VisionScan AI is a clinical decision-support <strong>research architecture</strong>. It does not diagnose disease,
              does not replace professional eye care, and has no regulatory authorization. Automated results are probabilistic,
              may be wrong, and require review by a qualified eye-care professional.
            </span>
          </footer>
        </div>
      </div>

      {drawerOpen && (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <div ref={drawerRef} id="mobile-navigation-drawer" className="drawer" aria-label="Navigation menu" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span className="brand">
                <span className="logo-mark" aria-hidden="true"><Icon name="eye" size={17} /></span>
                <span className="brand-text"><span className="brand-name">VisionScan <em>AI</em></span><span className="brand-sub">Eye Center Intelligence</span></span>
              </span>
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
