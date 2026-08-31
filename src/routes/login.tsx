import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthFormLayout } from "@/components/hiloxs/AuthForm";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/login")({
  head: () =>
    pageSeo({
      title: "Log In | HILOXS",
      description: "Account access for HILOXS customers.",
      path: "/login",
      noindex: true,
    }),
  component: LoginPage,
});

function LoginPage() {
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
