import { useState } from "react";
import { ChevronDown, ChevronRight, UserPlus } from "lucide-react";
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

export function BinaryTree({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 3);
  const hasChildren = !!(node.left || node.right);

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!hasChildren}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
            node.activated ? "border-primary/60 bg-primary/10" : "border-border bg-surface/60"
          } ${hasChildren ? "hover:border-primary" : "opacity-90"}`}
        >
          {hasChildren ? (
            open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />
          ) : (
            <span className="size-4" />
          )}
          <span className="font-medium">{node.name}</span>
          <span className="text-xs text-muted-foreground">
            {depth === 0 ? "You" : node.activated ? "Activated" : "Pending"}
          </span>
        </button>
      </div>

      {open && (
        <div className="ml-4 mt-2 space-y-2 border-l border-dashed border-border pl-4">
          <Branch label="Left leg" child={node.left} depth={depth} />
          <Branch label="Right leg" child={node.right} depth={depth} />
        </div>
      )}
    </div>
  );
}

function Branch({ label, child, depth }: { label: string; child?: TreeNode; depth: number }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="mt-1">
        {child ? (
          <BinaryTree node={child} depth={depth + 1} />
        ) : (
          <p className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            <UserPlus className="size-3.5" /> Open position — register someone here
          </p>
        )}
      </div>
    </div>
  );
}
