import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import multer from "multer";
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AmiClient } from "./ami/client.js";
import { AmiListener } from "./ami/listener.js";
import { EndpointService } from "./services/endpoints.js";
import { AnnouncementService } from "./services/announcements.js";
import { BroadcastService } from "./services/broadcast.js";
import authRouter from "./routes/auth.js";
import {
  createEndpointsRouter,
  createZonesRouter,
  createAnnouncementsRouter,
  createBroadcastRouter,
  createTalkRouter,
  createMusicRouter,
  createStatusRouter,
  createProfilesRouter,
  createMonitorRouter,
  createPaGroupsRouter,
  createPaTriggerRouter,
  createMediaRouter,
} from "./routes/index.js";
import { LiveTalkService, SOCKET_AUDIO_EVENT } from "./live/LiveTalkService.js";
import { MonitorService } from "./live/monitor.js";
import { PaGroupService } from "./services/pa-groups.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Socket.IO delivers binary attachments to Node as a Buffer (a Uint8Array
 *  view over pooled memory). `new Int16Array(buffer)` would copy byte→sample
 *  (every byte becomes one 16-bit sample) and shred the audio into noise.
 *  Convert the underlying bytes to Int16 correctly — handles both Buffer and
 *  ArrayBuffer inputs. */
function toInt16(data: ArrayBuffer | Uint8Array): Int16Array | null {
  if (data instanceof ArrayBuffer) return new Int16Array(data);
  if (data instanceof Uint8Array) {
    const bytes = (data.buffer as ArrayBuffer).slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    );
    return new Int16Array(bytes);
  }
  return null;
}

async function seedAdmin() {
  const existing = await prisma.user.findUnique({
    where: { username: config.admin.username },
  });
  if (!existing) {
    const hash = await bcrypt.hash(config.admin.password, 12);
    await prisma.user.create({
      data: {
        username: config.admin.username,
        passwordHash: hash,
        displayName: config.admin.display,
      },
    });
    console.log("Admin user seeded");
  }
}

async function main() {
  // Prisma DB push (schema sync)
  const { execSync } = await import("node:child_process");
  try {
    execSync("npx prisma db push --accept-data-loss", {
      cwd: path.join(__dirname, ".."),
      stdio: "pipe",
    });
  } catch (err) {
    console.warn("Prisma schema sync skipped:", (err as Error).message);
  }
  await seedAdmin();

  // AMI client
  const ami = new AmiClient({
    host: config.ami.host,
    port: config.ami.port,
    username: config.ami.username,
    secret: config.ami.secret,
  });
  ami.on("error", (err) => console.error("AMI error:", err.message));
  ami.on("ready", () => console.log("AMI connected"));
  ami.on("close", () => console.log("AMI disconnected, reconnecting..."));
  ami.start();

  // Express + Socket.IO
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: true, credentials: true },
  });

  app.use(express.json());

  // MySQL-backed sessions (avoids the MemoryStore leak warning and survives
  // API restarts). The sessions table is created automatically.
  const dbUrl = new URL(config.databaseUrl);
  const MySQLStore = MySQLStoreFactory(session);
  const sessionStore = new MySQLStore({
    host: dbUrl.hostname,
    port: Number(dbUrl.port || 3306),
    user: dbUrl.username,
    password: dbUrl.password,
    database: dbUrl.pathname.slice(1),
    createDatabaseTable: true,
    expiration: 24 * 60 * 60 * 1000,
  });

  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: { httpOnly: true, secure: false, maxAge: 24 * 60 * 60 * 1000 },
    }),
  );

  // Auth middleware
  app.use("/api", (req, _res, next) => {
    (req as any).io = io;
    next();
  });
  app.use("/api/auth", authRouter);
  app.use("/api", (req, res, next) => {
    // Internal AGI/PA trigger route is authenticated by its own shared-secret
    // bearer token, not the browser session — exempt it from session auth.
    if (req.path.startsWith("/pa-trigger")) return next();
    if (!(req as any).session?.userId)
      return res.status(401).json({ message: "Unauthorized" });
    next();
  });

  // Services
  const monitor = new MonitorService(io);
  const listener = new AmiListener(ami, io, monitor);
  const endpointService = new EndpointService(ami, io);
  const announcementService = new AnnouncementService(ami, io, () =>
    listener.hangupMusic(),
  );
  const broadcastService = new BroadcastService(
    ami,
    io,
    announcementService,
    (logId) => listener.stopBroadcast(logId),
  );
  const liveTalk = new LiveTalkService(
    ami,
    io,
    (logId) => listener.stopBroadcast(logId),
    monitor,
  );
  const paGroupService = new PaGroupService(
    ami,
    io,
    (logId) => listener.stopBroadcast(logId),
    monitor,
  );

  // Wire the PA initiator-leave hook: when the initiator hangs up, replay pa_end
  // to the receivers then tear the conference down.
  listener.setPaInitiatorLeftHandler(
    (pageConf: string) => void paGroupService.onInitiatorLeft(pageConf),
  );

  // AMI listener
  //
  // Long-running stability:
  //  - `ready` can fire again after an AMI reconnect. The interval must be
  //    created at most once, or every reconnect stacks another sweep loop,
  //    compounding AMI/DB load until the process stalls (the multi-day hang).
  //  - A rejecting sweep must not become an unhandled rejection; log and retry.
  let sweepInterval: ReturnType<typeof setInterval> | null = null;
  let lastSweepAt = 0;
  ami.on("ready", () => {
    void liveTalk.cleanupOrphans();
    void announcementService.seedPaMedia();
    if (sweepInterval) return;
    sweepInterval = setInterval(() => {
      void listener
        .sweep()
        .then(() => {
          lastSweepAt = Date.now();
        })
        .catch((err) => console.warn("sweep failed:", (err as Error).message));
    }, 5000);
  });
  ami.on("close", () => {
    if (sweepInterval) {
      clearInterval(sweepInterval);
      sweepInterval = null;
    }
  });

  // Event-loop watchdog: if the process is blocked for a long time (deadlock or
  // runaway synchronous work), exit so `restart: unless-stopped` starts a clean
  // process. A permanently blocked loop cannot run this timer and is caught
  // externally by the container healthcheck hitting /health.
  const WATCHDOG_TICK_MS = 30_000;
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const drift = now - lastTick - WATCHDOG_TICK_MS;
    lastTick = now;
    if (drift > 120_000) {
      console.error(
        `Watchdog: event loop stalled ~${Math.round(drift / 1000)}s — exiting for restart`,
      );
      process.exit(1);
    }
  }, WATCHDOG_TICK_MS);

  // Never leave the process in an undefined state after a fatal error.
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
  });

  // Routes
  app.use("/api/endpoints", createEndpointsRouter(endpointService));
  app.use("/api/zones", createZonesRouter());
  app.use("/api/profiles", createProfilesRouter());
  app.use("/api/announcements", createAnnouncementsRouter(announcementService));
  app.use("/api/music", createMusicRouter(announcementService));
  app.use("/api/broadcast", createBroadcastRouter(broadcastService));
  app.use("/api/talk", createTalkRouter(liveTalk));
  app.use("/api/status", createStatusRouter(endpointService, ami));
  app.use("/api/monitor", createMonitorRouter(monitor, listener, ami));
  app.use("/api/pa-groups", createPaGroupsRouter(paGroupService));
  app.use(
    "/api/pa-trigger",
    createPaTriggerRouter(paGroupService, config.paTriggerSecret),
  );
  app.use("/api/media", createMediaRouter(announcementService));

  // Liveness endpoint (unauthenticated; outside /api so it bypasses session
  // auth). Docker's healthcheck calls this. It only answers while the event
  // loop is responsive, and returns 503 when the AMI/DB sweep loop has stopped
  // progressing — either condition means the container should be restarted
  // (autoheal; see docker-compose.yml).
  app.get("/health", (_req, res) => {
    const sweepStale = lastSweepAt > 0 && Date.now() - lastSweepAt > 60_000;
    res.status(sweepStale ? 503 : 200).json({
      status: sweepStale ? "stale" : "ok",
      amiConnected: ami.isConnected(),
      uptimeSec: Math.round(process.uptime()),
      lastSweepAt: lastSweepAt ? new Date(lastSweepAt).toISOString() : null,
    });
  });

  // Live talk socket audio: the operator's browser streams mic PCM here and
  // the API feeds it into the RTP leg; two-way audio comes back the same way.
  io.on("connection", (socket) => {
    socket.on("talk:join", (talkId: string) => {
      liveTalk.join(socket.id, talkId);
    });
    socket.on(
      SOCKET_AUDIO_EVENT,
      (payload: { talkId?: string; rate?: number; data?: ArrayBuffer }) => {
        if (!payload?.talkId || !payload?.data || !payload?.rate) return;
        const pcm = toInt16(payload.data);
        if (!pcm || pcm.length === 0) return;
        void liveTalk.sendAudio(payload.talkId, pcm, payload.rate);
      },
    );
    socket.on("disconnect", () => {
      void liveTalk.stopForSocket(socket.id);
    });
  });

  // Static web (built SPA)
  const webDist = path.resolve(config.webDist);
  app.use(express.static(webDist));

  // JSON error handler — never let Express render HTML error pages for /api.
  app.use(
    "/api",
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res
          .status(413)
          .json({ message: "File too large — maximum upload size is 50 MB" });
      }
      if (err instanceof ApiError) {
        return res
          .status(err.status)
          .json({ message: err.message, errors: err.errors });
      }
      if (err instanceof ZodError) {
        const errors: Record<string, string[]> = {};
        for (const issue of err.issues) {
          const key = String(issue.path[0] ?? "body");
          (errors[key] ??= []).push(issue.message);
        }
        return res
          .status(422)
          .json({
            message: errors[Object.keys(errors)[0]]?.[0] ?? "Validation failed",
            errors,
          });
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return res.status(422).json({ message: "Value already exists" });
      }
      console.error(err);
      res
        .status(500)
        .json({
          message: err instanceof Error ? err.message : "Internal server error",
        });
    },
  );

  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });

  httpServer.listen(config.port, () => {
    console.log(`Infinity Echo API running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
