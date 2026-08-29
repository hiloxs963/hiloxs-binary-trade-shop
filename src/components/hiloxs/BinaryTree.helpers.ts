import type { Referral } from "@/lib/hiloxs-store";

export type TreeNode = {
  id: string | null;
  name: string;
  activated: boolean;
  left?: TreeNode;
  right?: TreeNode;
};

/** Builds an infinitely deep binary tree from flat referrals (parentId + leg). */
export function buildTree(referrals: Referral[], rootName: string, rootActive: boolean): TreeNode {
  const childOf = (parentId: string | null, leg: "L" | "R") =>
    referrals.find((r) => (r.parentId ?? null) === parentId && r.leg === leg);

  const build = (id: string | null, name: string, activated: boolean): TreeNode => {
    const l = childOf(id, "L");
    const r = childOf(id, "R");
    return {
      id,
      name,
      activated,
      ...(l ? { left: build(l.id, l.name, l.activated) } : {}),
      ...(r ? { right: build(r.id, r.name, r.activated) } : {}),
    };
  };

  return build(null, rootName, rootActive);
}
