import { describe, expect, it } from "vitest";
import { hasPatientScope, type ScopedPrincipal } from "@/lib/auth/scope";

const PRINCIPAL: ScopedPrincipal = {
  user_id: "legacy-policy-user",
  username: "legacy-policy-user",
  role: "CLINICIAN",
  tenant_id: null,
};

describe("legacy unscoped authorization compatibility", () => {
  it("is available to isolated tests, but fails closed outside the explicit compatibility modes", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = {
      isolated: env.VISIONSCAN_TEST_ISOLATED,
      optIn: env.VISIONSCAN_ALLOW_LEGACY_UNSCOPED,
      nodeEnv: env.NODE_ENV,
    };
    try {
      env.VISIONSCAN_TEST_ISOLATED = "0";
      env.VISIONSCAN_ALLOW_LEGACY_UNSCOPED = "false";
      env.NODE_ENV = "development";
      expect(await hasPatientScope(PRINCIPAL, {})).toBe(false);

      env.VISIONSCAN_ALLOW_LEGACY_UNSCOPED = "true";
      expect(await hasPatientScope(PRINCIPAL, {})).toBe(true);

      env.NODE_ENV = "production";
      expect(await hasPatientScope(PRINCIPAL, {})).toBe(false);
    } finally {
      if (previous.isolated === undefined) delete env.VISIONSCAN_TEST_ISOLATED;
      else env.VISIONSCAN_TEST_ISOLATED = previous.isolated;
      if (previous.optIn === undefined) delete env.VISIONSCAN_ALLOW_LEGACY_UNSCOPED;
      else env.VISIONSCAN_ALLOW_LEGACY_UNSCOPED = previous.optIn;
      if (previous.nodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previous.nodeEnv;
    }
  });
});
