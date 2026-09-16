import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { useStore } from '@/store';
import { connectSocket } from '@/lib/api/socket';
import { liveTalk } from '@/recorder/recorder';
import { Topbar } from '@/components/Topbar/Topbar';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { RightRail } from '@/components/RightRail/RightRail';
import { StatusBar } from '@/components/StatusBar/StatusBar';
import { PlayerBar } from '@/components/PlayerBar/PlayerBar';
import { BroadcastPage } from '@/pages/BroadcastPage/BroadcastPage';
import { LiveTalkPage } from '@/pages/LiveTalkPage/LiveTalkPage';
import { MusicPlayerPage } from '@/pages/MusicPlayerPage/MusicPlayerPage';
import { EndpointsPage } from '@/pages/EndpointsPage/EndpointsPage';
import { ZonesPage } from '@/pages/ZonesPage/ZonesPage';
import { HistoryPage } from '@/pages/HistoryPage/HistoryPage';
import { MonitorPage } from '@/pages/MonitorPage/MonitorPage';
import { PaGroupsPage } from '@/pages/PaGroupsPage/PaGroupsPage';
import { MediaManagerPage } from '@/pages/MediaManagerPage/MediaManagerPage';
import { LoginPage } from '@/pages/LoginPage/LoginPage';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/Tabs/Tabs';

export const App = () => {
  const init = useStore((s) => s.init);
  const refresh = useStore((s) => s.refresh);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((res) => {
        setAuthed(res.ok);
        setChecked(true);
        if (res.ok) void init();
      })
      .catch(() => { setAuthed(false); setChecked(true); });
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
        if (talkId === useStore.getState().activeTalkId) liveTalk.play(pcm, rate);
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
  if (!authed) return <LoginPage onLogin={() => { setAuthed(true); void init(); }} />;

  return (
    <div className="grid h-screen" style={{ gridTemplateColumns: '260px 1fr 300px', gridTemplateRows: '56px 1fr 40px 32px' }}>
      <Topbar />
      <Sidebar />
      <main className="flex flex-col overflow-hidden bg-background">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-shrink-0 px-5 pt-3 border-b border-border">
            <TabsList className="bg-transparent h-auto p-0 gap-0">
              <TabsTrigger value="broadcast" className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5">Broadcast</TabsTrigger>
              <TabsTrigger value="media" className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5">Media</TabsTrigger>
              <TabsTrigger value="monitor" className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5">Monitor</TabsTrigger>
              <TabsTrigger value="talk" className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5">Live talk</TabsTrigger>
              <TabsTrigger value="music" className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5">Music player</TabsTrigger>
              <TabsTrigger value="endpoints" className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5">Endpoints</TabsTrigger>
              <TabsTrigger value="zones" className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5">Zones</TabsTrigger>
              <TabsTrigger value="pa-group" className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5">PA groups</TabsTrigger>
              <TabsTrigger value="history" className="text-[13px] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2.5">History</TabsTrigger>
            </TabsList>
          </div>
          <div className="flex-1 overflow-y-auto">
            <TabsContent value="broadcast" className="p-5 mt-0"><BroadcastPage /></TabsContent>
            <TabsContent value="media" className="p-5 mt-0"><MediaManagerPage /></TabsContent>
            <TabsContent value="monitor" className="p-5 mt-0 h-full"><MonitorPage /></TabsContent>
            <TabsContent value="talk" className="p-5 mt-0 h-full"><LiveTalkPage /></TabsContent>
            <TabsContent value="music" className="p-5 mt-0 h-full"><MusicPlayerPage /></TabsContent>
            <TabsContent value="endpoints" className="p-5 mt-0"><EndpointsPage /></TabsContent>
            <TabsContent value="zones" className="p-5 mt-0"><ZonesPage /></TabsContent>
            <TabsContent value="pa-group" className="p-5 mt-0"><PaGroupsPage /></TabsContent>
            <TabsContent value="history" className="p-5 mt-0"><HistoryPage /></TabsContent>
          </div>
        </Tabs>
      </main>
      <RightRail />
      <PlayerBar />
      <StatusBar />
      <Toaster position="top-right" toastOptions={{ style: { fontSize: 12 } }} />
    </div>
  );
};
