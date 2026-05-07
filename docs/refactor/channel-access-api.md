---
summary: "Internal channel ingress API types, redaction rules, and projection contracts."
read_when:
  - Editing src/channels/message-access
  - Changing channel ingress adapter, state, decision, or projection types
  - Reviewing channel access redaction boundaries
title: "Channel ingress API"
sidebarTitle: "Channel ingress API"
---

# Channel ingress API

This page owns the detailed type shape for
[Channel ingress access graph](/refactor/channel-access). Keep the public shape
small, the internal state rich, and serialized results redacted.

## API shape

Channel ingress should follow a small-boundary shape:

- small public or experimental facade
- rich internal state and diagnostics
- explicit adapter boundary for caller-owned facts
- validated public projection
- no raw internal match material in serialized results

Do not make the first SDK surface mirror every bundled plugin exception. Keep
the internal graph expressive, and expose only the pieces proven by production
canaries.

`openclaw/plugin-sdk/channel-ingress` exists as an experimental canary facade.
Treat the shapes below as the stabilization target. Do not make compatibility
with one bundled plugin quirk a stable public contract until a second plugin
proves the behavior is shared.

The biggest API risk is encoding every bundled plugin exception in phase one.
Keep the policy API strict and generic. Put unusual behavior in adapter facts,
route-layer facts, plugin-local migration code, or conformance mirrors until a
second plugin proves the behavior is genuinely shared.

## Subjects and entries

Core should not own platform identity kinds such as MXID, Nostr pubkey, Tlon
ship, E.164 number, Slack user id, Discord snowflake, Feishu open id, or future
protocol ids. The plugin normalizes identities into adapter-declared identifier
kinds.

Resolved subject shapes must not contain raw values. Raw values are allowed only
in resolver input and adapter match material:

```ts
type ChannelIngressIdentifierKind =
  | "stable-id"
  | "username"
  | "email"
  | "phone"
  | "role"
  | `plugin:${string}`;

type MatchableIdentifier = {
  opaqueId: string;
  kind: ChannelIngressIdentifierKind;
  dangerous?: boolean;
  sensitivity?: "normal" | "pii";
};

type ChannelIngressNormalizedEntry = {
  opaqueEntryId: string;
  kind: ChannelIngressIdentifierKind;
  dangerous?: boolean;
  sensitivity?: "normal" | "pii";
};

type InternalMatchMaterial = MatchableIdentifier & {
  value: string;
};

type InternalChannelIngressSubject = {
  identifiers: InternalMatchMaterial[];
};

type InternalNormalizedEntry = ChannelIngressNormalizedEntry & {
  value: string;
};
```

Raw matching material belongs only in resolver input and adapter match material.
It must not appear in exported state, logs, diagnostics, snapshots, serialized
decisions, or `AccessFacts`.

Invalid and disabled configured entries may contain PII too. Diagnostics should
use opaque entry ids and stable reason codes, not raw configured strings.

`dangerous` identifiers are mutable or unsafe by default, such as display-name
matching. They match only when policy explicitly enables mutable identifier
matching. Otherwise the decision layer removes their matched entry ids and
records `mutable_identifier_disabled` diagnostics.

## Adapter boundary

Adapters should normalize entries in batches:

```ts
type ChannelIngressNormalizeResult = {
  matchable: ChannelIngressNormalizedEntry[];
  invalid: RedactedIngressEntryDiagnostic[];
  disabled: RedactedIngressEntryDiagnostic[];
};

type InternalChannelIngressNormalizeResult = Omit<ChannelIngressNormalizeResult, "matchable"> & {
  matchable: InternalNormalizedEntry[];
};

type InternalChannelIngressAdapter = {
  normalizeEntries(params: {
    entries: readonly string[];
    context: "dm" | "group" | "route" | "command";
    accountId: string;
  }): InternalChannelIngressNormalizeResult | Promise<InternalChannelIngressNormalizeResult>;

  matchSubject(params: {
    subject: InternalChannelIngressSubject;
    entries: readonly InternalNormalizedEntry[];
    context: "dm" | "group" | "route" | "command";
  }): RedactedIngressMatch | Promise<RedactedIngressMatch>;
};
```

One configured entry may expand to several canonical forms, disabled unsafe
fallbacks, or invalid diagnostics. `matchSubject(...)` receives normalized
internal entries only; it should never parse raw config strings.

## Allowlist state

Ingress needs structured allowlist state beside the existing array API:

```ts
type ResolvedIngressAllowlist = {
  rawEntryCount: number;
  normalizedEntries: ChannelIngressNormalizedEntry[];
  invalidEntries: RedactedIngressEntryDiagnostic[];
  disabledEntries: RedactedIngressEntryDiagnostic[];
  matchedEntryIds: string[];
  hasConfiguredEntries: boolean;
  hasMatchableEntries: boolean;
  hasWildcard: boolean;
  accessGroups: {
    referenced: string[];
    matched: string[];
    missing: string[];
    unsupported: string[];
    failed: string[];
  };
  match: RedactedIngressMatch;
};
```

`expandAllowFromWithAccessGroups(...)` remains a compatibility wrapper. New
ingress code should not build on its returned array because it hides missing and
failed groups and replaces provenance with synthetic sender entries.

The structured resolver accepts selected slices, not `OpenClawConfig`.
Access-group dynamic membership is precomputed by the caller and passed as
facts. The core resolver must not receive platform clients, stores, or a
membership hook that can fetch remote state.

```ts
type AccessGroupMembershipFact =
  | {
      kind: "matched";
      groupName: string;
      source: "static" | "dynamic";
      matchedEntryIds: string[];
    }
  | {
      kind: "not-matched";
      groupName: string;
      source: "static" | "dynamic";
    }
  | {
      kind: "missing" | "unsupported" | "failed";
      groupName: string;
      source: "static" | "dynamic";
      reasonCode: IngressReasonCode;
      diagnosticId?: string;
    };
```

Missing, unsupported, and failed facts are never matches. They become the
decisive failure reason only when that gate has no other valid matching entry.

The caller reads pairing store and passes pairing entries into state input. The
core resolver should not also accept a hook that reads pairing store. A
convenience wrapper may perform that read before calling the deterministic
resolver.

## State input

The stable API target should not accept a plain channel string. Bundled plugins
use typed `ChatChannelId`; third-party plugins use a branded plugin id. Do not
use the current `ChannelId` alias here because it includes the compatibility
escape hatch `(string & {})`.

```ts
declare const CHANNEL_INGRESS_PLUGIN_ID: unique symbol;

type ChannelIngressPluginId = string & {
  readonly [CHANNEL_INGRESS_PLUGIN_ID]: true;
};

type ChannelIngressChannelId = ChatChannelId | ChannelIngressPluginId;

type RouteGateState = "not-configured" | "matched" | "not-matched" | "disabled" | "lookup-failed";

type RouteSenderPolicy = "inherit" | "replace" | "deny-when-empty";

type RouteGateFacts = {
  id: string;
  kind: "route" | "routeSender" | "membership" | "ownerAllowlist" | "nestedAllowlist";
  gate: RouteGateState;
  effect: "allow" | "block-dispatch" | "ignore";
  precedence: number;
  senderPolicy: RouteSenderPolicy;
  senderAllowFrom?: Array<string | number>;
  match?: RedactedIngressMatch;
};

type ResolvedRouteGateFacts = Omit<RouteGateFacts, "senderAllowFrom"> & {
  senderAllowlist?: ResolvedIngressAllowlist;
};

type ChannelIngressEventInput = {
  kind:
    | "message"
    | "reaction"
    | "button"
    | "postback"
    | "native-command"
    | "slash-command"
    | "system";
  authMode: "inbound" | "command" | "origin-subject" | "route-only" | "none";
  mayPair: boolean;
  originSubject?: InternalChannelIngressSubject;
};

type RedactedChannelIngressEvent = Omit<ChannelIngressEventInput, "originSubject"> & {
  hasOriginSubject: boolean;
  originSubjectMatched: boolean;
};

type ChannelIngressStateInput = {
  channelId: ChannelIngressChannelId;
  accountId: string;
  subject: InternalChannelIngressSubject;
  conversation: {
    kind: "direct" | "group" | "channel";
    id: string;
    parentId?: string;
    threadId?: string;
    title?: string;
  };
  adapter: InternalChannelIngressAdapter;
  accessGroups?: Record<string, AccessGroupConfig>;
  accessGroupMembership?: readonly AccessGroupMembershipFact[];
  routeFacts?: RouteGateFacts[];
  mentionFacts?: InboundMentionFacts;
  event: ChannelIngressEventInput;
  allowlists: {
    dm?: Array<string | number>;
    group?: Array<string | number>;
    commandOwner?: Array<string | number>;
    commandGroup?: Array<string | number>;
    pairingStore?: Array<string | number>;
  };
};
```

Resolved state stores `RedactedChannelIngressEvent`, not
`ChannelIngressEventInput`. Origin matching is reduced to booleans during state
resolution so serialized state and decisions never retain the raw origin
subject.

Resolved state stores `ResolvedRouteGateFacts`, not raw `RouteGateFacts`.
Route `senderAllowFrom` is resolved into `senderAllowlist` during state
resolution so raw route sender entries never appear in serialized state or
decisions.

Route facts should provide `gate`, `effect`, `precedence`, and `senderPolicy`
explicitly. Security-sensitive defaults should not hide behind optional
booleans.

`senderPolicy` covers route-heavy behavior:

- `inherit`: route sender entries augment ordinary group sender rules
- `replace`: route sender entries replace ordinary group sender rules
- `deny-when-empty`: a matched route with no sender entries fails closed

Google Chat and Microsoft Teams need `deny-when-empty` for route-matched empty
sender lists. Telegram topic overrides are closer to `replace`.

## Policy input

Policy input contains historical behavior knobs selected by the plugin. These
are not new public config keys.

```ts
type ChannelIngressPolicyInput = {
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  groupPolicy: "allowlist" | "open" | "disabled";
  groupAllowFromFallbackToAllowFrom?: boolean;
  mutableIdentifierMatching?: "disabled" | "enabled";
  activation?: {
    requireMention: boolean;
    allowTextCommands: boolean;
  };
  command?: {
    useAccessGroups?: boolean;
    allowTextCommands: boolean;
    hasControlCommand: boolean;
    modeWhenAccessGroupsOff?: "allow" | "deny" | "configured";
  };
};
```

`dmPolicy: "open"` should treat wildcard as open-by-policy. Concrete effective
DM allowlist matches may still authorize the sender as allowlisted. Empty-open
behavior must not be part of the stable policy API. QQBot-style empty-open
compatibility belongs in internal conformance mirrors or plugin-local migration
code only.

`groupAllowFromFallbackToAllowFrom` is decision-time policy. State resolution
keeps explicit group allowlists separate from DM allowlists so plugins must opt
in before group sender gates can fall back to ordinary `allowFrom` entries.

## Decision result

Ingress decisions are not turn admissions. Pairing is a policy result. A plugin
maps it to `handled` or `drop` only after attempting the pairing side effect.

```ts
type ChannelIngressAdmission = "dispatch" | "observe" | "skip" | "drop" | "pairing-required";

type ChannelIngressDecision = {
  admission: ChannelIngressAdmission;
  decision: "allow" | "block" | "pairing";
  decisiveGateId: string;
  reasonCode: IngressReasonCode;
  graph: AccessGraph;
  diagnostics: RedactedIngressDiagnostics;
};

type ChannelIngressSideEffectResult =
  | { kind: "none" }
  | { kind: "pairing-reply-sent" }
  | { kind: "pairing-reply-failed"; errorCode?: string }
  | { kind: "command-reply-sent" }
  | { kind: "command-reply-failed"; errorCode?: string }
  | { kind: "pending-history-recorded" }
  | { kind: "local-event-handled" };
```

`handled` is not a resolver result. It means a side effect already happened,
such as a pairing reply, native command response, or local-only event
acknowledgement.

`skip` means the event was authorized enough to inspect but did not activate a
turn. Plugins may record pending history for later context, then map the result
to `handled`. If no side effect is needed, `skip` maps to `drop`.

`observe` is reserved for paths that intentionally run a turn with observe-only
delivery. Do not use it to model ordinary group mention misses.

## AccessFacts projection

`projectIngressAccessFacts(...)` must project final facts. The turn context
builder should not recompute authorization.

The first required fix was command projection. `AccessFacts.commands` now
carries the final authorization boolean. Older turn context code derived
`CommandAuthorized` from `commands.authorizers.some(entry.allowed)`, which loses
configured state, access-group mode, command text policy, and control-command
blocking semantics.

Command facts include:

```ts
type ProjectedCommandAccessFacts = {
  authorized: boolean;
  shouldBlockControlCommand: boolean;
  reasonCode: IngressReasonCode;
  useAccessGroups: boolean;
  allowTextCommands: boolean;
  modeWhenAccessGroupsOff?: "allow" | "deny" | "configured";
};
```

Keep a temporary compatibility helper for old callers that only provide
authorizer arrays. New command code should read `authorized`, not recompute it.

Projected allowlist facts should be redacted:

```ts
type ProjectedAllowlistAccessFacts = {
  configured: boolean;
  matched: boolean;
  reasonCode: IngressReasonCode;
  matchedEntryIds: string[];
  invalidEntryCount: number;
  disabledEntryCount: number;
  accessGroups: {
    referenced: string[];
    matched: string[];
    missing: string[];
    unsupported: string[];
    failed: string[];
  };
};
```

Long-term `AccessFacts` should not include `dm.allowFrom`, `group.allowFrom`, or
any other raw configured entries. Temporary adapters may populate legacy fields
only for old callers and must not serialize new ingress decisions with raw
allowlist material.

Projection should also include:

- DM decision, reason, and redacted allowlist diagnostics
- group policy, route allowed, sender allowed, and redacted group diagnostics
- final command authorization and command blocking state
- event authorization mode and result
- mention facts and activation result, including whether mention was required
