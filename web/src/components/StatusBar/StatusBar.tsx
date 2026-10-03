import { useState } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useStore } from "@/store";

const fmtClock = (d: Date | null) => {
  if (!d) return "—";
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};

export const StatusBar = () => {
  const endpoints = useStore((s) => s.endpoints);
  const lastSync = useStore((s) => s.lastSync);
  const amiConnected = useStore((s) => s.amiConnected);
  const refresh = useStore((s) => s.refresh);
  const [refreshing, setRefreshing] = useState(false);

  const registered = endpoints.filter((e) => e.registered).length;
  const unreachable = endpoints.length - registered;

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <footer className="col-span-1 flex min-w-0 min-h-8 items-center justify-between gap-3 border-t border-border bg-card px-3 py-1 text-xs sm:px-4 lg:col-span-2 xl:col-span-3">
      <span className="truncate font-mono text-muted-foreground">
        Last sync {fmtClock(lastSync)} ·{" "}
        <span className={amiConnected ? "text-emerald-400" : "text-red-500"}>
          AMI {amiConnected ? "connected" : "disconnected"}
        </span>
      </span>
      <span className="flex min-w-0 max-w-[55%] items-center gap-2 truncate text-muted-foreground sm:max-w-none sm:flex-shrink-0 sm:gap-3">
        <button
          type="button"
          onClick={() => void doRefresh()}
          disabled={refreshing}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh status now"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
        {endpoints.length === 0 ? (
          <span>No endpoints configured</span>
        ) : unreachable === 0 ? (
          <span className="flex items-center gap-1.5">
            <Wifi size={12} className="text-emerald-400" /> All endpoints
            registered
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <WifiOff size={12} className="text-amber-400" /> {unreachable}{" "}
            endpoint{unreachable === 1 ? "" : "s"} unregistered
          </span>
        )}
      </span>
    </footer>
  );
};
