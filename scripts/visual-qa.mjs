// Visual QA: verify exactly one sidebar, no duplicated mobile-nav in HTML, drawer closed by default.
const routes = ["/", "/dashboard", "/analyze", "/history", "/compare", "/clinician", "/settings", "/devices", "/admin", "/report"];
const BASE = process.env.BASE_URL || "http://localhost:3000";

(async () => {
  let allOk = true;
  for (const route of routes) {
    const html = await (await fetch(BASE + route)).text();
    const sidebars = (html.match(/class="sidebar"/g) || []).length;
    // Count duplicated legacy navigation containers, not accessible references
    // such as aria-controls="mobile-navigation-drawer" on the menu button.
    const mobileNav = (html.match(/class="[^"]*\bmobile-nav\b/g) || []).length;
    const drawerClosed = !(html.match(/drawer-overlay/g) || []).length;
    const banners = (html.match(/banner-strip/g) || []).length;
    // The patient workspace adds a first-class Patients destination to the
    // existing navigation. Keep this explicit so a missing/duplicated link
    // still fails loudly instead of allowing the UI contract to drift.
    const navLinks = (html.match(/class="nav-link/g) || []).length; // expected: 13 sidebar links (including Patients)
    const mainContent = (html.match(/id="main-content"/g) || []).length;
    const ok = sidebars === 1 && mobileNav === 0 && drawerClosed && banners === 1 && navLinks === 13 && mainContent === 1;
    if (!ok) allOk = false;
    console.log(`${ok ? "[ok ]" : "[FAIL]"} ${route.padEnd(12)} sidebars=${sidebars} mobileNavInDOM=${mobileNav} drawerClosed=${drawerClosed} banners=${banners} navLinks=${navLinks} main=${mainContent}`);
  }
  console.log(allOk ? "\nVISUAL QA STRUCTURE: PASSED" : "\nVISUAL QA STRUCTURE: FAILED");
  process.exit(allOk ? 0 : 1);
})();
