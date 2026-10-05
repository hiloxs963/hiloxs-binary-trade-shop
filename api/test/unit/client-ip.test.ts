import { execFileSync } from "node:child_process";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { registerAuthRoutes } from "../../src/auth/fastify.js";
import type { AuthService } from "../../src/auth/auth.js";
import type { RateLimitInput, RateLimiter } from "../../src/commerce/rate-limit.js";
import { parseEnv, resolveTrustedProxies } from "../../src/config/env.js";
import {
  clientIpDiagnosticDigest,
  describeSocketPeer,
  parseTrustedProxies,
  registerClientIpDiagnostic,
} from "../../src/lib/client-ip.js";
import { ConfigurationError } from "../../src/lib/errors.js";
import { createLoggerOptions } from "../../src/lib/logger.js";

const RAILWAY_PROXY = "100.64.12.34";
const TRUSTED = ["100.64.0.0/10"];

async function resolveIp(options: {
  trusted?: readonly string[];
  peer: string;
  headers?: Record<string, string>;
}): Promise<string> {
  const app = await buildApp({ trustedProxies: options.trusted ?? TRUSTED });
  app.get("/__ip", (request) => ({ ip: request.ip }));
  const response = await app.inject({
    method: "GET",
    url: "/__ip",
    remoteAddress: options.peer,
    headers: options.headers ?? {},
  });
  await app.close();
  return response.json<{ ip: string }>().ip;
}

describe("client IP resolution behind trusted proxies", () => {
  it("uses the address the trusted proxy appended", async () => {
    expect(
      await resolveIp({ peer: RAILWAY_PROXY, headers: { "x-forwarded-for": "203.0.113.9" } }),
    ).toBe("203.0.113.9");
  });

  it("skips every trusted hop and stops at the first untrusted address", async () => {
    expect(
      await resolveIp({
        peer: RAILWAY_PROXY,
        headers: { "x-forwarded-for": "203.0.113.9, 100.64.5.5" },
      }),
    ).toBe("203.0.113.9");
  });

  it("ignores client-supplied entries to the left of the real client", async () => {
    expect(
      await resolveIp({
        peer: RAILWAY_PROXY,
        headers: { "x-forwarded-for": "1.2.3.4, 8.8.8.8, 203.0.113.9" },
      }),
    ).toBe("203.0.113.9");
  });

  it("ignores a client-supplied X-Real-IP", async () => {
    expect(
      await resolveIp({
        peer: RAILWAY_PROXY,
        headers: { "x-forwarded-for": "203.0.113.9", "x-real-ip": "1.2.3.4" },
      }),
    ).toBe("203.0.113.9");
  });

  it("does not believe forwarding headers from a peer that is not a trusted proxy", async () => {
    expect(
      await resolveIp({
        peer: "198.51.100.7",
        headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" },
      }),
    ).toBe("198.51.100.7");
  });

  it("trusts nothing when no proxy is configured", async () => {
    expect(
      await resolveIp({
        trusted: [],
        peer: RAILWAY_PROXY,
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
    ).toBe(RAILWAY_PROXY);
  });

  it("falls back to the proxy address when the proxy sent no forwarding header", async () => {
    expect(await resolveIp({ peer: RAILWAY_PROXY })).toBe(RAILWAY_PROXY);
  });
});

describe("rate-limit keys", () => {
  async function keysFor(forwardedFor: string): Promise<string[]> {
    const calls: RateLimitInput[] = [];
    const limiter: RateLimiter = {
      consume(input) {
        calls.push(input);
        return Promise.resolve();
      },
    };
    const auth = {
      handler: () => Promise.resolve(new Response("{}", { status: 200 })),
      api: { getSession: () => Promise.resolve(null) },
    } as unknown as AuthService;
    const app = Fastify({ trustProxy: TRUSTED });
    registerAuthRoutes(app, {
      auth,
      baseURL: "http://127.0.0.1:3000",
      frontendURL: "http://localhost:8080",
      trustedOrigins: ["http://localhost:8080"],
      rateLimiter: limiter,
    });
    await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      remoteAddress: RAILWAY_PROXY,
      headers: { "x-forwarded-for": forwardedFor, "x-real-ip": "9.9.9.9" },
      payload: { email: "user@example.com", password: "StrongPassword!42" },
    });
    await app.close();
    return calls.map((call) => call.key);
  }

  it("keys by the real client address and is unchanged by spoofed X-Forwarded-For entries", async () => {
    const honest = await keysFor("203.0.113.9");
    const spoofed = await keysFor("1.1.1.1, 2.2.2.2, 203.0.113.9");

    expect(honest).toEqual(["203.0.113.9|user@example.com"]);
    expect(spoofed).toEqual(honest);
  });
});

describe("trusted proxy configuration", () => {
  it("defaults to Railway's range in production only", () => {
    expect(resolveTrustedProxies(parseEnv({ NODE_ENV: "production" }))).toEqual(TRUSTED);
    expect(resolveTrustedProxies(parseEnv({ NODE_ENV: "development" }))).toEqual([]);
    expect(resolveTrustedProxies(parseEnv({ NODE_ENV: "test" }))).toEqual([]);
  });

  it("lets an explicit value override, including an empty one", () => {
    expect(
      resolveTrustedProxies(
        parseEnv({ NODE_ENV: "production", TRUSTED_PROXY_CIDRS: "10.0.0.0/8, 192.0.2.1" }),
      ),
    ).toEqual(["10.0.0.0/8", "192.0.2.1"]);
    expect(
      resolveTrustedProxies(parseEnv({ NODE_ENV: "production", TRUSTED_PROXY_CIDRS: "" })),
    ).toEqual([]);
  });

  it.each(["0.0.0.0/0", "::/0", "1.0.0.0/7", "100.64.0.0/33", "not-an-ip", "10.0.0.0/8/9", "*"])(
    "rejects %s",
    (entry) => {
      expect(() => parseTrustedProxies(entry)).toThrow(ConfigurationError);
    },
  );
});

describe("socket peer description", () => {
  it("keeps only the network of private peers and hides public ones", () => {
    expect(describeSocketPeer("100.64.12.34")).toBe("100.64.*.*");
    expect(describeSocketPeer("::ffff:10.1.2.3")).toBe("10.1.*.*");
    expect(describeSocketPeer("fd12::1")).toBe("private-ipv6");
    expect(describeSocketPeer("203.0.113.9")).toBe("public");
    expect(describeSocketPeer("2001:db8::1")).toBe("public");
    expect(describeSocketPeer("garbage")).toBe("unknown");
  });
});

describe("client IP diagnostic", () => {
  it("logs keyed digests only, never the raw addresses", async () => {
    const lines: string[] = [];
    const app = Fastify({
      trustProxy: TRUSTED,
      logger: {
        ...createLoggerOptions("info"),
        stream: { write: (line: string) => lines.push(line) },
      },
    });
    registerClientIpDiagnostic(app, "diagnostic-test-key-0123456789abcdef");
    app.get("/health", () => ({ status: "ok" }));
    const headers = { "x-forwarded-for": "203.0.113.9", "x-hiloxs-ip-check": "1" };
    await app.inject({ method: "GET", url: "/health", remoteAddress: RAILWAY_PROXY, headers });
    await app.inject({ method: "GET", url: "/health", remoteAddress: RAILWAY_PROXY });
    await app.close();

    const entries = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry["event"] === "client_ip_diagnostic");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      clientIpDigest: clientIpDiagnosticDigest(
        "diagnostic-test-key-0123456789abcdef",
        "203.0.113.9",
      ),
      socketPeerDigest: clientIpDiagnosticDigest(
        "diagnostic-test-key-0123456789abcdef",
        RAILWAY_PROXY,
      ),
      clientIsPeer: false,
      socketPeerNetwork: "100.64.*.*",
      forwardedForEntries: 1,
    });
    const logged = lines.join("\n");
    expect(logged).not.toContain("203.0.113.9");
    expect(logged).not.toContain(RAILWAY_PROXY);
  });

  it("matches the digest the helper script prints", () => {
    const key = "diagnostic-test-key-0123456789abcdef";
    const printed = execFileSync(
      process.execPath,
      ["scripts/client-ip-digest.mjs", "203.0.113.9"],
      {
        env: { ...process.env, RATE_LIMIT_HMAC_KEY: key },
      },
    )
      .toString()
      .trim();

    expect(printed).toBe(clientIpDiagnosticDigest(key, "203.0.113.9"));
  });
});
