import { describe, expect, it } from "vitest";
import {
  createChannelIngressPluginId,
  createChannelIngressStringAdapter,
  createChannelIngressSubject,
  decideChannelIngress,
  projectIngressAccessFacts,
  resolveChannelIngressState,
} from "./channel-ingress.js";

describe("plugin-sdk/channel-ingress", () => {
  it("resolves sender policy through the experimental SDK facade", async () => {
    const rawSender = "secret-sender@example.test";
    const state = await resolveChannelIngressState({
      channelId: createChannelIngressPluginId("test-channel"),
      accountId: "default",
      subject: createChannelIngressSubject({
        value: rawSender,
      }),
      conversation: {
        kind: "direct",
        id: "dm-1",
      },
      adapter: createChannelIngressStringAdapter(),
      event: {
        kind: "message",
        authMode: "inbound",
        mayPair: false,
      },
      allowlists: {
        dm: [rawSender],
      },
    });

    const decision = decideChannelIngress(state, {
      dmPolicy: "allowlist",
      groupPolicy: "open",
    });

    expect(decision).toMatchObject({
      admission: "dispatch",
      decision: "allow",
    });
    expect(projectIngressAccessFacts(decision)).toMatchObject({
      dm: {
        decision: "allow",
        allowlist: {
          configured: true,
          matched: true,
        },
      },
    });
    expect(JSON.stringify(state)).not.toContain(rawSender);
    expect(JSON.stringify(decision)).not.toContain(rawSender);
  });
});
