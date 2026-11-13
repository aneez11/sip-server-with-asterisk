import { useEffect, useState } from "react";
import {
  Clock3,
  LogOut,
  Moon,
  Radio,
  Sun,
  UserRound,
} from "lucide-react";
import { useStore } from "@/store";
import { useTheme } from "@/lib/theme";

const fmtClock = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

export const Topbar = () => {
  const endpoints = useStore((s) => s.endpoints);
  const recording = useStore((s) => s.recording);
  const amiConnected = useStore((s) => s.amiConnected);
  const { theme, toggle } = useTheme();
  const [clock, setClock] = useState(() => fmtClock(new Date()));

  useEffect(() => {
    const t = setInterval(() => setClock(fmtClock(new Date())), 1000);
    return () => clearInterval(t);
  }, []);

  const registered = endpoints.filter((e) => e.registered).length;
  const total = endpoints.length;
  const regTone =
    total === 0 ? "quiet" : registered === total ? "ok" : registered === 0 ? "bad" : "warn";

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <img className="brand-mark-on-light" src="/logo-mark-dark.svg" alt="" />
          <img className="brand-mark-on-dark" src="/logo-mark.svg" alt="" />
        </span>
        <span className="brand-text">
          <b>Infinity Echo</b>
          <small className="hide-lg">Paging console · Institute SIP PA</small>
        </span>
      </div>

      <span className="spacer" />

      {recording ? (
        <span className="chip bad hide-md">
          <i className="dot" aria-hidden="true" />
          Recording
        </span>
      ) : null}

      <span
        className={`chip ${regTone} hide-md`}
        title="SIP endpoints currently registered"
      >
        <Radio size={13} />
        {total === 0 ? "No endpoints" : `${registered} / ${total} registered`}
      </span>

      <span
        className={`chip ${amiConnected ? "" : "bad"} hide-md`}
        title="Asterisk AMI connection"
      >
        <i className="dot" aria-hidden="true" />
        {amiConnected ? "AMI connected" : "AMI offline"}
      </span>

      <span className="clock-chip" title="Local time">
        <Clock3 size={15} />
        <b>{clock}</b>
      </span>

      <span className="user-chip">
        <UserRound size={16} />
        <span>
          <b>Operator</b>
          <small>Signed in</small>
        </span>
      </span>

      <button
        type="button"
        className="icon-btn"
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={theme === "dark" ? "Light theme" : "Dark theme"}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <button
        type="button"
        className="icon-btn"
        onClick={() =>
          void fetch("/api/auth/logout", { method: "POST" }).then(() =>
            window.location.reload(),
          )
        }
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={18} />
      </button>
    </header>
  );
};
