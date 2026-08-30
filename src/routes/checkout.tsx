import { createFileRoute } from "@tanstack/react-router";
import { AuthRequired } from "@/components/hiloxs/AuthRequired";
import { useAuth } from "@/lib/auth-context";
import { useHiloxs } from "@/lib/hiloxs-context";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/checkout")({
  head: () =>
    pageSeo({
      title: "Checkout | HILOXS",
      description: "Secure account-based checkout for HILOXS customers.",
      path: "/checkout",
      noindex: true,
    }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const auth = useAuth();
  const { state } = useHiloxs();
  const itemCount = Object.values(state.cart).reduce((sum, quantity) => sum + quantity, 0);
  if (auth.isLoading)
    return (
      <p className="mx-auto max-w-xl px-4 py-16 text-center text-muted-foreground">
        Checking account access...
      </p>
    );
  if (!auth.isAuthenticated)
    return (
      <AuthRequired
        title="Log in to checkout"
        description={`${itemCount || "Your"} cart item${itemCount === 1 ? "" : "s"} will remain available. Secure checkout will require a verified HILOXS account once authentication is connected.`}
      />
    );
  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-3xl font-bold">Checkout connection pending</h1>
      <p className="mt-3 text-muted-foreground">
        Payment and order creation will be connected to the production backend in a later phase.
      </p>
    </section>
  );
}
