// Member legs for paging/music/live broadcasts.
//
// Dial()'s U() connect option only runs on the FIRST answered channel, so a
// single dial to multiple `&`-joined endpoints joins only ONE member into the
// conference. To fix this, each endpoint gets its own member leg
// (Local/9000@paging or Local/9001@music) dialing a SINGLE PJSIP target; every
// answered member joins the SAME shared conference (same _PAGE_CONF). The
// listener aggregates finalization by log id.

import type { AmiClient } from '../ami/client.js';
import { buildMemberVars, type AutoAnswerProfileInput } from './paging-vars.js';

export interface MemberLegsOptions {
  ami: AmiClient;
  endpointExtensions: string[];
  logId: number;
  pageConf: string;
  title: string;
  volume?: number | null;
  autoAnswer?: AutoAnswerProfileInput | null;
  music?: boolean;
  /** ConfBridge user role for the member (default paging_user; PA uses paging_pa_user). */
  role?: string | null;
}

export async function originateMemberLegs(opts: MemberLegsOptions): Promise<void> {
  const channel = opts.music ? 'Local/9001@music' : 'Local/9000@paging';
  for (const ext of opts.endpointExtensions) {
    await opts.ami.action({
      Action: 'Originate',
      Channel: channel,
      Application: 'Wait',
      Data: '3600',
      Variable: buildMemberVars({
        pageMembers: `PJSIP/${ext}`,
        logId: opts.logId,
        pageConf: opts.pageConf,
        title: opts.title,
        volume: opts.volume ?? null,
        autoAnswer: opts.autoAnswer ?? null,
        role: opts.role ?? null,
      }),
      Async: 'true',
    });
  }
}
