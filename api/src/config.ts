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
  tls: {
    port: parsed.HTTPS_PORT,
    certPath: parsed.TLS_CERT_PATH,
    keyPath: parsed.TLS_KEY_PATH,
    caPath: parsed.TLS_CA_PATH,
    redirect: parsed.HTTPS_REDIRECT,
  },
};

export type Config = typeof config;
