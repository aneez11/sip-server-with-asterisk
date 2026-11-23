import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  AMI_HOST: z.string().default('asterisk'),
  AMI_PORT: z.coerce.number().default(5038),
  AMI_USERNAME: z.string().default('broadcastapi'),
  AMI_SECRET: z.string().min(1),
  ASTERISK_ENDPOINTS_CONF_PATH: z.string().default('/etc/asterisk/endpoints.conf'),
  ANNOUNCEMENTS_DIR: z.string().default('/announcements'),
  PAGE_DURATION: z.coerce.number().default(10),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().min(1),
  ADMIN_DISPLAY: z.string().default('Institute Admin'),
  SESSION_SECRET: z.string().min(8),
  WEB_DIST: z.string().default('web/dist'),
  NODE_ENV: z.string().default('production'),
  // Live talk: the API's SIP/RTP operator UA (browser mic -> Asterisk media leg).
  LIVETALK_ASTERISK_HOST: z.string().default('asterisk'),
  LIVETALK_ASTERISK_PORT: z.coerce.number().default(5060),
  LIVETALK_FROM_USER: z.string().default('operator'),
  LIVETALK_PAGE_DURATION: z.coerce.number().default(3600),
  // Shared secret for the internal PA-trigger route (dialplan AGI hook).
  PA_TRIGGER_SECRET: z.string().default('pa-internal-trigger-secret'),
  // ---- endpoint cameras (ONVIF + RTSP -> WebRTC gateway) --------------------
  // Master switch. When false the camera routes answer 503 and the console
  // hides the camera UI, so the feature can ship dark and be enabled per site.
  CAMERA_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
  // Key material for encrypting camera passwords at rest. Must stay stable: a
  // changed value makes previously stored camera passwords unreadable.
  CAMERA_SECRET: z.string().default('change-me-camera-secret'),
  // go2rtc REST API on the compose network (never published to the host).
  CAMERA_GATEWAY_URL: z.string().default('http://go2rtc:1984'),
  // How long a per-talk camera token stays valid beyond the talk itself.
  CAMERA_TOKEN_TTL_SEC: z.coerce.number().default(3600),
  // Transcode camera video to H.264 when the camera only offers H.265 (browsers
  // cannot decode HEVC over WebRTC). 'auto' = transcode only when needed,
  // 'never' = refuse (operator must switch the camera stream to H.264).
  CAMERA_TRANSCODE: z.enum(['auto', 'never']).default('auto'),
  // Docker host LAN IP clients use to reach the SIP server (shown in the
  // device config guide). Same value as the asterisk container's HOST_IP.
  HOST_IP: z.string().default('10.20.30.20'),
  // Optional HTTPS listener. Browsers only expose navigator.mediaDevices in a
  // secure context, so Live Talk (browser mic) cannot work over plain HTTP on a
  // LAN IP. 0 disables the listener and keeps HTTP-only behaviour.
  HTTPS_PORT: z.coerce.number().default(0),
  TLS_CERT_PATH: z.string().default('/app/certs/server.pem'),
  TLS_KEY_PATH: z.string().default('/app/certs/server.key'),
  // Root CA that signed the leaf cert above. Served at /ca.pem so operators can
  // install it once per device and stop seeing the self-signed warning.
  TLS_CA_PATH: z.string().default('/app/certs/ca.pem'),
  // Redirect HTML page loads from HTTP to HTTPS so nobody ends up on the
  // insecure origin where the microphone API does not exist. API/socket/health
  // traffic keeps working over HTTP.
  HTTPS_REDIRECT: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
  // ---- scheduled bells (school chimes / shift bells) -----------------------
  // Hard kill switch: when false the router answers 503 and the tick is a no-op.
  BELL_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
  // IANA zone every wall-clock bell value is interpreted in. Nepal has no DST,
  // but the math is zone-generic so it is not Nepal-only.
  BELL_TIMEZONE: z.string().default('Asia/Kathmandu'),
  // How far ahead occurrences are materialized.
  BELL_HORIZON_DAYS: z.coerce.number().int().min(1).max(180).default(14),
  // Dispatch tick period in milliseconds (15 s default).
  BELL_TICK_MS: z.coerce.number().int().min(1000).max(300_000).default(15000),
  // How long a bell waits for a busy zone before failing (never pre-empts).
  BELL_BUSY_GRACE_SEC: z.coerce.number().int().min(0).max(3600).default(60),
  // Ring late after downtime; 0 = mark missed instead of bursting chimes.
  BELL_CATCHUP_SEC: z.coerce.number().int().min(0).max(86_400).default(0),
  // Ledger pruning window.
  BELL_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
});

const parsed = envSchema.parse(process.env);

export const config = {
  port: parsed.PORT,
  databaseUrl: parsed.DATABASE_URL,
  ami: {
    host: parsed.AMI_HOST,
    port: parsed.AMI_PORT,
    username: parsed.AMI_USERNAME,
    secret: parsed.AMI_SECRET,
  },
  endpointsConfPath: parsed.ASTERISK_ENDPOINTS_CONF_PATH,
  announcementsDir: parsed.ANNOUNCEMENTS_DIR,
  pageDuration: parsed.PAGE_DURATION,
  admin: {
    username: parsed.ADMIN_USERNAME,
    password: parsed.ADMIN_PASSWORD,
    display: parsed.ADMIN_DISPLAY,
  },
  sessionSecret: parsed.SESSION_SECRET,
  webDist: parsed.WEB_DIST,
  isDev: parsed.NODE_ENV === 'development',
  liveTalk: {
    asteriskHost: parsed.LIVETALK_ASTERISK_HOST,
    asteriskPort: parsed.LIVETALK_ASTERISK_PORT,
    fromUser: parsed.LIVETALK_FROM_USER,
    pageDuration: parsed.LIVETALK_PAGE_DURATION,
  },
  paTriggerSecret: parsed.PA_TRIGGER_SECRET,
  hostIp: parsed.HOST_IP,
  camera: {
    enabled: parsed.CAMERA_ENABLED,
    secret: parsed.CAMERA_SECRET,
    gatewayUrl: parsed.CAMERA_GATEWAY_URL,
    tokenTtlSec: parsed.CAMERA_TOKEN_TTL_SEC,
    transcode: parsed.CAMERA_TRANSCODE,
  },
  tls: {
    port: parsed.HTTPS_PORT,
    certPath: parsed.TLS_CERT_PATH,
    keyPath: parsed.TLS_KEY_PATH,
    caPath: parsed.TLS_CA_PATH,
    redirect: parsed.HTTPS_REDIRECT,
  },
  bell: {
    enabled: parsed.BELL_ENABLED,
    timezone: parsed.BELL_TIMEZONE,
    horizonDays: parsed.BELL_HORIZON_DAYS,
    tickMs: parsed.BELL_TICK_MS,
    busyGraceSec: parsed.BELL_BUSY_GRACE_SEC,
    catchupSec: parsed.BELL_CATCHUP_SEC,
    retentionDays: parsed.BELL_RETENTION_DAYS,
  },
};

export type Config = typeof config;
