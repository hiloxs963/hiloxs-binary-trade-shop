export const MAX_SELLER_PRODUCT_PRICE_MINOR = 1_000_000_000n;

export function parseKesPriceToMinor(value: string): string {
  const normalized = value.trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(normalized);
  if (!match) throw new Error("Enter a valid KSh amount with no more than two decimal places.");
  const major = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  const minor = major * 100n + fraction;
  if (minor <= 0n) throw new Error("Price must be greater than zero.");
  if (minor > MAX_SELLER_PRODUCT_PRICE_MINOR) {
    throw new Error("Price exceeds the HILOXS listing application limit.");
  }
  return minor.toString();
}

export function minorToKesInput(value: string): string {
  const minor = BigInt(value);
  const fraction = (minor % 100n).toString().padStart(2, "0");
  return `${minor / 100n}.${fraction}`;
}
