import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import type { AmiClient } from "../ami/client.js";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import type { Server as SocketServer } from "socket.io";
import { EVENTS } from "@infinity/shared";

/**
 * Endpoint CRUD + pjsip config regeneration. The generated file is written to
 * the bind-mounted /etc/asterisk/endpoints.conf and Asterisk is reloaded via
 * AMI — never hand-edit the generated file.
 */
export class EndpointService {
  constructor(
    private readonly ami: AmiClient,
    private readonly io: SocketServer,
  ) {}

  async list(): Promise<ReturnType<typeof this.serialize>[]> {
    const endpoints = await prisma.endpoint.findMany({
      orderBy: { extension: "asc" },
    });
    const contacts = await this.fetchContacts();

    // Persist last-seen User-Agent per endpoint (write only when changed).
    await Promise.all(
      endpoints.map(async (e) => {
        const c = contacts.get(e.extension);
        if (c && (e.userAgent ?? "") !== c.userAgent) {
          await prisma.endpoint.update({
            where: { id: e.id },
            data: { userAgent: c.userAgent || null },
          });
        }
      }),
    );

    const withContact = endpoints.map((e) => {
      const c = contacts.get(e.extension) ?? null;
      return this.serialize(
        { ...e, userAgent: c?.userAgent ?? e.userAgent },
        c,
      );
    });
    return withContact;
  }

  async create(data: {
    extension: string;
    label: string;
    location: string;
    type: string;
  }): Promise<ReturnType<typeof this.serialize>> {
    const existing = await prisma.endpoint.findUnique({
      where: { extension: data.extension },
    });
    if (existing)
      throw new ApiError(422, "Extension already exists", {
        extension: ["already taken"],
      });

    const endpoint = await prisma.endpoint.create({
      data: {
        extension: data.extension,
        label: data.label,
        location: data.location,
        type: data.type,
        sipPassword: randomBytes(6).toString("base64url").slice(0, 12),
      },
    });

    await this.regenerate();
    return this.serialize(endpoint, null);
  }

  async update(
    id: number,
    data: { label: string; location: string; type: string; isActive: boolean },
  ): Promise<ReturnType<typeof this.serialize>> {
    const endpoint = await prisma.endpoint.update({ where: { id }, data });
    await this.regenerate();
    return this.serialize(endpoint, null);
  }

  async regeneratePassword(
    id: number,
  ): Promise<ReturnType<typeof this.serialize>> {
    const endpoint = await prisma.endpoint.update({
      where: { id },
      data: { sipPassword: randomBytes(6).toString("base64url").slice(0, 12) },
    });
    await this.regenerate();
    return this.serialize(endpoint, null);
  }

  async remove(id: number): Promise<void> {
    await prisma.endpoint.delete({ where: { id } });
    await this.regenerate();
  }

  async setActive(
    id: number,
    isActive: boolean,
  ): Promise<ReturnType<typeof this.serialize>> {
    const endpoint = await prisma.endpoint.update({
      where: { id },
      data: { isActive },
    });
    await this.regenerate();
    return this.serialize(endpoint, null);
  }

  /**
   * Send a SIP OPTIONS qualify to a specific endpoint via AMI. This verifies
   * the device's registration is reachable and, on many handsets/speakers,
   * prompts it to refresh its REGISTER (i.e. "reconnect from the web").
   */
  async requalify(id: number): Promise<{ ok: boolean }> {
    const endpoint = await prisma.endpoint.findUnique({ where: { id } });
    if (!endpoint) throw new ApiError(404, "Endpoint not found");
    const cmd = `pjsip qualify ${endpoint.extension}`;
    try {
      const resp = await this.ami.action({ Action: "Command", Command: cmd });
      const out = resp.keys?.output ?? "";
      if (/invalid|no such command|cannot/i.test(out))
        throw new Error(out.trim() || "Requalify rejected");
      return { ok: true };
    } catch (err) {
      throw new ApiError(500, `Requalify failed: ${(err as Error).message}`);
    }
  }

  async fetchContacts(): Promise<
    Map<string, { uri: string; userAgent: string }>
  > {
    try {
      return await this.ami.pjsipShowContacts();
    } catch {
      // AMI unavailable — registration state simply reads empty.
      return new Map<string, { uri: string; userAgent: string }>();
    }
  }

  private serialize(
    endpoint: {
      id: number;
      extension: string;
      label: string;
      location: string;
      type: string;
      isActive: boolean;
      sipPassword: string;
      userAgent: string | null;
    },
    contact: { uri: string; userAgent: string } | null | undefined,
  ) {
    const m = contact ? /^sip:\d+@([^:;]+)(?::(\d+))?/.exec(contact.uri) : null;

    return {
      id: endpoint.id,
      extension: endpoint.extension,
      label: endpoint.label,
      location: endpoint.location,
      type: endpoint.type,
      isActive: endpoint.isActive,
      registered: Boolean(contact),
      contact: contact?.uri ?? null,
      contactIp: m ? (m[2] ? `${m[1]}:${m[2]}` : m[1]) : null,
      userAgent: endpoint.userAgent ?? null,
      sipPassword: endpoint.sipPassword,
    };
  }

  /** Write endpoints.conf from the DB and reload pjsip via AMI. */
  async regenerate(): Promise<void> {
    const endpoints = await prisma.endpoint.findMany({
      where: { isActive: true },
      orderBy: { extension: "asc" },
    });

    const lines: string[] = [
      "; GENERATED BY INFINITY ECHO - DO NOT HAND-EDIT",
      "; Source: api/src/services/endpoints.ts",
      "",
    ];
    for (const e of endpoints) {
      lines.push(
        `[${e.extension}](endpoint-tpl)`,
        `auth = ${e.extension}-auth`,
        `aors = ${e.extension}`,
        `callerid = "${e.label}" <${e.extension}>`,
        "",
        `[${e.extension}-auth](auth-tpl)`,
        `username = ${e.extension}`,
        `password = ${e.sipPassword}`,
        "",
        `[${e.extension}](aor-tpl)`,
        "",
      );
    }

    await fs.mkdir(config.endpointsConfPath.replace(/\/[^/]+$/, ""), {
      recursive: true,
    });
    await fs.writeFile(config.endpointsConfPath, lines.join("\n"), "utf8");

    try {
      await this.ami.action({
        Action: "Command",
        Command: "module reload res_pjsip.so",
      });
    } catch (err) {
      console.warn("AMI reload failed:", (err as Error).message);
    }

    this.io.emit(EVENTS.endpointsChanged);
  }
}
