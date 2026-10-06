import { describe, expect, it, vi } from "vitest";
import {
  createStepUpCoordinator,
  describeStepUpError,
  isLegacyRecentAuthCode,
  isStepUpRequiredCode,
  responseNeedsStepUp,
  sendWithStepUp,
} from "../../../src/lib/step-up.js";

type Result = { status: number; code?: string };
const needsStepUp = (result: Result) => Promise.resolve(isStepUpRequiredCode(result.code));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("step-up error codes", () => {
  it("only prompts for the new code, never for the previous API code", () => {
    expect(isStepUpRequiredCode("STAFF_STEP_UP_REQUIRED")).toBe(true);
    expect(isStepUpRequiredCode("STAFF_RECENT_AUTH_REQUIRED")).toBe(false);
    expect(isStepUpRequiredCode(undefined)).toBe(false);
    expect(isLegacyRecentAuthCode("STAFF_RECENT_AUTH_REQUIRED")).toBe(true);
    expect(isLegacyRecentAuthCode("STAFF_STEP_UP_REQUIRED")).toBe(false);
  });
});

describe("sendWithStepUp", () => {
  it("prompts and retries once when the new API asks for a step-up", async () => {
    const send = vi
      .fn<() => Promise<Result>>()
      .mockResolvedValueOnce({ status: 403, code: "STAFF_STEP_UP_REQUIRED" })
      .mockResolvedValueOnce({ status: 200 });
    const prompt = vi.fn(() => Promise.resolve(true));

    const result = await sendWithStepUp(send, { needsStepUp, prompt });

    expect(result).toEqual({ status: 200 });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("leaves the previous API code STAFF_RECENT_AUTH_REQUIRED alone so the sign-in-again message shows", async () => {
    const legacy = { status: 403, code: "STAFF_RECENT_AUTH_REQUIRED" };
    const send = vi.fn(() => Promise.resolve(legacy));
    const prompt = vi.fn(() => Promise.resolve(true));

    const result = await sendWithStepUp(send, { needsStepUp, prompt });

    expect(result).toBe(legacy);
    expect(prompt).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("returns the original answer without retrying when the prompt is cancelled", async () => {
    const original = { status: 403, code: "STAFF_STEP_UP_REQUIRED" };
    const send = vi.fn(() => Promise.resolve(original));

    const result = await sendWithStepUp(send, {
      needsStepUp,
      prompt: () => Promise.resolve(false),
    });

    expect(result).toBe(original);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never loops: a second step-up answer is returned after a single prompt", async () => {
    const again = { status: 403, code: "STAFF_STEP_UP_REQUIRED" };
    const send = vi.fn(() => Promise.resolve(again));
    const prompt = vi.fn(() => Promise.resolve(true));

    const result = await sendWithStepUp(send, { needsStepUp, prompt });

    expect(result).toBe(again);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("passes other results straight through and works with no prompt registered", async () => {
    const prompt = vi.fn(() => Promise.resolve(true));
    expect(
      await sendWithStepUp(() => Promise.resolve({ status: 200 }), { needsStepUp, prompt }),
    ).toEqual({ status: 200 });
    expect(
      await sendWithStepUp(
        () => Promise.resolve({ status: 403, code: "STAFF_PERMISSION_REQUIRED" }),
        { needsStepUp, prompt },
      ),
    ).toEqual({ status: 403, code: "STAFF_PERMISSION_REQUIRED" });
    expect(prompt).not.toHaveBeenCalled();

    const stale = { status: 403, code: "STAFF_STEP_UP_REQUIRED" };
    expect(await sendWithStepUp(() => Promise.resolve(stale), { needsStepUp, prompt: null })).toBe(
      stale,
    );
  });

  it("propagates a failure of the request itself", async () => {
    await expect(
      sendWithStepUp(() => Promise.reject(new Error("network")), {
        needsStepUp,
        prompt: () => Promise.resolve(true),
      }),
    ).rejects.toThrow("network");
  });
});

describe("createStepUpCoordinator", () => {
  it("shares one dialog among simultaneous requests, then allows a new one", async () => {
    let resolveOpen: (verified: boolean) => void = () => undefined;
    const open = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const prompt = createStepUpCoordinator(open);

    const first = prompt();
    const second = prompt();
    expect(open).toHaveBeenCalledTimes(1);
    resolveOpen(true);
    expect(await Promise.all([first, second])).toEqual([true, true]);

    const third = prompt();
    expect(open).toHaveBeenCalledTimes(2);
    resolveOpen(false);
    expect(await third).toBe(false);
  });
});

describe("describeStepUpError", () => {
  it("distinguishes a revoked session, rate limiting, and a wrong code", () => {
    // A wrong code is a 401 too; it must keep the dialog open.
    expect(describeStepUpError({ status: 401, code: "INVALID_SECOND_FACTOR_CODE" })).toEqual({
      message: "That code is incorrect. Try again.",
      sessionEnded: false,
    });
    expect(describeStepUpError({ status: 401, code: "UNAUTHENTICATED" }).sessionEnded).toBe(true);
    expect(describeStepUpError({ status: 429, code: "RATE_LIMITED" })).toMatchObject({
      sessionEnded: false,
      message: expect.stringContaining("Too many") as string,
    });
    expect(describeStepUpError({ status: 403, code: "STAFF_REAUTH_REQUIRED" }).sessionEnded).toBe(
      true,
    );
    expect(describeStepUpError({ status: 500, code: "X" }).sessionEnded).toBe(false);
  });
});

describe("responseNeedsStepUp", () => {
  it("recognizes the new API refusal and leaves the body readable", async () => {
    const response = json(403, { error: { code: "STAFF_STEP_UP_REQUIRED", message: "x" } });

    expect(await responseNeedsStepUp(response)).toBe(true);
    expect(await response.json()).toMatchObject({ error: { code: "STAFF_STEP_UP_REQUIRED" } });
  });

  it("does not treat the previous API code, other 403s, other statuses, or bad bodies as a step-up", async () => {
    expect(
      await responseNeedsStepUp(json(403, { error: { code: "STAFF_RECENT_AUTH_REQUIRED" } })),
    ).toBe(false);
    expect(
      await responseNeedsStepUp(json(403, { error: { code: "STAFF_PERMISSION_REQUIRED" } })),
    ).toBe(false);
    expect(
      await responseNeedsStepUp(json(401, { error: { code: "STAFF_STEP_UP_REQUIRED" } })),
    ).toBe(false);
    expect(await responseNeedsStepUp(new Response("not json", { status: 403 }))).toBe(false);
    expect(await responseNeedsStepUp(json(200, {}))).toBe(false);
  });

  it("drives sendWithStepUp end to end for both API generations", async () => {
    const fresh = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(json(403, { error: { code: "STAFF_STEP_UP_REQUIRED" } }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const legacy = vi.fn(() =>
      Promise.resolve(json(403, { error: { code: "STAFF_RECENT_AUTH_REQUIRED" } })),
    );
    const prompt = vi.fn(() => Promise.resolve(true));

    const retried = await sendWithStepUp(fresh, { needsStepUp: responseNeedsStepUp, prompt });
    const untouched = await sendWithStepUp(legacy, { needsStepUp: responseNeedsStepUp, prompt });

    expect(retried.status).toBe(200);
    expect(untouched.status).toBe(403);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
