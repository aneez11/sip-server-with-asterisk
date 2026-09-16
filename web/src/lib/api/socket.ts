import { io, type Socket } from 'socket.io-client';
import { EVENTS, type BroadcastLog, type CallsSnapshot } from '@infinity/shared';

export type SocketHandlers = {
  onBroadcastUpdated?: (log: BroadcastLog) => void;
  onEndpointsChanged?: () => void;
  onTalkAudio?: (talkId: string, pcm: Int16Array, rate: number) => void;
  onCallsUpdated?: (snapshot: CallsSnapshot) => void;
};

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io('/', { path: '/socket.io', transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function connectSocket(handlers: SocketHandlers): () => void {
  const h = handlers;
  const sock = getSocket();
  sock.on(EVENTS.broadcastUpdated, (log: BroadcastLog) => h.onBroadcastUpdated?.(log));
  sock.on(EVENTS.endpointsChanged, () => h.onEndpointsChanged?.());
  sock.on(EVENTS.callsUpdated, (snapshot: CallsSnapshot) => h.onCallsUpdated?.(snapshot));
  sock.on('talk:audio', (payload: { talkId?: string; rate?: number; data?: ArrayBuffer }) => {
    if (payload?.talkId && payload?.data && payload?.rate) {
      h.onTalkAudio?.(payload.talkId, new Int16Array(payload.data), payload.rate);
    }
  });
  return () => {
    sock.off(EVENTS.broadcastUpdated);
    sock.off(EVENTS.endpointsChanged);
    sock.off(EVENTS.callsUpdated);
    sock.off('talk:audio');
  };
}

export const talkSocket = {
  join: (talkId: string) => getSocket().emit('talk:join', talkId),
  /** Stream a mic PCM chunk to the active talk (Int16 at the browser rate). */
  sendAudio: (talkId: string, pcm: Int16Array, rate: number) => {
    const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
    getSocket().emit('talk:audio', { talkId, rate, data: buf });
  },
  disconnect: () => {
    getSocket().disconnect();
    socket = null;
  },
};
