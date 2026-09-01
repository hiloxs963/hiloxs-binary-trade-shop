import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonicalize);
    if (items.every(isNamedObject)) {
      return items.toSorted((left, right) =>
        String(left["Name"]).localeCompare(String(right["Name"])),
      );
    }
    return items;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function isNamedObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && "Name" in value);
}
