import { createFileRoute } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { AuthRequired } from "@/components/hiloxs/AuthRequired";
import { useAuth } from "@/lib/auth-context";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/my-orders")({
  head: () =>
    pageSeo({
      title: "My Orders | HILOXS",
      description: "Private order history for authenticated HILOXS customers.",
      path: "/my-orders",
      noindex: true,
    }),
  component: MyOrdersPage,
});

function MyOrdersPage() {
  const auth = useAuth();

  if (auth.isLoading) {
    return (
      <p className="mx-auto max-w-xl px-4 py-16 text-center text-muted-foreground">
        Checking account access...
      </p>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <AuthRequired
        title="Log in to view your orders"
        description="Order history will be private and loaded from your verified HILOXS account. Prototype browser orders are not shown as trusted customer records."
      />
    );
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">My Orders</h1>
      <div className="panel mt-8 grid place-items-center gap-4 p-12 text-center">
        <Package className="size-10 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Your backend-controlled order history will appear here once the orders API is connected.
        </p>
      </div>
    </section>
  );
}
