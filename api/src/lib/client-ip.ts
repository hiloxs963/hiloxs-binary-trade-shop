import { createHmac } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import { ConfigurationError } from "./errors.js";

// Railway's edge proxies sit in the carrier-grade NAT block. Anything outside it is never trusted
// to speak for a client, so a request that reaches the API directly keeps its socket address.
export const DEFAULT_PRODUCTION_TRUSTED_PROXIES = ["100.64.0.0/10"] as const;

const MIN_PREFIX = { 4: 8, 6: 16 } as const;

/**
 * Parses TRUSTED_PROXY_CIDRS: a comma-separated list of proxy addresses or CIDR ranges. Catch-all
 * and very broad ranges are rejected, because trusting them would let any client choose its
 * own address through X-Forwarded-For.
 */
export function parseTrustedProxies(value: string): string[] {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const [address, prefix, ...rest] = entry.split("/");
    const family = address ? isIP(address) : 0;
    if (rest.length > 0 || (family !== 4 && family !== 6)) {
      throw new ConfigurationError(`TRUSTED_PROXY_CIDRS contains an invalid entry: ${entry}`);
    }
    if (prefix !== undefined) {
      const length = Number(prefix);
      const max = family === 4 ? 32 : 128;
      if (!/^\d{1,3}$/.test(prefix) || length > max || length < MIN_PREFIX[family]) {
        throw new ConfigurationError(
          `TRUSTED_PROXY_CIDRS range ${entry} is invalid or too broad to trust`,
        );
      }
    }
  }
  return entries;
}

const PRIVATE_NETWORKS = (() => {
  const list = new BlockList();
  for (const [network, prefix] of [
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
  ] as const) {
    list.addSubnet(network, prefix, "ipv4");
  }
  list.addSubnet("fc00::", 7, "ipv6");
  list.addSubnet("::1", 128, "ipv6");
  return list;
})();

/**
 * Describes a socket peer without exposing it: private/proxy-range IPv4 peers keep their first two
 * octets so an operator can choose a CIDR; anything public (a real client) is only "public".
 */
export function describeSocketPeer(peer: string): string {
  const mapped = peer.startsWith("::ffff:") ? peer.slice(7) : peer;
  const family = isIP(mapped);
  if (family === 0) return "unknown";
  if (!PRIVATE_NETWORKS.check(mapped, family === 4 ? "ipv4" : "ipv6")) return "public";
  return family === 4 ? `${mapped.split(".").slice(0, 2).join(".")}.*.*` : "private-ipv6";
}

/** First 16 hex characters of a keyed digest. Never reversible to the address by log readers. */
export function clientIpDiagnosticDigest(key: string, ip: string): string {
  return createHmac("sha256", key)
    .update("client-ip-diagnostic\0")
    .update(ip)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Opt-in (CLIENT_IP_DIAGNOSTIC) check for production: a request to /health carrying
 * `x-hiloxs-ip-check: 1` logs keyed digests of the resolved client address and of the socket peer.
 * Raw addresses are never logged. If the two digests match, proxy trust is not taking effect.
 */
export function registerClientIpDiagnostic(app: FastifyInstance, hmacKey: string): void {
  app.addHook("onResponse", (request, _reply, done) => {
    if (request.url !== "/health" || request.headers["x-hiloxs-ip-check"] !== "1") {
      done();
      return;
    }
    const peer = request.socket.remoteAddress ?? "";
    const forwarded = request.headers["x-forwarded-for"];
    const entries = (Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? ""))
      .split(",")
      .filter((entry) => entry.trim()).length;
    request.log.info(
      {
        event: "client_ip_diagnostic",
        clientIpDigest: clientIpDiagnosticDigest(hmacKey, request.ip),
        socketPeerDigest: clientIpDiagnosticDigest(hmacKey, peer),
        clientIsPeer: request.ip === peer,
        socketPeerNetwork: describeSocketPeer(peer),
        forwardedForEntries: entries,
      },
      "Client IP diagnostic",
    );
    done();
  });
}
