import { useEffect, useRef } from "react";
import {
  Activity,
  History,
  Layers,
  Cctv,
  Library,
  Mic,
  Music2,
  Phone,
  Radio,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore } from "@/store";
import type { Tab } from "@/lib/tabs";

const links: { tab: Tab; icon: LucideIcon; label: string }[] = [
  { tab: "broadcast", icon: Radio, label: "Broadcast" },
  { tab: "media", icon: Library, label: "Media" },
  { tab: "monitor", icon: Activity, label: "Monitor" },
  { tab: "cameras", icon: Cctv, label: "Cameras" },
  { tab: "talk", icon: Mic, label: "Live talk" },
  { tab: "music", icon: Music2, label: "Music" },
  { tab: "endpoints", icon: Phone, label: "Endpoints" },
  { tab: "zones", icon: Layers, label: "Zones" },
  { tab: "pa-group", icon: Users, label: "PA groups" },
  { tab: "history", icon: History, label: "History" },
];

export const IconRail = () => {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeTab]);

  return (
    <nav className="rail" aria-label="Primary">
      {links.map(({ tab, icon: Icon, label }) => (
        <button
          key={tab}
          ref={activeTab === tab ? activeRef : undefined}
          type="button"
          className={`rail-link${activeTab === tab ? " on" : ""}`}
          onClick={() => setActiveTab(tab)}
          aria-current={activeTab === tab ? "page" : undefined}
          title={label}
        >
          <Icon size={22} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
};
