// Live monitor — aggregates every active call (broadcast, music, live talk,
// two-way) into a single snapshot with per-device receive status, pushed to the
// browser over Socket.IO (`calls.updated`).
//
// Two sources feed this:
//   - AmiListener  -> broadcast/music pages (each member's dial/answer/hangup)
//   - LiveTalkService -> live talk / two-way sessions (operator UA)
//
// Both report member lifecycle transitions here; the service stores the current
// state per call and re-emits a full snapshot on every change so the UI has no
// client-side reconciliation to do.

import type { Server as SocketServer } from 'socket.io';
import { EVENTS, type ActiveCall, type ActiveCallMember, type CallKind, type CallsSnapshot, type DeviceCallStatus } from '@infinity/shared';

interface MonitorCall {
  id: string;
  kind: CallKind;
  title: string;
  zoneId: number | null;
  startedAt: string | null;
  /** extension -> live device status. */
  members: Map<string, DeviceCallStatus>;
}

export class MonitorService {
  private calls = new Map<string, MonitorCall>();

  constructor(private readonly io: SocketServer) {}

  /** Register a call (broadcast/music/live/twoway). Idempotent by id. */
  beginCall(input: { id: string; kind: CallKind; title: string; zoneId: number | null; startedAt: string | null; extensions: string[] }): void {
    if (this.calls.has(input.id)) return;
    const members = new Map<string, DeviceCallStatus>();
    for (const ext of input.extensions) members.set(ext, 'idle');
    this.calls.set(input.id, {
      id: input.id,
      kind: input.kind,
      title: input.title,
      zoneId: input.zoneId,
      startedAt: input.startedAt,
      members,
    });
    this.emit();
  }

  /** Set a member's status; creates the member if unknown, then emits. */
  setMember(callId: string, extension: string, status: DeviceCallStatus): void {
    const call = this.calls.get(callId);
    if (!call) return;
    call.members.set(extension, status);
    this.emit();
  }

  /** Remove a call from the active set (broadcast finished / talk ended). */
  endCall(callId: string): void {
    if (this.calls.delete(callId)) this.emit();
  }

  /** Current snapshot of active calls with per-device status. */
  snapshot(): CallsSnapshot {
    const active: ActiveCall[] = [...this.calls.values()].map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      zoneId: c.zoneId,
      startedAt: c.startedAt,
      members: [...c.members.entries()].map(([extension, status]): ActiveCallMember => ({ extension, status })),
    }));
    return { active, serverTime: new Date().toISOString() };
  }

  private emit(): void {
    this.io.emit(EVENTS.callsUpdated, this.snapshot());
  }
}
