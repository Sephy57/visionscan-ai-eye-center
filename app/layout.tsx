import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eye AI Analysis Platform",
  description:
    "AI-assisted ophthalmic image analysis and clinical decision-support architecture. Screening tool - not a medical device - not for clinical use.",
};

const NAV = [
  { href: "/", label: "Home" },
  { href: "/analyze", label: "Analyze" },
  { href: "/history", label: "History" },
  { href: "/compare", label: "Compare" },
  { href: "/clinician", label: "Clinician" },
  { href: "/devices", label: "Devices" },
  { href: "/settings", label: "Settings" },
  { href: "/admin", label: "Admin" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">◉</span> EyeAI <span className="brand-sub">Clinical Decision Support</span>
            </Link>
            <nav className="site-nav">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href}>{n.label}</Link>
              ))}
            </nav>
          </div>
          <div className="banner banner-validation">
            NOT VALIDATED &middot; NOT A MEDICAL DEVICE &middot; DEMO/SYNTHETIC ANALYSIS &middot; NOT FOR CLINICAL USE
          </div>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <p>
            This platform is a clinical decision-support <em>architecture</em>. It does not diagnose disease and it
            does not replace professional eye care. Automated results are probabilistic, can be wrong, and must be
            reviewed by a qualified eye-care professional. Only a qualified clinician can establish a diagnosis.
          </p>
          <p className="footer-fine">Development build &middot; all detection components are unvalidated placeholders &middot; data stored locally on D:</p>
        </footer>
      </body>
    </html>
  );
}
