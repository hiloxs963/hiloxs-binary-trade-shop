import { describe, expect, it } from "vitest";
import * as client from "../../../src/lib/media-limits.js";
import * as server from "../../src/media/model.js";

// The browser copy cannot be imported by the API build, so this is the only thing keeping the two
// sets of limits equal.
describe("client and server media limits", () => {
  it("match", () => {
    expect([...client.ALLOWED_MEDIA_MIME_TYPES]).toEqual([...server.ALLOWED_MEDIA_MIME_TYPES]);
    expect(client.MAX_MEDIA_INPUT_BYTES).toBe(server.MAX_MEDIA_INPUT_BYTES);
    expect(client.MIN_MEDIA_WIDTH).toBe(server.MIN_MEDIA_WIDTH);
    expect(client.MIN_MEDIA_HEIGHT).toBe(server.MIN_MEDIA_HEIGHT);
    expect(client.MAX_MEDIA_WIDTH).toBe(server.MAX_MEDIA_WIDTH);
    expect(client.MAX_MEDIA_HEIGHT).toBe(server.MAX_MEDIA_HEIGHT);
    expect(client.MAX_MEDIA_INPUT_PIXELS).toBe(server.MAX_MEDIA_INPUT_PIXELS);
  });
});
