import { Router } from "express";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import {
  bellCreateSchema,
  bellOccurrenceQuerySchema,
  bellPatchSchema,
  bellPauseSchema,
  bellSkipCreateSchema,
  bellSkipOccurrenceSchema,
  bellTestSchema,
  bellUpdateSchema,
} from "../validation/schemas.js";
import type { BellService } from "../services/bells.js";

/**
 * `/api/bells` — the scheduled-bell surface. Literal paths are registered before
 * `/:id` so `/status`, `/pause`, `/occurrences`, `/skips` and `/test` are never
 * parsed as ids. Chime upload/preview reuses `/api/announcements` rather than
 * duplicating the audio pipeline here.
 */
export function createBellsRouter(bells: BellService): Router {
  const router = Router();

  const requireEnabled = () => {
    if (!config.bell.enabled)
      throw new ApiError(503, "Scheduled bells are disabled on this server");
  };

  // ---- literal paths first ------------------------------------------------

  router.get("/status", async (_req, res, next) => {
    try {
      requireEnabled();
      res.json(await bells.status());
    } catch (e) {
      next(e);
    }
  });

  router.post("/pause", async (req, res, next) => {
    try {
      requireEnabled();
      const body = bellPauseSchema.parse(req.body ?? {});
      const by = body.by ?? req.session.displayName ?? "";
      res.json(await bells.pause(body.paused, by));
    } catch (e) {
      next(e);
    }
  });

  router.get("/occurrences", async (req, res, next) => {
    try {
      requireEnabled();
      const q = bellOccurrenceQuerySchema.parse(req.query ?? {});
      res.json(await bells.occurrences(q));
    } catch (e) {
      next(e);
    }
  });

  router.post("/occurrences/:id/skip", async (req, res, next) => {
    try {
      requireEnabled();
      const body = bellSkipOccurrenceSchema.parse(req.body ?? {});
      await bells.skipOccurrence(Number(req.params.id), body.reason);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.get("/skips", async (_req, res, next) => {
    try {
      requireEnabled();
      res.json(await bells.listSkips());
    } catch (e) {
      next(e);
    }
  });

  router.post("/skips", async (req, res, next) => {
    try {
      requireEnabled();
      const body = bellSkipCreateSchema.parse(req.body ?? {});
      res.status(201).json(await bells.addSkip(body));
    } catch (e) {
      next(e);
    }
  });

  router.delete("/skips/:id", async (req, res, next) => {
    try {
      requireEnabled();
      await bells.removeSkip(Number(req.params.id));
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // ---- collection ---------------------------------------------------------

  router.get("/", async (_req, res, next) => {
    try {
      requireEnabled();
      res.json(await bells.list());
    } catch (e) {
      next(e);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      requireEnabled();
      const body = bellCreateSchema.parse(req.body ?? {});
      res.status(201).json(await bells.create(body));
    } catch (e) {
      next(e);
    }
  });

  /**
   * Fire unsaved form values (the dialog's "Test" before the bell is saved).
   * Registered before `/:id/test` so the literal path always wins. Nothing is
   * written to the occurrence ledger: a test is an operator action, not a bell.
   */
  router.post("/test", async (req, res, next) => {
    try {
      requireEnabled();
      const body = bellTestSchema.parse(req.body ?? {});
      if (!body.announcementId)
        throw new ApiError(422, "Choose an announcement before testing");
      const { id } = await bells.unsavedTest({
        announcementId: body.announcementId,
        zoneIds: body.zoneIds ?? [],
        endpointIds: body.endpointIds ?? [],
        beep: body.beep ?? false,
        volume: body.volume ?? null,
      });
      res.status(201).json({ broadcastLogId: id });
    } catch (e) {
      next(e);
    }
  });
  // ---- one bell -----------------------------------------------------------

  router.get("/:id", async (req, res, next) => {
    try {
      requireEnabled();
      res.json(await bells.get(Number(req.params.id)));
    } catch (e) {
      next(e);
    }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      requireEnabled();
      const body = bellUpdateSchema.parse(req.body ?? {});
      res.json(await bells.update(Number(req.params.id), body));
    } catch (e) {
      next(e);
    }
  });

  /** Fast card/list enable toggle — does not rematerialize the horizon. */
  router.patch("/:id", async (req, res, next) => {
    try {
      requireEnabled();
      const body = bellPatchSchema.parse(req.body ?? {});
      res.json(await bells.setEnabled(Number(req.params.id), body.enabled));
    } catch (e) {
      next(e);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      requireEnabled();
      await bells.remove(Number(req.params.id));
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  /** Fire now without creating a scheduled occurrence. */
  router.post("/:id/test", async (req, res, next) => {
    try {
      requireEnabled();
      const body = bellTestSchema.parse(req.body ?? {});
      res.status(201).json(await bells.test(Number(req.params.id), body));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
