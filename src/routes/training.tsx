import { createFileRoute } from "@tanstack/react-router";
import { BookOpenCheck, Youtube } from "lucide-react";
import { TRACKS } from "@/lib/hiloxs";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/training")({
  head: () =>
    pageSeo({
      title: "Training Library | HILOXS",
      description: "Review the training topics planned for the HILOXS learning library.",
      path: "/training",
    }),
  component: TrainingPage,
});

function TrainingPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex items-center gap-2 text-primary">
        <Youtube className="size-5" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-widest">HILOXS Academy</span>
      </div>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Training</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        The HILOXS training library is being prepared. No lessons or external video embeds are
        currently published on this page.
      </p>

      <section className="mt-8" aria-labelledby="planned-training">
        <h2 id="planned-training" className="text-xl font-semibold">
          Planned training topics
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRACKS.map((track) => (
            <div key={track} className="panel p-5">
              <BookOpenCheck className="size-5 text-primary" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold">{track}</h3>
              <p className="mt-1 text-xs text-muted-foreground">Content is not yet available.</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
