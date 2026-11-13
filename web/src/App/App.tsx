import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import { useStore } from "@/store";
import { hasContextRail } from "@/lib/tabs";
import { connectSocket } from "@/lib/api/socket";
import { liveTalk } from "@/recorder/recorder";
import { Topbar } from "@/components/Topbar/Topbar";
import { IconRail } from "@/components/IconRail/IconRail";
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

const PAGES = {
  broadcast: BroadcastPage,
  media: MediaManagerPage,
  monitor: MonitorPage,
  talk: LiveTalkPage,
  music: MusicPlayerPage,
  endpoints: EndpointsPage,
  zones: ZonesPage,
  "pa-group": PaGroupsPage,
  history: HistoryPage,
};

export const App = () => {
  const init = useStore((s) => s.init);
  const refresh = useStore((s) => s.refresh);
  const activeTab = useStore((s) => s.activeTab);

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
      onConnectionChange: (connected) =>
        useStore.getState().onTalkConnectionChange(connected),
    });
    return () => {
      clearInterval(t1);
      disconnect();
    };
  }, [authed, init, refresh]);

  if (!checked) return <div style={{ height: "100dvh", background: "var(--bg)" }} />;
  if (!authed)
    return (
      <LoginPage
        onLogin={() => {
          setAuthed(true);
          void init();
        }}
      />
    );

  const Page = PAGES[activeTab];
  const showContext = hasContextRail(activeTab);

  return (
    <div className={`shell${showContext ? "" : " no-context"}`}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <Topbar />
      <IconRail />
      <main className="workspace" id="workspace" tabIndex={-1}>
        <Page />
      </main>
      {showContext ? <RightRail /> : null}
      <PlayerBar />
      <StatusBar />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontSize: 12,
            background: "var(--pan)",
            color: "var(--ink)",
            border: "1px solid var(--line)",
            borderRadius: 10,
          },
        }}
      />
    </div>
  );
};
