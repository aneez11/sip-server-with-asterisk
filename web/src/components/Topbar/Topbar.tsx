import { useEffect, useState } from "react";
import { MonitorSpeaker, LogOut } from "lucide-react";
import { useStore } from "@/store";
import { Badge } from "@/components/Badge/Badge";
import { Separator } from "@/components/Separator/Separator";
import { Button } from "@/components/Button/Button";

const fmtClock = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

export const Topbar = () => {
  const endpoints = useStore((s) => s.endpoints);
  const recording = useStore((s) => s.recording);
  const [clock, setClock] = useState(() => fmtClock(new Date()));

  useEffect(() => {
    const t = setInterval(() => setClock(fmtClock(new Date())), 1000);
    return () => clearInterval(t);
  }, []);

  const registered = endpoints.filter((e) => e.registered).length;
  const total = endpoints.length;
  const variant =
    total === 0
      ? "outline"
      : registered === total
        ? "default"
        : registered === 0
          ? "destructive"
          : "secondary";
  const text =
    total === 0 ? "No endpoints" : `${registered} / ${total} registered`;

  return (
    <header className="col-span-1 flex min-w-0 items-center justify-between border-b border-border bg-card px-3 select-none sm:px-5 lg:col-span-2 xl:col-span-3">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="w-7 h-7 rounded-md bg-primary/15 flex items-center justify-center">
          <MonitorSpeaker className="w-4 h-4 text-primary" />
        </div>
        <span className="font-display font-semibold text-[15px] tracking-wide">
          Paging console
        </span>
        <Separator
          orientation="vertical"
          className="mx-1 hidden h-4 sm:block"
        />
        <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:block">
          Infinity Echo · Institute SIP PA
        </span>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2 sm:gap-4">
        {recording && (
          <Badge
            variant="destructive"
            className="font-mono text-[11px] gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
            Recording
          </Badge>
        )}
        <Badge variant={variant} className="font-mono text-[11px] gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${total === 0 || registered === 0 ? "bg-destructive" : registered === total ? "bg-emerald-400" : "bg-amber-400"}`}
          />
          {text}
        </Badge>
        <span className="hidden font-mono text-xs text-muted-foreground sm:block">
          {clock}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() =>
            void fetch("/api/auth/logout", { method: "POST" }).then(() =>
              window.location.reload(),
            )
          }
        >
          <LogOut size={13} className="mr-1" />
          Logout
        </Button>
      </div>
    </header>
  );
};
