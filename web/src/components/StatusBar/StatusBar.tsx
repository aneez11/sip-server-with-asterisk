import { useState } from "react";
import { RefreshCw, Radio, Server, Wifi } from "lucide-react";
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
    <footer className="statusbar">
      <span className="status-item">
        <Server size={14} />
        <span className={amiConnected ? "ok-text" : "bad-text"}>
          AMI {amiConnected ? "connected" : "disconnected"}
        </span>
      </span>
      <span className="status-item">
        <RefreshCw size={14} />
        Last sync {fmtClock(lastSync)}
      </span>
      <span className="status-item hide-md">
        <Radio size={14} />
        {endpoints.length === 0
          ? "No endpoints configured"
          : `${registered} of ${endpoints.length} endpoints registered`}
        {unreachable > 0 && endpoints.length > 0 ? ` · ${unreachable} offline` : ""}
      </span>

      <span className="spacer" />

      <button
        type="button"
        className="status-action"
        onClick={() => void doRefresh()}
        disabled={refreshing}
        title="Refresh status now"
      >
        <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        Refresh
      </button>

      <span className="status-item">
        <Wifi size={14} />
        {window.navigator.onLine ? "Online" : "Offline"}
      </span>

      <span className="status-item status-version">Infinity Echo · LAN</span>
    </footer>
  );
};
