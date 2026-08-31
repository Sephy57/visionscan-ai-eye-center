import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "VisionScan AI — Ophthalmic Analysis Workspace",
  description:
    "AI-assisted eye and retinal scan analysis. Screening architecture for clinical review — not a medical device; not validated for clinical use.",
};

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('vsa-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

const NAV = [
  { section: "Workspace" },
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/analyze", label: "New Analysis", icon: "＋" },
  { href: "/history", label: "History", icon: "≣" },
  { href: "/compare", label: "Compare", icon: "⇄" },
  { section: "Clinical" },
  { href: "/clinician", label: "Clinical Review", icon: "✓" },
  { href: "/report", label: "Reports", icon: "▤" },
  { section: "System" },
  { href: "/devices", label: "Devices", icon: "◎" },
  { href: "/admin", label: "System Status", icon: "⚙" },
  { href: "/settings", label: "Settings", icon: "☂" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div className="banner-strip" role="note">
          NOT VALIDATED &middot; NOT A MEDICAL DEVICE &middot; DEMO/SYNTHETIC ANALYSIS &middot; NOT FOR CLINICAL USE
        </div>
        <div className="shell">
          <aside className="sidebar" aria-label="Main navigation">
            <Link href="/" className="brand">
              <span className="logo-mark" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5C6.5 5 2.6 9.6 1.5 12c1.1 2.4 5 7 10.5 7s9.4-4.6 10.5-7C21.4 9.6 17.5 5 12 5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                  <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </span>
              VisionScan<span style={{ color: "var(--text-3)", fontWeight: 500 }}>&nbsp;AI</span>
            </Link>
            {NAV.map((item) =>
              "section" in item ? (
                <div className="nav-section" key={item.section}>{item.section}</div>
              ) : (
                <Link key={item.href} href={item.href} className="nav-link">
                  <span aria-hidden="true" style={{ width: 18, textAlign: "center" }}>{item.icon}</span>
                  {item.label}
                </Link>
              )
            )}
            <div className="sidebar-footer">
              VisionScan AI is a screening architecture under development.<br />
              All analysis components: <strong>not validated</strong>.
            </div>
          </aside>

          <div className="main-col">
            <header className="topbar">
              <div className="page-crumb mobile-only" style={{ fontWeight: 700 }}>
                VisionScan AI
              </div>
              <div className="topbar-actions">
                <ThemeToggle />
              </div>
            </header>
            <nav className="mobile-nav" aria-label="Mobile navigation">
              {NAV.filter((i) => "href" in i).map((item) => (
                <a key={(item as { href: string }).href} href={(item as { href: string }).href} className="nav-link" style={{ whiteSpace: "nowrap" }}>
                  {(item as { label: string }).label}
                </a>
              ))}
            </nav>
            <main className="content">{children}</main>
            <footer className="small muted" style={{ padding: "0 28px 40px", maxWidth: 1220, margin: "0 auto", width: "100%" }}>
              VisionScan AI is a clinical decision-support <strong>architecture</strong> under active development.
              It does not diagnose disease, does not replace professional eye care, and has no regulatory authorization.
              Automated results are probabilistic, may be wrong, and require review by a qualified eye-care professional.
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}

function ThemeToggle() {
  // Client-side theme switch (chrome only; medical images never filtered).
  return (
    <form
      dangerouslySetInnerHTML={{
        __html: `<button type="button" class="btn ghost sm" onclick="(function(){var d=document.documentElement,t=d.dataset.theme==='dark'?'light':'dark';d.dataset.theme=t;try{localStorage.setItem('vsa-theme',t);}catch(e){}})()" aria-label="Toggle dark mode" title="Toggle dark mode">◐</button>`,
      }}
    />
  );
}
