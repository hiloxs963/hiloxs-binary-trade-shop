import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthFormLayout } from "@/components/hiloxs/AuthForm";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/register")({
  head: () =>
    pageSeo({
      title: "Create an Account | HILOXS",
      description: "Future account registration for HILOXS customers.",
      path: "/register",
      noindex: true,
    }),
  component: RegisterPage,
});

function RegisterPage() {
  return (
    <AuthFormLayout
      title="Account access"
      description="HILOXS account services are temporarily unavailable."
      footer={
        <Link to="/" className="font-medium text-primary hover:underline">
          Return home
        </Link>
      }
    >
      <p className="text-sm text-muted-foreground" role="status">
        Account access is being upgraded. Please check back shortly.
      </p>
    </AuthFormLayout>
  );
}
