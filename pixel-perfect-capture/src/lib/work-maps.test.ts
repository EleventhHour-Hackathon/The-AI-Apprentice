import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL } from "./backend";
import { agentExportUrl, fetchAgentInstructions, fileSlug } from "./work-maps";

const id = "6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f";

describe("agentExportUrl", () => {
  it("points at the Markdown and JSON exports of one Work Map", () => {
    expect(agentExportUrl(id, "md")).toBe(`${BACKEND_URL}/api/v1/work_maps/${id}/agent.md`);
    expect(agentExportUrl(id, "json")).toBe(`${BACKEND_URL}/api/v1/work_maps/${id}/agent.json`);
  });

  it("escapes the id so it stays one path segment", () => {
    expect(agentExportUrl("a/b?c", "md")).toBe(
      `${BACKEND_URL}/api/v1/work_maps/a%2Fb%3Fc/agent.md`,
    );
  });
});

describe("fileSlug", () => {
  it("turns the task into a file name", () => {
    expect(fileSlug("Code a supplier invoice!")).toBe("code-a-supplier-invoice");
  });

  it("falls back when there is no task or no Latin letters", () => {
    expect(fileSlug(null)).toBe("work-map");
    expect(fileSlug("发票编码")).toBe("work-map");
  });
});

describe("fetchAgentInstructions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the Markdown from the export URL", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("# Task\n", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const blob = await fetchAgentInstructions(id);
    expect(blob.size).toBe("# Task\n".length);
    expect(fetch).toHaveBeenCalledWith(agentExportUrl(id, "md"), undefined);
  });

  it("throws a readable message instead of navigating to an error page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(fetchAgentInstructions(id)).rejects.toThrow("This Work Map doesn’t exist.");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(fetchAgentInstructions(id)).rejects.toThrow("unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchAgentInstructions(id)).rejects.toThrow("Couldn’t reach");
  });
});
