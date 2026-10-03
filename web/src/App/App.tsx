import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import { useStore } from "@/store";
import { connectSocket } from "@/lib/api/socket";
import { liveTalk } from "@/recorder/recorder";
import { Topbar } from "@/components/Topbar/Topbar";
import { Sidebar } from "@/components/Sidebar/Sidebar";
import { RightRail } from "@/components/RightRail/RightRail";
import { StatusBar } from "@/components/StatusBar/StatusBar";
import { PlayerBar } from "@/components/PlayerBar/PlayerBar";
import { BroadcastPage } from "@/pages/BroadcastPage/BroadcastPage";
import { LiveTalkPage } from "@/pages/LiveTalkPage/LiveTalkPage";
import { MusicPlayerPage } from "@/pages/MusicPlayerPage/MusicPlayerPage";
import { EndpointsPage } from "@/pages/EndpointsPage/EndpointsPage";
import { ZonesPage } from "@/pages/ZonesPage/ZonesPage";
import { HistoryPage } from "@/pages/HistoryPage/HistoryPage";
import { MonitorPage } from "@/pages/MonitorPage/MonitorPage";
import { PaGroupsPage } from "@/pages/PaGroupsPage/PaGroupsPage";
import { MediaManagerPage } from "@/pages/MediaManagerPage/MediaManagerPage";
import { LoginPage } from "@/pages/LoginPage/LoginPage";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/Tabs/Tabs";

export const App = () => {
  const init = useStore((s) => s.init);
  const refresh = useStore((s) => s.refresh);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((res) => {
        setAuthed(res.ok);
        setChecked(true);
        if (res.ok) void init();
      })
      .catch(() => {
        setAuthed(false);
        setChecked(true);
      });
  }, [init]);

  useEffect(() => {
    if (!authed) return;
    const t1 = setInterval(() => void refresh(), 10000);
    const disconnect = connectSocket({
      onBroadcastUpdated: (log) => {
        useStore.getState().onMusicBroadcastUpdate(log);
        useStore.getState().onBroadcastUpdated(log);
        void refresh();
      },
      onTalkAudio: (talkId, pcm, rate) => {
        if (talkId === useStore.getState().activeTalkId)
          liveTalk.play(pcm, rate);
      },
      onEndpointsChanged: () => void refresh(),
      onCallsUpdated: (snapshot) => useStore.getState().setCalls(snapshot),
    });
    return () => {
      clearInterval(t1);
      disconnect();
    };
  }, [authed, init, refresh]);

  if (!checked) return <div className="h-screen bg-background" />;
  if (!authed)
    return (
      <LoginPage
        onLogin={() => {
          setAuthed(true);
          void init();
        }}
      />
    );

  return (
    <div className="grid h-screen min-w-0 grid-cols-1 grid-rows-[56px_minmax(0,1fr)_auto_auto] lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-[56px_minmax(0,1fr)_40px_32px] xl:grid-cols-[260px_minmax(0,1fr)_300px]">
      <Topbar />
      <Sidebar />
      <main className="flex min-w-0 flex-col overflow-hidden bg-background">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="flex-shrink-0 overflow-x-auto border-b border-border px-3 pt-3 sm:px-5">
            <TabsList className="h-auto w-max min-w-full gap-0 bg-transparent p-0">
              <TabsTrigger
                value="broadcast"
                className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5"
              >
                Broadcast
              </TabsTrigger>
              <TabsTrigger
                value="media"
                className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5"
              >
                Media
              </TabsTrigger>
              <TabsTrigger
                value="monitor"
                className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5"
              >
                Monitor
              </TabsTrigger>
              <TabsTrigger
                value="talk"
                className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5"
              >
                Live talk
              </TabsTrigger>
              <TabsTrigger
                value="music"
                className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5"
              >
                Music player
              </TabsTrigger>
              <TabsTrigger
                value="endpoints"
                className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5"
              >
                Endpoints
              </TabsTrigger>
              <TabsTrigger
                value="zones"
                className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5"
              >
                Zones
              </TabsTrigger>
              <TabsTrigger
                value="pa-group"
                className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5"
              >
                PA groups
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5"
              >
                History
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TabsContent value="broadcast" className="mt-0 p-3 sm:p-4 lg:p-5">
              <BroadcastPage />
            </TabsContent>
            <TabsContent value="media" className="mt-0 p-3 sm:p-4 lg:p-5">
              <MediaManagerPage />
            </TabsContent>
            <TabsContent
              value="monitor"
              className="mt-0 h-full p-3 sm:p-4 lg:p-5"
            >
              <MonitorPage />
            </TabsContent>
            <TabsContent value="talk" className="mt-0 h-full p-3 sm:p-4 lg:p-5">
              <LiveTalkPage />
            </TabsContent>
            <TabsContent
              value="music"
              className="mt-0 h-full p-3 sm:p-4 lg:p-5"
            >
              <MusicPlayerPage />
            </TabsContent>
            <TabsContent value="endpoints" className="mt-0 p-3 sm:p-4 lg:p-5">
              <EndpointsPage />
            </TabsContent>
            <TabsContent value="zones" className="mt-0 p-3 sm:p-4 lg:p-5">
              <ZonesPage />
            </TabsContent>
            <TabsContent value="pa-group" className="mt-0 p-3 sm:p-4 lg:p-5">
              <PaGroupsPage />
            </TabsContent>
            <TabsContent value="history" className="mt-0 p-3 sm:p-4 lg:p-5">
              <HistoryPage />
            </TabsContent>
          </div>
        </Tabs>
      </main>
      <RightRail />
      <PlayerBar />
      <StatusBar />
      <Toaster
        position="top-right"
        toastOptions={{ style: { fontSize: 12 } }}
      />
    </div>
  );
};
