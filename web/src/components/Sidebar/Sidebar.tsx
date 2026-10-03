import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { useStore } from "@/store";
import { Input } from "@/components/Input/Input";
import { Checkbox } from "@/components/Checkbox/Checkbox";
import { ScrollArea } from "@/components/ScrollArea/ScrollArea";
import { cn } from "@/lib/utils";

export const Sidebar = () => {
  const endpoints = useStore((s) => s.endpoints);
  const zones = useStore((s) => s.zones);
  const selectedZoneIds = useStore((s) => s.selectedZoneIds);
  const collapsedZones = useStore((s) => s.collapsedZones);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const toggleZone = useStore((s) => s.toggleZone);
  const toggleCollapsed = useStore((s) => s.toggleCollapsed);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const q = searchQuery.trim().toLowerCase();
  const zoneList = [...zones].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="hidden flex-col overflow-hidden border-r border-border bg-card lg:flex">
      <div className="p-3.5 border-b border-border/60">
        <div className="font-display font-semibold text-[11px] uppercase tracking-wider text-muted-foreground mb-2.5">
          Zones &amp; endpoints
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs bg-muted/50"
            placeholder="Search zones or endpoints"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button
          className="w-full text-left mt-2 px-2 py-1.5 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-accent/50"
          onClick={() => setActiveTab("endpoints")}
        >
          Manage endpoints →
        </button>
      </div>

      <ScrollArea className="flex-1 p-2">
        {zoneList.length === 0 && (
          <div className="py-10 text-center text-xs text-muted-foreground">
            No zones configured.
          </div>
        )}
        {zoneList.map((zone) => {
          const zs = endpoints.filter((e) => zone.endpointIds.includes(e.id));
          const filtered = zs.filter(
            (e) =>
              !q ||
              e.label.toLowerCase().includes(q) ||
              e.extension.includes(q) ||
              e.location.toLowerCase().includes(q),
          );
          const zoneMatches = !q || zone.name.toLowerCase().includes(q);
          if (!zoneMatches && filtered.length === 0) return null;
          const onCount = zs.filter((e) => e.registered).length;
          const collapsed = collapsedZones.has(zone.name) && !q;
          return (
            <div key={zone.id} className="mb-1">
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/50"
                onClick={() => toggleCollapsed(zone.name)}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedZoneIds.has(zone.id)}
                    onCheckedChange={() => toggleZone(zone.id)}
                    className="h-3.5 w-3.5"
                  />
                </div>
                <span className="flex-1 text-[12.5px] font-medium truncate">
                  {zone.name}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {onCount}/{zs.length}
                </span>
                {collapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
                )}
              </div>
              {!collapsed && (
                <div className="pl-6">
                  {filtered.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 text-[12px]"
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full flex-shrink-0",
                          e.registered
                            ? "bg-emerald-400"
                            : "bg-muted-foreground",
                        )}
                      />
                      <span className="flex-1 text-muted-foreground truncate">
                        {e.label}
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground/70">
                          {e.extension}
                        </span>
                      </span>
                    </div>
                  ))}
                  {filtered.length === 0 && (
                    <div className="py-3 text-center text-[11px] text-muted-foreground">
                      No matching endpoints
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </ScrollArea>

      <div className="p-3 border-t border-border/60 font-mono text-[11px] text-muted-foreground flex justify-between">
        <span>
          {selectedZoneIds.size} zone{selectedZoneIds.size !== 1 ? "s" : ""}{" "}
          selected
        </span>
        <span className="text-primary font-medium">
          {
            endpoints.filter((e) =>
              Array.from(selectedZoneIds).some((zid) =>
                zones.find((z) => z.id === zid)?.endpointIds.includes(e.id),
              ),
            ).length
          }{" "}
          endpoints
        </span>
      </div>
    </aside>
  );
};
