---
summary: "Migration phases, verification commands, and completion criteria for channel ingress refactoring."
read_when:
  - Planning channel ingress migration order
  - Adding channel ingress conformance fixtures
  - Verifying channel ingress refactor work
title: "Channel ingress migration"
sidebarTitle: "Channel ingress migration"
---

# Channel ingress migration

This page owns sequencing and verification for
[Channel ingress access graph](/refactor/channel-access). API details live in
[Channel ingress API](/refactor/channel-access-api).

## Current decision state

No product or public API decision is pending. The remaining choices are
implementation sequencing and proof depth.

Accepted for this refactor:

- Keep the shared resolver internal and expose only the experimental
  `openclaw/plugin-sdk/channel-ingress` canary facade for migrated production
  paths.
- Keep plugin-specific facts and side effects plugin-owned.
- Require redacted state, redacted diagnostics, and final `AccessFacts`
  projection before migrating more channels.
- Stabilize the SDK surface only after one simple production channel and one
  route-heavy production channel prove the same contract.

Clean implementation order:

- Done: structured access-group state, command fact projection, internal ingress
  kernel, redacted projection, QA Channel canary, Signal canary, Microsoft Teams
  and Google Chat route-heavy canaries, and the Matrix rich-route access-state
  canary, plus Mattermost command-invocation auth and Slack
  system/interactive auth and command-gate preparation, Discord DM command
  access, Telegram DM plus text/native command, model-callback command, and
  event authorization, Zalo DM/group sender plus command authorization, Zalo
  Personal DM/group sender authorization, and WhatsApp, LINE, iMessage,
  BlueBubbles, and Nextcloud Talk inbound DM/group sender plus command
  authorization.
- Next: finish richer route and command plugins beyond Matrix, Mattermost,
  Slack, Discord, and Telegram partial canaries once their route, command, and
  activation shapes are explicit enough to avoid plugin-specific core branches.
- Later: doctor metadata reuse, approval auth reuse, and outbound target-auth
  reuse.

## Phase 0: Parity inventory and fixtures

Create a table of current plugin constants before changing runtime behavior:

- DM policy defaults
- group policy defaults
- `groupAllowFrom` fallback behavior
- open-DM wildcard versus empty-open behavior
- command `modeWhenAccessGroupsOff`
- route layer precedence and effect
- route sender policy
- event auth mode and `mayPair`
- mention activation behavior
- PII and dangerous identifier behavior
- dynamic membership failure behavior

Add conformance fixtures for the current oddities first. QA Channel should be a
first-class synthetic fixture. QQBot and Nostr can mirror the contract without
importing internal SDK code.

Current canary inventory:

- QA Channel: synthetic direct and room messages are open by default; command
  context is authorized; group mention detection is projected but does not
  require activation by default.
- Nostr: direct DMs default to `dmPolicy: "pairing"`; sender authorization runs
  before decrypt; events may pair only on message DMs; pubkey allowlists are
  plugin-normalized and redacted.
- QQBot: legacy empty or wildcard `allowFrom` means open; concrete `allowFrom`
  locks down DM and group; group allowlists fall back to `allowFrom`; mention is
  required by default.

## Phase 1: Structured access groups

Status: done for the current kernel.

The structured access-group API exists beside the compatibility array API and
tracks:

- referenced group names
- matched group names
- missing group names
- unsupported group names
- failed dynamic lookups
- static entries resolved from `message.senders`
- whether the current subject matched through a group
- gate-local failure reasons when referenced groups are missing, unsupported, or
  failed and no other valid entry matched

Keep `expandAllowFromWithAccessGroups(...)` for old callers. New ingress code
consumes structured state.

## Phase 2: Command facts fix

Status: done.

`AccessFacts.commands` and turn context projection now support a final
`authorized` boolean from ingress projection.

Keep compatibility authorizer arrays inside a temporary adapter while old
callers still need them. Do not put migration provenance in the long-term
`AccessFacts` shape.

This landed before plugin migration so the resolver cannot be correct while
downstream context silently changes command semantics.

## Phase 3: Internal ingress kernel

Status: done for the current graph skeleton.

The internal module under `src/channels/message-access` owns:

- allowlist-state resolution
- access-group composition
- pairing-store entry composition from caller-provided entries
- DM and group sender policy evaluation
- route layer composition
- command and event authorization
- activation gate evaluation from plugin mention facts
- stable reason codes
- redacted diagnostics

Do not force bundled plugins to import internal `src/channels` paths. Use tests,
conformance mirrors, or SDK facades depending on the migration phase.

## Phase 4: Projection and serialization proof

Status: done for the current canary surface; extend as new gates are added.

Contract tests cover:

- `resolveChannelIngressState(...)`
- graph construction
- `decideChannelIngress(...)`
- `projectIngressAccessFacts(...)`
- `mapChannelIngressDecisionToTurnAdmission(...)`

Raw `dm.allowFrom` and `group.allowFrom` projections are replaced with redacted
allowlist facts. Keep any compatibility projection isolated from the new
serialized decision fixtures.

Every serialized decision, graph, diagnostic, snapshot, and projected
`AccessFacts` fixture should assert that raw match values are absent.

## Phase 5: Simple canaries and mirrors

Status: in progress.

Migrate or mirror the smallest shapes first:

1. QA Channel fixture and production canary
2. Signal production canary
3. Nostr conformance mirror
4. Zalo production canary
5. WhatsApp production canary

Nostr stays a mirror while pre-decryption guard policy remains plugin-owned.
WhatsApp is useful because it already has target-auth-like behavior, but target
auth should remain local in this phase.

QA Channel is the first production canary for the experimental
`openclaw/plugin-sdk/channel-ingress` facade. It keeps the synthetic transport
and reply side effects local while using shared sender, group, command, event,
activation, projection, and turn-admission policy.

Signal is the first non-synthetic simple channel canary. Its production receive
path keeps Signal-specific identity normalization, group-id matching, quote
visibility, and pairing challenge side effects local while using the shared
ingress facade for DM, group, pairing-store sender, and command authorization
decisions.

Zalo now uses the experimental ingress facade for production DM sender, group
sender, pairing-store sender, access-group, and command authorization. The
plugin still keeps webhook verification, replay/rate-limit handling, pairing
reply delivery, media download/upload, and turn construction local.

Zalo Personal now uses the experimental ingress facade for production DM
sender, group sender, pairing-store sender, and access-group authorization. The
plugin still keeps personal-account listener state, group route allowlists,
mutable startup name resolution, command authorization, pairing replies,
mention activation, delivery acknowledgements, media, history, and turn
construction local.

WhatsApp now uses the experimental ingress facade for production DM sender,
group sender, pairing-store sender, access-group, and command authorization.
The plugin still keeps WhatsApp Web transport state, group membership allowlist
resolution, mention/reply activation, pairing reply delivery, media handling,
and outbound target authorization local.

## Phase 6: Medium plugins

Status: done for the current medium-plugin scope. LINE, iMessage,
BlueBubbles, and Nextcloud Talk are migrated.

LINE now uses the experimental ingress facade for production DM sender, group
sender, pairing-store sender, access-group, and command authorization. The
plugin still keeps webhook replay, pairing reply delivery, media handling,
per-group mention activation, and turn construction local. Per-group
`allowFrom` overrides are folded into the shared group sender gate instead of
being enforced by a separate handler-only branch.

Nextcloud Talk is the nested allowlist canary. It now uses the experimental
ingress facade for production DM sender, group sender, pairing-store sender,
access-group, command authorization, and room route block decisions. The plugin
still keeps room lookup, room allowlist matching, per-room nested sender checks,
pairing reply delivery, mention activation, and turn construction local.

iMessage now uses the experimental ingress facade for production DM sender,
group sender, pairing-store sender, access-group, and command authorization.
The plugin still keeps `imessage.groups` route allowlists, pairing reply
delivery, mention activation, echo/self-chat handling, media, history, and turn
construction local.

BlueBubbles now uses the experimental ingress facade for production webhook DM
sender, group sender, pairing-store sender, access-group, reaction sender, and
command authorization. The plugin still keeps webhook authentication, pairing
reply delivery, mention activation, reaction delivery, echo/self-chat handling,
reply context, media, history, and turn construction local.

## Phase 7: Route-policy canaries

Status: done for the current route-heavy proof.

Migrate route-heavy plugins that prove route sender precedence:

1. Microsoft Teams production sender-access canary
2. Google Chat production sender-access canary

These must prove `senderPolicy: "deny-when-empty"` and separate route and sender
gates.

Microsoft Teams now uses the experimental facade for its production sender
access helper, reaction sender authorization, and text command authorization.
The plugin still keeps Teams-specific route lookup, display-name matching
policy, message logging, pairing side effects, thread context, and reaction
delivery local.

Google Chat now uses the experimental facade for its production inbound access
helper. The plugin still keeps webhook auth, account lookup, mutable space-key
rejection, pairing challenge delivery, mention extraction, command handling,
space logging, and Chat API side effects local.

## Phase 8: Rich route plugins

Status: in progress; Matrix is migrated, Mattermost sender, reaction, and
command auth is migrated, Slack system/interactive event auth plus command-gate
preparation is partially migrated, Discord DM, reaction, and text command access
is partially migrated, and Telegram DM access plus text/native command,
model-callback command, and event authorization are partially migrated. IRC text
command authorization is partially migrated.

Migrate richer route and command plugins after the route-policy canaries:

1. Mattermost
2. Matrix production access-state canary
3. Slack
4. Discord
5. Telegram
6. Feishu
7. IRC

Matrix now resolves its monitor access state through the experimental ingress
facade and uses the shared decision for DM, room-user, group sender, and text
command authorization gates. The plugin still keeps Matrix-specific direct-room
lookup, room allowlist lookup, live allowlist refresh, pairing replies,
reactions, history, media, threads, and mention extraction local.

Mattermost now resolves monitor message sender access, reaction sender access,
native slash commands, model picker actions, button interactions, and text
command authorization through the experimental ingress facade while keeping
Mattermost channel lookup, pairing replies, outgoing command responses, mention
gates, and user-visible denial copy local.

Slack now resolves system and interactive event sender authorization plus regular
message and slash command sender and command gates through the experimental
ingress facade while keeping Slack channel lookup, channel config matching,
expected-sender checks, DM pairing replies, bot-owner-presence checks, mention
skip/history side effects, and user-visible rejection reasons local. Slack is
not a complete rich-route migration yet.

Discord now resolves direct-message access, direct-message reaction sender
access, and non-DM text command authorization through the experimental ingress
facade while keeping guild/channel/group-DM route gates, role and user
membership projection, route state, autocomplete context, pairing responses, and
mention preflight local. Discord is not a complete rich-route migration yet.

Telegram now resolves direct-message access, text/native command authorization,
model-callback command authorization, and reaction/button sender event
authorization through the experimental ingress facade while keeping chat/topic
route context, per-topic `allowFrom` overrides, group policy checks,
`commands.allowFrom` overrides, mention and reply-to-bot activation, and pairing
reply delivery local. Telegram is not a complete rich-route migration yet.

IRC now resolves text command authorization through the experimental ingress
facade while keeping channel route gates, per-channel sender allowlists, DM
pairing replies, mention activation, history, media, and turn construction
local. IRC is not a complete rich-route migration yet.

## Phase 9: SDK facade stabilization

The narrow SDK subpath now exists as an experimental canary facade:

```text
openclaw/plugin-sdk/channel-ingress
```

Keep exporting only:

- redacted public result types
- controlled adapter or factory types that do not serialize raw match material
- state resolution
- graph decision helpers
- `projectIngressAccessFacts(...)`
- conformance test helpers

Keep the subpath experimental after the simple, route-heavy, and first
rich-route canaries. Stabilize only after more rich route and command plugins
prove the same shape without bundled plugin branches in core.

## Phase 10: Doctor, docs, approval, and target auth

Once multiple plugins use the shared kernel:

- make doctor checks consume the same policy metadata as runtime
- document channel ingress for plugin authors
- update [Access groups](/channels/access-groups) with structured diagnostics
- update [Groups](/channels/groups) with the route-gate model
- mark array-only helpers as compatibility helpers
- make approval auth a consumer of resolved allowlist state
- make outbound target auth a consumer where channel semantics support it

Do not publish approval or target gates as stable SDK APIs until inbound,
command, event, and projection parity are proven.

## Verification

Use targeted tests while iterating:

```sh
pnpm test src/channels/message-access/message-access.test.ts src/plugin-sdk/access-groups.test.ts src/channels/turn/context.test.ts
pnpm test src/security/dm-policy-shared.test.ts src/plugin-sdk/group-access.test.ts src/plugin-sdk/command-auth.test.ts src/channels/command-gating.test.ts src/channels/turn/context.test.ts
pnpm test extensions/whatsapp/src/inbound/access-control.test.ts extensions/signal/src/monitor/access-policy.test.ts extensions/nextcloud-talk/src/inbound.authz.test.ts
pnpm test extensions/matrix/src/matrix/monitor/access-state.test.ts extensions/googlechat/src/monitor-access.test.ts
pnpm test extensions/msteams/src/monitor-handler/message-handler.authz.test.ts extensions/msteams/src/monitor-handler/reaction-handler.test.ts
```

For SDK or broad runtime migrations:

```sh
pnpm plugin-sdk:api:check
pnpm config:docs:gen/check
pnpm check:changed
```

For planning docs alone, `pnpm docs:list`, `pnpm check:docs`, and
`git diff --check` are enough.

## Completion checklist

- Structured access-group state exists beside the compatibility array API.
- `AccessFacts.commands` carries final command authorization.
- The ingress kernel is split into state resolution, graph construction,
  decision composition, projection, and turn-admission mapping.
- The ingress resolver does not accept whole `OpenClawConfig`.
- The adapter owns identity normalization and subject matching.
- Runtime dependencies are resolver dependencies or caller-provided state.
- Route-heavy plugins express route behavior as ordered gate layers.
- Command authorization consumes resolved ingress state.
- Event authorization consumes resolved ingress state.
- Pairing challenge delivery and pairing-store writes remain outside the
  resolver.
- Mention extraction stays plugin-owned.
- Activation math is shared only after plugin mention facts are available.
- PII and dangerous identifiers have redacted diagnostics.
- At least one simple plugin, one route-heavy plugin, and one rich-route plugin
  use the kernel.
- QA Channel and QQBot cover conformance fixtures.
- Doctor checks use the same policy metadata as runtime.
- Plugin docs describe the recommended channel ingress pattern.
- Approval and target auth have a clear path to reuse the same allowlist engine
  without expanding the phase-one SDK surface.
