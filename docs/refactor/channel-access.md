---
summary: "Refactor plan for sharing message-channel ingress policy while keeping platform facts and side effects plugin-owned."
read_when:
  - Refactoring message-channel ingress authorization, route gates, or mention gates
  - Changing dmPolicy, groupPolicy, allowFrom, groupAllowFrom, access groups, or pairing behavior
  - Migrating channel plugins onto shared message and turn lifecycle
  - Designing shared channel ingress helpers for bundled or third-party plugins
title: "Channel ingress access graph"
sidebarTitle: "Channel ingress"
---

# Channel ingress access graph

Message plugins already share most downstream behavior. The message lifecycle
owns durable sends, receipts, acknowledgement policy, live preview finalization,
and delivery contracts. The turn kernel owns normalized admission, context
construction, dispatch, session recording, reply delivery, and finalization.

The repeated part is upstream ingress authorization. Plugins still build local
decision trees before a turn reaches the kernel:

- DM policy and pairing-store allowlists
- group policy and group sender allowlists
- route, room, topic, channel, guild, thread, and nested room gates
- command authorization
- event authorization for reactions, buttons, slash commands, native commands,
  and postbacks
- mention or activation gating
- `AccessFacts` projection for downstream context

The right destination is not one flattened authorization resolver. The target is
one internal ingress algebra over plugin-supplied facts. Plugins keep platform
lookup and side effects. Core evaluates reusable gates, builds a structured
graph, composes a stable decision, and projects final access facts into the turn
context.

Detailed type shapes live in [Channel ingress API](/refactor/channel-access-api).
Migration sequencing lives in
[Channel ingress migration](/refactor/channel-access-migration).

## Decision status

No product or public API decision is pending for this slice. The clean path is
to keep the current facade experimental while completing the remaining rich
channel migrations and reuse consumers.

Fixed decisions:

- Core receives selected policy slices and caller-provided dynamic facts, not
  whole `OpenClawConfig`, stores, platform clients, or network hooks.
- Plugins own platform identity normalization, raw matching material, route
  lookup, membership lookup, pairing writes, replies, history, media, typing,
  and reactions.
- Pairing-store entries can authorize DM sender access only.
- Route access, sender access, command authorization, event authorization, and
  activation are separate gates with separate reason codes.
- Raw sender, route, origin-subject, and configured allowlist values stay out of
  resolved state, serialized decisions, diagnostics, snapshots, and
  `AccessFacts`.
- Mutable identifiers, such as display-name matching, match only when policy
  explicitly enables them.
- Mention misses use activation `skip`. They do not become observe-only turns.

Implementation choices still open:

- SDK stabilization timing. Keep `openclaw/plugin-sdk/channel-ingress`
  experimental until more rich route and command plugins prove the same shape
  without bundled plugin branches in core.
- Reuse consumers. Doctor, approval auth, and outbound target auth should reuse
  the same policy metadata after inbound, command, event, projection, and route
  parity are proven.

## Code reality

Current shared helpers are useful, but they do not produce one structured state:

- `src/channels/message` already provides transport-neutral send and receive
  contracts.
- `src/channels/turn` already accepts `dispatch`, `observeOnly`, `handled`, and
  `drop` admissions. Ingress should map into that contract rather than replace
  it.
- `src/security/dm-policy-shared.ts` evaluates common DM and group policy after
  callers flatten allowlists. It preserves the invariant that pairing-store
  entries affect DM access only.
- `src/plugin-sdk/group-access.ts` has route and sender evaluators, but route
  layers and sender allowlists are still composed plugin by plugin.
- `src/plugin-sdk/access-groups.ts` now has structured access-group state beside
  the compatibility array expansion path.
- `src/plugin-sdk/command-auth.ts` centralizes command authorization, but older
  callers still project authorizer arrays instead of final command decisions.
- `src/channels/message-access` is the internal kernel slice. The experimental
  `openclaw/plugin-sdk/channel-ingress` facade exposes only the narrow canary
  surface needed by migrated channel runtime paths.

Representative plugin paths show why the graph needs ordered gates:

| Plugin          | Current ingress shape                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Signal          | shared DM/group sender and command auth; pairing, quotes, group ids, and media stay local                        |
| WhatsApp        | shared DM/group sender and command auth canary; target auth and mention activation stay local                    |
| Nextcloud Talk  | shared DM/group sender and command auth canary; room allowlists, pairing replies, and mention gates stay local   |
| Mattermost      | shared sender, reaction, and command auth; channel lookup, pairing replies, and mention side effects stay local  |
| Google Chat     | space route gate, sender gate, mention activation, route-matched empty sender lists that fail closed             |
| Microsoft Teams | shared sender/reaction and command auth; route gate, route sender policy, empty sender lists fail closed         |
| Matrix          | shared access-state and command auth; room allowlists, live refresh, reaction paths must not pair                |
| Slack           | shared system/interactive auth and command-gate canary; Slack channel lookup and mention side effects stay local |
| Discord         | shared DM, reaction, and text command canaries; guild, group-DM, route, and mention gates stay local             |
| Telegram        | shared DM, command, and event auth canaries; topic routes and activation stay local                              |
| Zalo            | shared DM/group sender and command auth canary; pairing replies and media handling stay local                    |
| Zalo Personal   | shared DM/group sender canary; route allowlists, name resolution, command auth, and pairing stay local           |
| LINE            | shared DM/group sender and command auth canary; webhook, pairing, media, and mention activation stay local       |
| iMessage        | shared DM/group sender and command auth canary; `imessage.groups`, pairing replies, echo, and media stay local   |
| BlueBubbles     | shared DM/group sender and command auth canary; webhooks, pairing, reactions, echo, and media stay local         |
| IRC             | shared text command auth canary; channel gates, sender access, pairing, and mention gating stay local            |

This is enough evidence to extract shared policy math, but not enough to publish
a stable SDK surface first.

## Fixed design

The phase-one design is fixed:

- Stable ingress APIs use `ChatChannelId | ChannelIngressPluginId`, not
  `ChannelId`, because `ChannelId` intentionally accepts arbitrary plugin
  strings today.
- Dynamic platform membership is caller-owned. Core receives precomputed
  access-group membership facts, not `OpenClawConfig`, stores, or platform API
  hooks.
- Missing, unsupported, or failed access-group references are gate-local
  non-matches with diagnostics. The gate fails closed only when no other valid
  entry in that gate matches.
- Activation `skip` is distinct from turn-kernel `observeOnly`. Mention-miss
  parity uses `skip`, not observe-only dispatch.
- Projected `AccessFacts` contain decisions, counts, reason codes, and opaque
  ids only. Raw configured entries and raw match values stay out of new
  projections.

## Owner boundary

Core owns generic policy semantics:

- structured access-group resolution
- allowlist state and provenance
- effective DM allowlist composition from config and caller-provided
  pairing-store entries
- effective group sender allowlist composition from selected config slices
- `dmPolicy` and `groupPolicy` evaluation
- route gate composition over plugin-provided route facts
- command and event authorization from resolved state
- stable reason codes
- redacted diagnostics
- `AccessFacts` projection
- conformance fixtures for bundled and third-party plugins
- doctor metadata that mirrors runtime policy

Plugins own platform facts and side effects:

- webhook signatures, app tokens, replay protection, rate limits, and upstream
  API authentication
- account config lookup
- sender, conversation, thread, route, room, topic, guild, channel, or space
  lookup
- platform-specific allowlist entry normalization and subject matching
- dynamic platform membership APIs
- pairing challenge delivery and pairing-store writes
- mention extraction facts
- channel-specific activation signals
- history fetches, quote expansion, media downloads, cite expansion, typing, and
  reaction side effects after access allows them
- channel-specific logging copy and user-visible text

Core must not learn bundled plugin route schemas or raw platform identifiers.
Plugins supply normalized facts. Core evaluates the reusable graph.

## Target pipeline

```text
plugin transport event
  -> plugin verifies webhook, token, replay, rate limit, and upstream auth
  -> plugin extracts cheap sender, conversation, route, and mention facts
  -> plugin resolves account, route, room, topic, guild, thread, or membership state
  -> plugin reads dynamic state that core must not fetch implicitly
       pairing-store entries
       platform membership results
       access-group dynamic membership, if needed
  -> plugin passes selected policy slices, membership facts, and platform facts
  -> core resolves structured allowlist state
  -> core builds an AccessGraph
  -> core composes a ChannelIngressDecision
  -> plugin performs side effects
       pairing reply
       command reply
       local event acknowledgement
       history, quote, cite, media, typing, or reaction work
  -> plugin maps the decision to ChannelTurnAdmission
  -> turn kernel
  -> message lifecycle
```

The split should be explicit:

```ts
export async function resolveChannelIngressState(
  input: ChannelIngressStateInput,
): Promise<ChannelIngressState>;

export function decideChannelIngress(
  state: ChannelIngressState,
  policy: ChannelIngressPolicyInput,
): ChannelIngressDecision;

export function projectIngressAccessFacts(decision: ChannelIngressDecision): AccessFacts;

export function mapChannelIngressDecisionToTurnAdmission(
  decision: ChannelIngressDecision,
  sideEffect: ChannelIngressSideEffectResult,
): ChannelTurnAdmission;
```

`resolveChannelIngressState(...)` may await adapter normalization or matching if
an adapter implementation needs it. It must not discover config, stores,
network, or platform APIs. Dynamic platform state must already be present in the
input. The decision and projection functions should be pure.

## AccessGraph

The graph is the internal normalized representation of one inbound event.

```ts
type IngressGatePhase = "route" | "sender" | "command" | "event" | "activation";

type IngressGateKind =
  | "route"
  | "routeSender"
  | "dmSender"
  | "groupSender"
  | "membership"
  | "ownerAllowlist"
  | "nestedAllowlist"
  | "command"
  | "event"
  | "mention";

type IngressGateEffect =
  | "allow"
  | "block-dispatch"
  | "block-command"
  | "skip"
  | "observe"
  | "ignore";
```

Route gates are ordered by precedence. Sender, command, event, and activation
remain separate decisions. A route match, sender match, membership match, owner
allowlist match, nested allowlist match, command authorization, event
authorization, and mention activation are different gates with different
provenance.

Core composition rules:

- any route layer with `effect: "block-dispatch"` blocks dispatch
- route access and sender access remain separate gates
- pairing-store entries affect DM sender gates only
- command gates use `block-command` when only the control command is denied
- event gates use explicit event auth mode and explicit `mayPair`
- activation gates never grant sender, route, command, or event authorization
- activation can turn an already-authorized event into `skip` or, only for
  existing observe-only semantics, `observe`

## Event model

Events should reuse the graph without pretending every event is a message.

Rules:

- `message` usually uses inbound auth and may pair in DMs
- `reaction` usually uses inbound or origin-subject auth and must not pair
- `button` and `postback` usually use command, origin-subject, or route-only
  auth
- `native-command` and `slash-command` use command auth and channel-native
  response semantics
- `system` uses none or plugin-specific route-only auth

`origin-subject` means the event actor must match a plugin-provided origin
subject. Core compares normalized subjects during state resolution and stores
only booleans in resolved state.

Only `authMode: "inbound"` requires the ordinary sender gate to authorize the
event. `command`, `origin-subject`, `route-only`, and `none` modes may keep a
sender gate in the graph for diagnostics, but a sender miss is marked ignored
rather than blocking dispatch.

`event.mayPair` must be explicit. Non-message events should fail closed instead
of creating pairing requests by accident.

## Failure modes

The resolver should turn ambiguous or degraded inputs into stable failure
states:

| Scenario                                                 | Expected result                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Dynamic membership lookup failed                         | gate-local non-match with membership lookup failure reason and opaque route diagnostics; gate fails closed if no other valid entry matches |
| Missing access group                                     | gate-local non-match with access-group missing reason and group alias only; gate fails closed if no other valid entry matches              |
| Route matched but sender list empty                      | use route-layer `senderPolicy: "deny-when-empty"`                                                                                          |
| Mutable label configured while mutable matching disabled | put entry in `disabledEntries` and do not match                                                                                            |
| PII match succeeded                                      | allow when policy permits, but diagnostics show only opaque ids and source class                                                           |
| Non-message event would require pairing                  | fail closed when `event.mayPair` is false                                                                                                  |

## Current status

Implemented first:

- `AccessFacts.commands.authorized` is the preferred command authorization
  projection, with legacy authorizer-array fallback.
- `resolveAccessGroupAllowFromState(...)` reports referenced, matched, missing,
  unsupported, and failed access groups while preserving the old flat expansion
  wrapper.
- `src/channels/message-access` contains the internal kernel skeleton for state
  resolution, graph decisions, redacted projection, and admission mapping.
- Resolved state redacts raw sender, route sender allowlist, and origin-subject
  material.
- `projectIngressAccessFacts(...)` projects redacted allowlist diagnostics for
  DM and group sender gates while keeping legacy raw `allowFrom` fields empty.
- `projectIngressAccessFacts(...)` also carries evaluated group policy, event
  auth result, and mention activation metadata into redacted `AccessFacts`.
- Dangerous identifier matches require explicit
  `mutableIdentifierMatching: "enabled"` policy.
- QA Channel, Signal, Zalo, WhatsApp, LINE, Nextcloud Talk, Microsoft Teams,
  Google Chat, Mattermost, Matrix, Slack, Discord, and Telegram now use the experimental SDK facade in
  production paths for shared sender policy decisions. QA Channel is the
  synthetic canary. Signal now shares DM/group sender and command
  authorization while keeping identity normalization, pairing replies, quotes,
  media, and turn construction local. Zalo now shares DM/group sender access
  and command authorization while keeping webhook security, pairing replies,
  media, and turn construction local. WhatsApp now
  shares DM/group sender, pairing-store, access-group, and command
  authorization while keeping group membership allowlists, mention activation,
  pairing replies, media, and outbound target authorization local. LINE now
  shares DM/group sender, pairing-store, access-group, and command
  authorization while keeping webhook replay, pairing replies, media, and
  mention activation local. Nextcloud Talk now shares DM/group sender,
  pairing-store, access-group, command authorization, and room route block
  decisions while keeping room lookup, nested room sender checks, pairing
  replies, and mention activation local. Telegram now
  shares direct message access, text/native command and model-callback command
  authorization, and reaction/button sender event authorization while keeping
  route/topic policy and pairing delivery local. Microsoft Teams now shares
  sender/reaction access and text command authorization while keeping Teams
  route lookup, pairing, thread context, and reaction delivery local. Google
  Chat covers route-heavy canaries for nested route gates and
  `senderPolicy: "deny-when-empty"`. Mattermost now shares command-invocation
  authorization for slash commands, model picker actions, and button
  interactions while keeping message ingress and pairing replies local. Matrix
  is the first rich-route canary using a shared ingress decision from an
  isolated access-state helper and now shares command authorization while
  keeping reactions and room state local. Slack is a partial rich-route canary
  for system and interactive event
  authorization plus regular message and slash command sender and command
  gates; mention history side effects and Slack-specific replies stay local.
  Discord now shares direct-message command access while keeping guild,
  channel, group-DM, membership, owner allowlist, and mention preflight local.
- Access-group diagnostics are documented in [Access groups](/channels/access-groups).

Still intentionally later:

- more plugin migrations
- richer route and command plugin migrations beyond Matrix, Slack, Mattermost,
  Discord, and Telegram partial canaries
- doctor metadata reuse
- stable SDK facade
- approval and target-auth reuse

## Invariants

- Calling ingress resolution means transport auth, signatures, tokens, replay
  checks, and rate limits already succeeded.
- Route denial is represented as `block-dispatch` and always blocks dispatch.
- Route access and sender access remain separate gates.
- Pairing-store entries grant DM access only.
- Pairing-store entries never grant group sender access, route access, command
  access in groups, or event access when `mayPair` is false.
- Pairing challenges are side effects outside the resolver.
- Missing, unsupported, or failed access-group references never match and must
  produce redacted diagnostics. The affected gate fails closed when no other
  valid entry in that gate matches.
- Dangerous identifiers do not match unless policy explicitly enables them.
- PII identifiers may match only inside resolver internals.
- Raw match values exist only in resolver input and adapter match material.
- Serialized decisions, graphs, diagnostics, snapshots, and `AccessFacts` never
  include raw values.
- Command auth consumes resolved ingress state.
- Event auth consumes resolved ingress state.
- Activation gates do not grant authorization.
- Human-readable reason text is diagnostic only. Stable reason codes are the
  contract.
