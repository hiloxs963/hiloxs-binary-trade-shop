import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PlayCircle, Plus, Trash2, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { TRACKS, TRAININGS, type TrainingTrack } from "@/lib/hiloxs";
import { useHiloxs } from "@/lib/hiloxs-context";
import { type TrainingLevel } from "@/lib/hiloxs-store";
import { useAdminMode } from "@/lib/admin";
import { pageSeo } from "@/lib/seo";

const LEVELS: TrainingLevel[] = ["Beginner", "Intermediate", "Advanced"];

export const Route = createFileRoute("/training")({
  head: () =>
    pageSeo({
      title: "Training Library: Binary Plan, Shopping and Practice Trading | HILOXS",
      description:
        "Browse HILOXS video lessons covering the binary-plan prototype, shopping, getting started and practice trading.",
      path: "/training",
    }),
  component: TrainingPage,
});

function TrainingPage() {
  const [track, setTrack] = useState<TrainingTrack | "All">("All");
  const list = TRAININGS.filter((t) => track === "All" || t.track === track);
  const [active, setActive] = useState(TRAININGS[0]!);
  const { state, hydrated, addVideo, removeVideo } = useHiloxs();
  const [form, setForm] = useState({ title: "", url: "", level: "Beginner" as TrainingLevel });
  const adminMode = useAdminMode();

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
            aria-pressed={t === track}
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

      <section className="mt-14">
        <h2 className="text-2xl font-bold">
          {adminMode ? "My YouTube uploads" : "Training library"}
        </h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          {adminMode
            ? "Paste a link straight from my YouTube channel and choose the level it belongs to. It appears in the library below immediately."
            : "Beginner, intermediate and advanced classes uploaded from the HILOXS channel."}
        </p>

        {adminMode && (
          <form
            className="panel mt-5 grid gap-4 p-5 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              const err = addVideo(form);
              if (err) toast.error(err);
              else {
                toast.success("Video added to the library");
                setForm({ title: "", url: "", level: form.level });
              }
            }}
          >
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="v-title">Video title</Label>
              <Input
                id="v-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Placing your first binary trade"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="v-url">YouTube link or video ID</Label>
              <Input
                id="v-url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://youtu.be/…"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Level</Label>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map((l) => (
                  <Button
                    key={l}
                    type="button"
                    size="sm"
                    variant={form.level === l ? "default" : "outline"}
                    onClick={() => setForm({ ...form, level: l })}
                    aria-pressed={form.level === l}
                  >
                    {l}
                  </Button>
                ))}
              </div>
            </div>
            <Button type="submit" variant="hero" className="sm:col-span-2 sm:self-end">
              <Plus /> Add to library
            </Button>
          </form>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {LEVELS.map((level) => {
            const videos = hydrated ? state.videos.filter((v) => v.level === level) : [];
            return (
              <div key={level} className="panel p-5">
                <h3 className="text-lg font-semibold">{level}</h3>
                {videos.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Space reserved — {level.toLowerCase()} videos you upload will show here.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-4">
                    {videos.map((v) => (
                      <li key={v.id}>
                        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
                          <iframe
                            className="h-full w-full"
                            src={`https://www.youtube.com/embed/${v.youtubeId}`}
                            title={v.title}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                            allowFullScreen
                            loading="lazy"
                          />
                        </div>
                        <div className="mt-2 flex items-start gap-2">
                          <p className="flex-1 text-sm font-medium">{v.title}</p>
                          {adminMode && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${v.title}`}
                              onClick={() => removeVideo(v.id)}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
