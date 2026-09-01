import { Link } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthRequired({
  title,
  description,
  returnTo,
}: {
  title: string;
  description: string;
  returnTo?: "/checkout" | "/my-orders";
}) {
  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center" aria-labelledby="auth-title">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-secondary text-primary">
        <LockKeyhole className="size-5" aria-hidden />
      </div>
      <h1 id="auth-title" className="mt-5 text-3xl font-bold">
        {title}
      </h1>
      <p className="mt-3 text-muted-foreground">{description}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button asChild variant="hero">
          <Link to="/login" search={returnTo ? { returnTo } : {}}>
            Log in
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/register">Create an account</Link>
        </Button>
      </div>
      <Button asChild variant="ghost" className="mt-3">
        <Link to="/shop">Continue shopping</Link>
      </Button>
    </section>
  );
}
