import {
  decideChannelIngress,
  mapChannelIngressDecisionToTurnAdmission,
  projectIngressAccessFacts,
  resolveChannelIngressState as resolveChannelIngressStateInternal,
} from "../channels/message-access/index.js";
import type {
  ChannelIngressIdentifierKind,
  ChannelIngressPluginId,
  ChannelIngressState,
  ChannelIngressStateInput as MessageAccessChannelIngressStateInput,
  InternalChannelIngressAdapter,
  InternalChannelIngressNormalizeResult,
  InternalChannelIngressSubject,
  InternalMatchMaterial,
  InternalNormalizedEntry,
} from "../channels/message-access/index.js";
import { normalizeStringEntries } from "../shared/string-normalization.js";

export {
  decideChannelIngress,
  mapChannelIngressDecisionToTurnAdmission,
  projectIngressAccessFacts,
};
export type {
  AccessGraph,
  AccessGraphGate,
  AccessGroupMembershipFact,
  ChannelIngressAdmission,
  ChannelIngressChannelId,
  ChannelIngressDecision,
  ChannelIngressEventInput,
  ChannelIngressIdentifierKind,
  ChannelIngressNormalizedEntry,
  ChannelIngressPluginId,
  ChannelIngressPolicyInput,
  ChannelIngressSideEffectResult,
  ChannelIngressState,
  IngressGateEffect,
  IngressGateKind,
  IngressGatePhase,
  IngressReasonCode,
  MatchableIdentifier,
  RedactedChannelIngressEvent,
  RedactedIngressAllowlistFacts,
  RedactedIngressDiagnostics,
  RedactedIngressEntryDiagnostic,
  RedactedIngressMatch,
  ResolvedIngressAllowlist,
  ResolvedRouteGateFacts,
  RouteGateFacts,
  RouteGateState,
  RouteSenderPolicy,
} from "../channels/message-access/index.js";

export type ChannelIngressSubjectIdentifier = InternalMatchMaterial;
export type ChannelIngressSubject = InternalChannelIngressSubject;
export type ChannelIngressAdapterEntry = InternalNormalizedEntry;
export type ChannelIngressAdapterNormalizeResult = InternalChannelIngressNormalizeResult;
export type ChannelIngressAdapter = InternalChannelIngressAdapter;
export type ChannelIngressStateInput = MessageAccessChannelIngressStateInput;

export type ChannelIngressSubjectIdentifierInput = {
  value: string;
  opaqueId?: string;
  kind?: ChannelIngressIdentifierKind;
  dangerous?: boolean;
  sensitivity?: "normal" | "pii";
};

export type CreateChannelIngressStringAdapterParams = {
  kind?: ChannelIngressIdentifierKind;
  normalizeEntry?: (value: string) => string | null | undefined;
  normalizeSubject?: (value: string) => string | null | undefined;
  isWildcardEntry?: (value: string) => boolean;
  resolveEntryId?: (params: { entry: string; index: number }) => string;
  dangerous?: boolean | ((entry: string) => boolean);
  sensitivity?: "normal" | "pii";
};

function defaultNormalize(value: string): string {
  return value;
}

function normalizeMatchValue(
  value: string,
  normalize: (value: string) => string | null | undefined,
): string | null {
  const normalized = normalize(value);
  return normalized == null ? null : normalized.trim() || null;
}

function resolveDangerous(
  dangerous: CreateChannelIngressStringAdapterParams["dangerous"],
  entry: string,
): boolean | undefined {
  return typeof dangerous === "function" ? dangerous(entry) : dangerous;
}

export function createChannelIngressPluginId(id: string): ChannelIngressPluginId {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error("Channel ingress plugin id must be non-empty.");
  }
  return trimmed as ChannelIngressPluginId;
}

export function createChannelIngressSubject(
  input:
    | ChannelIngressSubjectIdentifierInput
    | { identifiers: readonly ChannelIngressSubjectIdentifierInput[] },
): ChannelIngressSubject {
  const identifiers = "identifiers" in input ? input.identifiers : [input];
  return {
    identifiers: identifiers.map((identifier, index) => ({
      opaqueId: identifier.opaqueId ?? `subject-${index + 1}`,
      kind: identifier.kind ?? "stable-id",
      value: identifier.value,
      dangerous: identifier.dangerous,
      sensitivity: identifier.sensitivity,
    })),
  };
}

export function createChannelIngressStringAdapter(
  params: CreateChannelIngressStringAdapterParams = {},
): ChannelIngressAdapter {
  const kind = params.kind ?? "stable-id";
  const normalizeEntry = params.normalizeEntry ?? defaultNormalize;
  const normalizeSubject = params.normalizeSubject ?? normalizeEntry;
  const isWildcardEntry = params.isWildcardEntry ?? ((entry: string) => entry === "*");
  return {
    normalizeEntries({ entries }) {
      const matchable = normalizeStringEntries(entries).flatMap((entry, index) => {
        const value = isWildcardEntry(entry) ? "*" : normalizeMatchValue(entry, normalizeEntry);
        if (!value) {
          return [];
        }
        return [
          {
            opaqueEntryId: params.resolveEntryId?.({ entry, index }) ?? `entry-${index + 1}`,
            kind,
            value,
            dangerous: resolveDangerous(params.dangerous, entry),
            sensitivity: params.sensitivity,
          },
        ];
      });
      return {
        matchable,
        invalid: [],
        disabled: [],
      };
    },
    matchSubject({ subject, entries }) {
      const values = new Set(
        subject.identifiers.flatMap((identifier) => {
          if (identifier.kind !== kind) {
            return [];
          }
          const value = normalizeMatchValue(identifier.value, normalizeSubject);
          return value ? [value] : [];
        }),
      );
      const matchedEntryIds = entries
        .filter((entry) => entry.kind === kind && (entry.value === "*" || values.has(entry.value)))
        .map((entry) => entry.opaqueEntryId);
      return {
        matched: matchedEntryIds.length > 0,
        matchedEntryIds,
      };
    },
  };
}

export async function resolveChannelIngressState(
  input: ChannelIngressStateInput,
): Promise<ChannelIngressState> {
  return await resolveChannelIngressStateInternal(input);
}
