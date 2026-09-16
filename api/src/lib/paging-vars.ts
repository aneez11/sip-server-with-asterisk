import { sanitizeCallerId } from './caller-id.js';

export interface AutoAnswerProfileInput {
  alertInfo?: string | null;
  callInfo?: string | null;
  sipUri?: string | null;
  dTime?: number | null;
}

export interface MemberVarsInput {
  pageMembers: string;
  logId: number;
  pageConf: string;
  title: string;
  volume?: number | null;
  autoAnswer?: AutoAnswerProfileInput | null;
  /** ConfBridge user role for the member (default paging_user; PA uses paging_pa_user). */
  role?: string | null;
}

/**
 * Builds the AMI Originate `Variable` string for the member leg
 * (Local/9000@paging or Local/9001@music).
 *
 * `_PAGE_CONF` must be a shared (underscore) variable so it propagates through
 * Dial() to the called PJSIP channel, where the U() paging-join Gosub reads it
 * to join the conference. Default auto-answer headers (Alert-Info / Call-Info)
 * are sent on every page; per-zone profile values override them. Building them
 * as variables here (instead of literals in the dialplan) keeps values like
 * `Call-Info: <sip:x>;answer-after=0` intact — a literal `;` in the dialplan is
 * parsed as a comment and truncates the header.
 */
export function buildMemberVars(v: MemberVarsInput): string {
  const parts: string[] = [
    `PAGE_MEMBERS=${v.pageMembers}`,
    `BROADCAST_LOG_ID=${v.logId}`,
    `_PAGE_CONF=${v.pageConf}`,
    `PAGE_TITLE=${sanitizeCallerId(v.title)}`,
    `_ALERTINFO=${v.autoAnswer?.alertInfo ?? 'Auto Answer'}`,
    `_CALLINFO=${v.autoAnswer?.callInfo ?? '<sip:autoanswer>;answer-after=0'}`,
  ];
  if (v.autoAnswer?.sipUri) parts.push(`_SIPURI=${v.autoAnswer.sipUri}`);
  if (v.autoAnswer?.dTime != null) parts.push(`_DTIME=${v.autoAnswer.dTime}`);
  if (v.volume != null) parts.push(`PVOL=${v.volume}`);
  if (v.role) parts.push(`_PAGE_ROLE=${v.role}`);
  return parts.join(',');
}
