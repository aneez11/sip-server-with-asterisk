import { useStore } from "@/store";
import { Badge } from "@/components/Badge/Badge";
import { Card, CardContent } from "@/components/Card/Card";
import { Radio } from "lucide-react";

const fmtClock = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};

export const HistoryPage = () => {
  const recentLogs = useStore((s) => s.recentLogs);
  const endpoints = useStore((s) => s.endpoints);
  const busy = useStore((s) => s.busy);
  const playAdhoc = useStore((s) => s.playAdhoc);

  const statusVariant = (status: string) =>
    status === "success"
      ? "default"
      : status === "failed"
        ? "destructive"
        : status === "stopped"
          ? "secondary"
          : "outline";

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          {recentLogs.length} recent broadcast
          {recentLogs.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {recentLogs.map((b) => {
          const labels = (b.endpointIds ?? []).map(
            (id) => endpoints.find((e) => e.id === id)?.label ?? `#${id}`,
          );
          return (
            <Card key={b.id} className="bg-card">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {b.title || b.zoneName || "Ad-hoc"}
                    </div>
                    <div className="text-muted-foreground text-[10px] font-mono mt-0.5">
                      {fmtClock(b.startedAt)}
                    </div>
                  </div>
                  <Badge
                    variant={statusVariant(b.status)}
                    className="text-[10px] px-1.5 py-0 flex-shrink-0"
                  >
                    {b.status}
                  </Badge>
                </div>
                <div
                  className="text-muted-foreground text-[10px] truncate"
                  title={labels.join(", ")}
                >
                  {labels.join(", ") || "—"}
                </div>
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  onClick={() => void playAdhoc(b.endpointIds)}
                  disabled={busy || b.endpointIds.length === 0}
                  title="Rebroadcast to the same endpoint configuration"
                >
                  <Radio size={11} /> Rebroadcast same targets
                </button>
                {b.endedAt && (
                  <div className="text-muted-foreground text-[10px] font-mono">
                    Ended {fmtClock(b.endedAt)}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {recentLogs.length === 0 && (
          <div className="col-span-full border rounded-xl bg-muted/30 p-10 text-center text-xs text-muted-foreground">
            No broadcast history yet.
          </div>
        )}
      </div>
    </div>
  );
};
