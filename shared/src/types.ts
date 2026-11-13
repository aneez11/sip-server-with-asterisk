export type EndpointType = "phone" | "speaker";

export interface Endpoint {
  id: number;
  extension: string;
  label: string;
  location: string;
  type: EndpointType;
  isActive: boolean;
  registered: boolean;
  contact?: string | null;
  contactIp?: string | null;
  userAgent?: string | null;
  sipPassword?: string;
  createdAt?: string;
}

export interface Zone {
  id: number;
  name: string;
  beep: boolean;
  volume: number | null;
  announcementId: number | null;
  autoAnswerProfileId: number | null;
  endpointCount: number;
  endpointIds: number[];
}

export interface AutoAnswerProfile {
  id: number;
  name: string;
  userAgentMatch: string | null;
  alertInfo: string | null;
  callInfo: string | null;
  sipUri: string | null;
  dTime: number | null;
  dialOptions: string | null;
}

// ---- PA groups (initiator/receiver one-to-many announcements) ---------------

export interface PaGroup {
  id: number;
  name: string;
  extension: string;
  initiatorEndpointId: number | null;
  initiatorExtension?: string | null;
  initiatorLabel?: string | null;
  paStartAnnouncementId: number | null;
  paEndAnnouncementId: number | null;
  receiverEndpointIds: number[];
  receiverCount?: number;
  createdAt?: string;
}

/** Resolved group used by the AGI trigger (receiver extension list + audio). */
export interface PaGroupTrigger {
  ok: boolean;
  pageConf: string;
  receivers: string[]; // extensions to originate as member legs
  paStart: string | null; // announcement filename or 'beep'
  paEnd: string | null;
  title: string;
}

export type BroadcastStatus =
  | "pending"
  | "success"
  | "partial"
  | "failed"
  | "stopped";

export interface BroadcastLog {
  id: number;
  status: BroadcastStatus;
  zoneId: number | null;
  zoneName?: string | null;
  title: string;
  endpointIds: number[];
  durationSec?: number | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface Announcement {
  id: number;
  name: string;
  filename: string;
  originalName: string;
  originalFile?: string;
  fileSize: number;
  duration?: number | null;
  flash: boolean;
  music?: boolean;
  /** Available to broadcast announcements (defaults to legacy: !music). */
  broadcast?: boolean;
  createdAt?: string;
}

export interface Music {
  id: number;
  name: string;
  filename: string;
  originalName: string;
  originalFile?: string;
  fileSize: number;
  duration?: number | null;
  createdAt?: string;
  broadcast?: boolean;
}

export interface OverviewResponse {
  endpoints: Endpoint[];
  zones: Zone[];
  recentLogs: BroadcastLog[];
  announcements: Announcement[];
  music: Music[];
  /** Every non-flash media item with its broadcast/music availability. */
  media: Announcement[];
  profiles: AutoAnswerProfile[];
  /** Zone ids with a currently active (pending) broadcast. */
  busyZoneIds: number[];
  /** Whether the API is connected to Asterisk's AMI (true status of AMI). */
  amiConnected: boolean;
  /** Docker host LAN IP clients use to reach the SIP server (HOST_IP). */
  serverHost?: string | null;
  serverTime: string;
}

export interface AuthResponse {
  ok: boolean;
  user?: { id: number; username: string; displayName: string };
  message?: string;
}

// ---- live talk (record-then-play) -----------------------------------------

export type TalkSource = "mic" | "device";

export interface TalkStartRequest {
  /** Individually selected endpoint ids. */
  endpointIds?: number[];
  /** PA group ids — every receiver of each group is added as a live target. */
  paGroupIds?: number[];
  /**
   * Where the audio comes from: the operator's microphone (default) or audio
   * already playing on the operator's device (tab/system capture). Device audio
   * is always a one-way broadcast — it never becomes a two-way call.
   */
  source?: TalkSource;
}

export interface TalkSessionView {
  id: string;
  mode: "live" | "twoway";
  /** Resolved endpoint ids actually being talked to (groups expanded). */
  endpointIds: number[];
  /** PA groups that contributed targets to this session. */
  paGroupIds: number[];
  source: TalkSource;
  startedAt: string;
}

// ---- endpoint cameras (ONVIF + WebRTC preview) -----------------------------

export interface OnvifProfileView {
  token: string;
  name: string;
  width?: number;
  height?: number;
  encoding?: string;
  bitrateKbps?: number;
}

export interface CameraView {
  enabled: boolean;
  configured: boolean;
  reachable: boolean | null;
  host: string | null;
  port: number | null;
  username: string | null;
  hasPassword: boolean;
  channel: number;
  preferredStream: string;
  profileToken: string;
  profileName: string;
  streamUri: string | null;
  snapshotAvailable: boolean;
  streamCodec: string | null;
  streamWidth: number | null;
  streamHeight: number | null;
  lastCheckAt: string | null;
  lastCheckError: string | null;
  profiles: OnvifProfileView[];
}

export interface CameraStartResponse {
  token: string;
  expiresAt: string;
}

export interface CameraStatusResponse {
  enabled: boolean;
  gateway: boolean;
}

export interface TalkStartResponse {
  broadcastLogId: number;
}

// ---- WebSocket events ------------------------------------------------------

export interface CodecNegotiatedPayload {
  endpointId: number | null;
  extension: string;
  endpointModel: string;
  negotiatedCodec: string;
  broadcastId: number | null;
  ts: number;
}

export type SocketEvent =
  | { type: "broadcast.updated"; log: BroadcastLog }
  | { type: "talk.played"; broadcastLogId: number }
  | { type: "endpoints.changed" }
  | { type: "codec.negotiated"; data: CodecNegotiatedPayload };

// ---- live monitor (active calls) --------------------------------------------

export type CallKind = "broadcast" | "music" | "live" | "twoway";

/** Per-device receive status for an active call. */
export type DeviceCallStatus =
  | "idle"
  | "dialing"
  | "receiving"
  | "done"
  | "missed";

export interface ActiveCallMember {
  extension: string;
  status: DeviceCallStatus;
}

export interface ActiveCall {
  id: string;
  kind: CallKind;
  title: string;
  zoneId: number | null;
  startedAt: string | null;
  members: ActiveCallMember[];
}

export interface CallsSnapshot {
  active: ActiveCall[];
  serverTime: string;
}

export const EVENTS = {
  broadcastUpdated: "broadcast.updated",
  talkPlayed: "talk.played",
  endpointsChanged: "endpoints.changed",
  codecNegotiated: "codec:negotiated",
  callsUpdated: "calls.updated",
} as const;
