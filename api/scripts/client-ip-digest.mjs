// Prints the digest the API logs for an address, so you can find your own request in the logs
// without the logs ever containing raw addresses:
//   RATE_LIMIT_HMAC_KEY=... node scripts/client-ip-digest.mjs <your-public-ip>
import { createHmac } from "node:crypto";

const [ip] = process.argv.slice(2);
const key = process.env["RATE_LIMIT_HMAC_KEY"];
if (!ip || !key) {
  process.stderr.write("Usage: RATE_LIMIT_HMAC_KEY=... node scripts/client-ip-digest.mjs <ip>\n");
  process.exit(2);
}
process.stdout.write(
  `${createHmac("sha256", key).update("client-ip-diagnostic\0").update(ip).digest("hex").slice(0, 16)}\n`,
);
