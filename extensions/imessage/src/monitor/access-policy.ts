import {
  mergeDmAllowFromSources,
  resolveGroupAllowFromSources,
} from "openclaw/plugin-sdk/allow-from";
import {
  createChannelIngressPluginId,
  createChannelIngressSubject,
  decideChannelIngress,
  resolveChannelIngressState,
  type ChannelIngressAdapter,
  type ChannelIngressDecision,
  type ChannelIngressIdentifierKind,
  type IngressReasonCode,
} from "openclaw/plugin-sdk/channel-ingress";
import type { DmPolicy, GroupPolicy, OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { normalizeIMessageHandle, parseIMessageAllowTarget } from "../targets.js";

type IMessageAccessDecision = "allow" | "block" | "pairing";

const IMESSAGE_CHANNEL_ID = createChannelIngressPluginId("imessage");
const IMESSAGE_CHAT_ID_KIND = "plugin:imessage-chat-id" as ChannelIngressIdentifierKind;
const IMESSAGE_CHAT_GUID_KIND = "plugin:imessage-chat-guid" as ChannelIngressIdentifierKind;
const IMESSAGE_CHAT_IDENTIFIER_KIND =
  "plugin:imessage-chat-identifier" as ChannelIngressIdentifierKind;

function entryId(index: number): string {
  return `imessage-entry-${index + 1}`;
}

function normalizeIMessageIngressEntry(entry: string): {
  kind: ChannelIngressIdentifierKind;
  value: string;
} | null {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === "*") {
    return { kind: "stable-id", value: "*" };
  }
  const parsed = parseIMessageAllowTarget(trimmed);
  if (parsed.kind === "chat_id") {
    return { kind: IMESSAGE_CHAT_ID_KIND, value: String(parsed.chatId) };
  }
  if (parsed.kind === "chat_guid") {
    return { kind: IMESSAGE_CHAT_GUID_KIND, value: parsed.chatGuid.trim() };
  }
  if (parsed.kind === "chat_identifier") {
    return {
      kind: IMESSAGE_CHAT_IDENTIFIER_KIND,
      value: parsed.chatIdentifier.trim(),
    };
  }
  const handle = normalizeIMessageHandle(parsed.handle);
  return handle ? { kind: "stable-id", value: handle } : null;
}

const imessageIngressAdapter: ChannelIngressAdapter = {
  normalizeEntries({ entries }) {
    return {
      matchable: entries.flatMap((entry, index) => {
        const normalized = normalizeIMessageIngressEntry(entry);
        return normalized
          ? [
              {
                opaqueEntryId: entryId(index),
                kind: normalized.kind,
                value: normalized.value,
                sensitivity: "pii" as const,
              },
            ]
          : [];
      }),
      invalid: [],
      disabled: [],
    };
  },
  matchSubject({ subject, entries }) {
    const byKind = new Map<ChannelIngressIdentifierKind, Set<string>>();
    for (const identifier of subject.identifiers) {
      const normalized =
        identifier.kind === "stable-id"
          ? normalizeIMessageHandle(identifier.value)
          : identifier.value.trim();
      if (!normalized) {
        continue;
      }
      const values = byKind.get(identifier.kind) ?? new Set<string>();
      values.add(normalized);
      byKind.set(identifier.kind, values);
    }
    const matchedEntryIds = entries
      .filter((entry) => {
        if (entry.value === "*") {
          return true;
        }
        return byKind.get(entry.kind)?.has(entry.value) === true;
      })
      .map((entry) => entry.opaqueEntryId);
    return {
      matched: matchedEntryIds.length > 0,
      matchedEntryIds,
    };
  },
};

function normalizeDmPolicy(policy: string): DmPolicy {
  return policy === "open" || policy === "allowlist" || policy === "disabled" ? policy : "pairing";
}

function normalizeGroupPolicy(policy: string): GroupPolicy {
  return policy === "open" || policy === "disabled" ? policy : "allowlist";
}

function findSenderGateReason(
  decision: ChannelIngressDecision,
  isGroup: boolean,
): IngressReasonCode {
  return (
    decision.graph.gates.find((gate) => gate.kind === (isGroup ? "groupSender" : "dmSender"))
      ?.reasonCode ?? decision.reasonCode
  );
}

function accessDecisionFromIngress(decision: ChannelIngressDecision): IMessageAccessDecision {
  if (decision.decision === "allow") {
    return "allow";
  }
  return decision.admission === "pairing-required" ? "pairing" : "block";
}

function commandAuthorizedFromIngress(decision: ChannelIngressDecision): boolean {
  return decision.graph.gates.find((gate) => gate.kind === "command")?.allowed === true;
}

function subjectIdentifiers(params: {
  sender: string;
  chatId?: number;
  chatGuid?: string;
  chatIdentifier?: string;
}) {
  return [
    {
      opaqueId: "imessage-sender",
      value: params.sender,
      sensitivity: "pii" as const,
    },
    ...(params.chatId != null
      ? [
          {
            opaqueId: "imessage-chat-id",
            kind: IMESSAGE_CHAT_ID_KIND,
            value: String(params.chatId),
            sensitivity: "pii" as const,
          },
        ]
      : []),
    ...(params.chatGuid
      ? [
          {
            opaqueId: "imessage-chat-guid",
            kind: IMESSAGE_CHAT_GUID_KIND,
            value: params.chatGuid,
            sensitivity: "pii" as const,
          },
        ]
      : []),
    ...(params.chatIdentifier
      ? [
          {
            opaqueId: "imessage-chat-identifier",
            kind: IMESSAGE_CHAT_IDENTIFIER_KIND,
            value: params.chatIdentifier,
            sensitivity: "pii" as const,
          },
        ]
      : []),
  ];
}

function reasonFromIngress(params: {
  reasonCode: IngressReasonCode;
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  isGroup: boolean;
}): string {
  switch (params.reasonCode) {
    case "group_policy_disabled":
      return "groupPolicy=disabled";
    case "group_policy_empty_allowlist":
      return "groupPolicy=allowlist (empty allowlist)";
    case "group_policy_allowed":
    case "group_policy_open":
      return `groupPolicy=${params.groupPolicy}`;
    case "dm_policy_disabled":
      return "dmPolicy=disabled";
    case "dm_policy_pairing_required":
      return "dmPolicy=pairing (not allowlisted)";
    case "dm_policy_allowlisted":
    case "dm_policy_open":
      return `dmPolicy=${params.dmPolicy}`;
    default:
      return params.isGroup
        ? "groupPolicy=allowlist (not allowlisted)"
        : `dmPolicy=${params.dmPolicy} (not allowlisted)`;
  }
}

export async function resolveIMessageIngressAccess(params: {
  cfg: OpenClawConfig;
  accountId: string;
  isGroup: boolean;
  sender: string;
  chatId?: number;
  chatGuid?: string;
  chatIdentifier?: string;
  allowFrom: string[];
  groupAllowFrom: string[];
  storeAllowFrom: string[];
  dmPolicy: string;
  groupPolicy: string;
  hasControlCommand: boolean;
}): Promise<{
  ingress: ChannelIngressDecision;
  decision: IMessageAccessDecision;
  reasonCode: IngressReasonCode;
  reason: string;
  commandAuthorized: boolean;
  shouldBlockControlCommand: boolean;
  effectiveDmAllowFrom: string[];
  effectiveGroupAllowFrom: string[];
}> {
  const dmPolicy = normalizeDmPolicy(params.dmPolicy);
  const groupPolicy = normalizeGroupPolicy(params.groupPolicy);
  const effectiveDmAllowFrom = mergeDmAllowFromSources({
    allowFrom: params.allowFrom,
    storeAllowFrom: params.storeAllowFrom,
    dmPolicy,
  });
  const effectiveGroupAllowFrom = resolveGroupAllowFromSources({
    allowFrom: params.allowFrom,
    groupAllowFrom: params.groupAllowFrom,
    fallbackToAllowFrom: false,
  });
  const state = await resolveChannelIngressState({
    channelId: IMESSAGE_CHANNEL_ID,
    accountId: params.accountId,
    subject: createChannelIngressSubject({
      identifiers: subjectIdentifiers({
        sender: params.sender,
        chatId: params.chatId,
        chatGuid: params.chatGuid,
        chatIdentifier: params.chatIdentifier,
      }),
    }),
    conversation: {
      kind: params.isGroup ? "group" : "direct",
      id: params.isGroup
        ? String(params.chatId ?? params.chatGuid ?? params.chatIdentifier ?? "unknown")
        : normalizeIMessageHandle(params.sender),
    },
    adapter: imessageIngressAdapter,
    accessGroups: params.cfg.accessGroups,
    event: {
      kind: "message",
      authMode: "inbound",
      mayPair: !params.isGroup,
    },
    allowlists: {
      dm: params.allowFrom,
      group: params.groupAllowFrom,
      pairingStore: params.isGroup ? [] : params.storeAllowFrom,
      commandOwner: params.isGroup ? params.allowFrom : effectiveDmAllowFrom,
      commandGroup: effectiveGroupAllowFrom,
    },
  });
  const ingress = decideChannelIngress(state, {
    dmPolicy,
    groupPolicy,
    groupAllowFromFallbackToAllowFrom: false,
    command: {
      useAccessGroups: params.cfg.commands?.useAccessGroups !== false,
      allowTextCommands: false,
      hasControlCommand: params.hasControlCommand,
      modeWhenAccessGroupsOff: "allow",
    },
  });
  const reasonCode = findSenderGateReason(ingress, params.isGroup);
  const commandAuthorized = commandAuthorizedFromIngress(ingress);
  return {
    ingress,
    decision: accessDecisionFromIngress(ingress),
    reasonCode,
    reason: reasonFromIngress({
      reasonCode,
      dmPolicy,
      groupPolicy,
      isGroup: params.isGroup,
    }),
    commandAuthorized,
    shouldBlockControlCommand: params.isGroup && params.hasControlCommand && !commandAuthorized,
    effectiveDmAllowFrom,
    effectiveGroupAllowFrom,
  };
}
