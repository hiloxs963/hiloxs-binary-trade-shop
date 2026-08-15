import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PlayCircle, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TRACKS, TRAININGS, type TrainingTrack } from "@/lib/hiloxs";

export const Route = createFileRoute("/training")({
  head: () => ({
    meta: [
      { title: "HILOXS Training — Binary, Trading & Shopping Classes" },
      {
        name: "description",
        content:
          "Watch HILOXS training uploaded straight from YouTube: binary network marketing, market trading and smart shopping.",
      },
      { property: "og:title", content: "HILOXS Training Library" },
      {
        property: "og:description",
        content: "Free video classes on the binary plan, the trading desk and the shop.",
      },
    ],
  }),
  component: TrainingPage,
});

function TrainingPage() {
  const [track, setTrack] = useState<TrainingTrack | "All">("All");
  const list = TRAININGS.filter((t) => track === "All" || t.track === track);
  const [active, setActive] = useState(TRAININGS[0]!);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex items-center gap-2 text-primary">
        <Youtube className="size-5" />
        <span className="text-xs font-semibold uppercase tracking-widest">HILOXS Academy</span>
      </div>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Training</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Everything here is recorded by me, from work I have actually done, and uploaded from my
        YouTube channel. Pick a category and learn how the systems run.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {(["All", ...TRACKS] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={t === track ? "default" : "outline"}
            onClick={() => setTrack(t)}
          >
            {t}
          </Button>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel overflow-hidden">
          <div className="aspect-video w-full bg-black">
            <iframe
              key={active.id}
              className="h-full w-full"
              src={`https://www.youtube.com/embed/${active.youtubeId}`}
              title={active.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
          <div className="p-5">
            <Badge variant="secondary">{active.track}</Badge>
            <h2 className="mt-2 text-xl font-semibold">{active.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{active.summary}</p>
          </div>
        </div>

        <ul className="space-y-3">
          {list.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setActive(t)}
                className={`panel flex w-full items-start gap-3 p-4 text-left transition-colors hover:border-primary ${
                  active.id === t.id ? "border-primary" : ""
                }`}
              >
                <PlayCircle className="mt-0.5 size-5 shrink-0 text-primary" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{t.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t.track} · {t.duration}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}