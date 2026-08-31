import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "VisionScan AI — Ophthalmic Imaging Analysis Workspace",
  description:
    "AI-assisted eye and retinal scan analysis. Research screening architecture — not validated for clinical use; not a medical device.",
};

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('vsa-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
