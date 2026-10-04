import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BACKEND_URL as BACKEND_URL } from "./backend";
import {
  agentExportUrl,
  diffError,
  fetchAgentInstructions,
  fetchFollowUps,
  fetchWorkMapDiff,
  fileSlug,
  followUpError,
  postFollowUps,
  withdrawFollowUp,
  type DiffQuestion,
  type FollowUp,
} from "./work-maps";
import source from "./work-maps.ts?raw";

const id = "6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f";

describe("work-maps imports", () => {
  it("doesn't import lib/compare, which imports this module", () => {
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((p) => /^(@\/lib\/|\.\/)compare(\.ts)?$/.test(p))).toEqual([]);
  });
});

describe("diffError", () => {
  it("says which session is gone", () => {
    expect(diffError(404, "Work Map a not found")).toBe(
      "Session A no longer exists. Pick another one.",
    );
    expect(diffError(404, "Work Map b not found")).toBe(
      "Session B no longer exists. Pick another one.",
    );
    expect(diffError(404, "Work Map not found")).toBe("That isn’t a Work Map id.");
    expect(diffError(404, undefined)).toBe("That isn’t a Work Map id.");
  });

  it("tells a same-session pick from an incomplete link", () => {
    expect(diffError(422, "Pick two different Work Maps")).toBe("Pick two different sessions.");
    expect(diffError(422, [{ loc: ["query", "b"], msg: "Field required" }])).toBe(
      "The compare link is incomplete.",
    );
  });

  it("names storage trouble and any other status", () => {
    expect(diffError(503, "Work Map storage is unavailable")).toBe(
      "Work Map storage (Supabase) is unavailable.",
    );
    expect(diffError(500, null)).toBe("The backend answered 500.");
  });
});

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
    expect(fetch.mock.calls[0]![0]).toBe(agentExportUrl(id, "md"));
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

describe("fetchWorkMapDiff", () => {
  afterEach(() => vi.unstubAllGlobals());

  const side = {
    task: "t",
    recorded_at: null,
    confirmed: true,
    status: "",
    steps: 1,
    guardrails: 0,
  };
  const body = {
    a: { id, ...side },
    b: { id: "b", ...side },
    diff: { steps: { same: [], differs: [], only_a: [], only_b: [] } },
  };

  it("asks for the pair with escaped ids and an optional limit", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(body)));
    vi.stubGlobal("fetch", fetch);
    await fetchWorkMapDiff("a/1&x", "b 2", 3);
    expect(fetch.mock.calls[0]![0]).toBe(
      `${BACKEND_URL}/api/v1/work_map_diff?a=a%2F1%26x&b=b+2&limit=3`,
    );
    await fetchWorkMapDiff(id, "b");
    expect(fetch.mock.calls[1]![0]).toBe(`${BACKEND_URL}/api/v1/work_map_diff?a=${id}&b=b`);
  });

  it("treats an answer without questions as nothing to ask", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    expect((await fetchWorkMapDiff(id, "b")).questions).toEqual({ a: [], b: [] });
  });

  it("explains a network error and a missing session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchWorkMapDiff(id, "b")).rejects.toThrow(
      "Couldn’t reach the apprentice backend.",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ detail: "Work Map b not found" }, { status: 404 })),
    );
    await expect(fetchWorkMapDiff(id, "b")).rejects.toThrow(
      "Session B no longer exists. Pick another one.",
    );
  });
});

describe("followUpError", () => {
  it("says what went wrong in words", () => {
    expect(followUpError(404, "No such question waiting")).toBe(
      "That question is no longer waiting.",
    );
    expect(followUpError(404, "Work Map not found")).toBe("That session no longer exists.");
    expect(followUpError(422, "A question needs its text")).toBe("A question needs its text");
    expect(followUpError(422, [{ msg: "too long" }])).toBe(
      "The question couldn’t be kept: it is too long or incomplete.",
    );
    expect(followUpError(503, "Work Map storage is unavailable")).toBe(
      "Work Map storage (Supabase) is unavailable.",
    );
    expect(followUpError(500, null)).toBe("The backend answered 500.");
  });
});

describe("follow-up questions", () => {
  afterEach(() => vi.unstubAllGlobals());

  const other = "0a1b2c3d-4e5f-4a5b-8c7d-6e5f4a3b2c1d";
  const base = `${BACKEND_URL}/api/v1/work_maps/${id}/follow_up_questions`;
  const pending: FollowUp[] = [
    {
      question_id: "guardrails:g1:g1:numbers",
      text: "Why 10,000?",
      quote: "",
      from: other,
      added_at: "2026-10-04T10:00:00+00:00",
    },
  ];
  const question = (n: number, text = `Why ${n}?`, quote = ""): DiffQuestion => ({
    id: `steps:-:s${n}:only`,
    section: "steps",
    item: `s${n}`,
    other: null,
    field: "only",
    text,
    quote,
  });

  it("lists what is waiting", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ questions: pending }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchFollowUps(id)).toEqual(pending);
    expect(fetch.mock.calls[0]![0]).toBe(base);
    expect(fetch.mock.calls[0]![1]?.method ?? "GET").toBe("GET");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    expect(await fetchFollowUps(id)).toEqual([]);
  });

  it("keeps questions with their text and quote cut to 300 characters", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ added: ["steps:-:s1:only"], questions: pending }));
    vi.stubGlobal("fetch", fetch);
    const long = "x".repeat(400);
    const result = await postFollowUps(id, [question(1, `  ${long}`, long)], other);
    expect(result).toEqual({ added: ["steps:-:s1:only"], questions: pending });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(base);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      questions: [
        {
          id: "steps:-:s1:only",
          text: "x".repeat(300),
          quote: "x".repeat(300),
          from_work_map_id: other,
        },
      ],
    });
  });

  it("sends at most 10, skips empty ones, and never sends none", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ added: [], questions: [] }));
    vi.stubGlobal("fetch", fetch);
    const many = Array.from({ length: 12 }, (_, i) => question(i + 1));
    await postFollowUps(id, [question(0, "  "), ...many], other);
    const sent = JSON.parse(fetch.mock.calls[0]![1].body).questions;
    expect(sent).toHaveLength(10);
    expect(sent[0].id).toBe("steps:-:s1:only");
    expect(sent.every((q: { from_work_map_id: string }) => q.from_work_map_id === other)).toBe(
      true,
    );
    await expect(postFollowUps(id, [question(0, " ")], other)).rejects.toThrow("Nothing to ask.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("withdraws with the id in the query, not the path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ withdrawn: "guardrails:g1:g1:numbers", questions: [] }));
    vi.stubGlobal("fetch", fetch);
    expect(await withdrawFollowUp(id, "guardrails:g1:g1:numbers")).toEqual({
      withdrawn: "guardrails:g1:g1:numbers",
      questions: [],
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${base}?question_id=guardrails%3Ag1%3Ag1%3Anumbers`);
    expect(init.method).toBe("DELETE");
  });

  it("explains a network error and a refused request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchFollowUps(id)).rejects.toThrow("Couldn’t reach the apprentice backend.");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ detail: "No such question waiting" }, { status: 404 })),
    );
    await expect(withdrawFollowUp(id, "x")).rejects.toThrow("That question is no longer waiting.");
  });

  it("passes an abort through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")),
    );
    await expect(fetchFollowUps(id)).rejects.toMatchObject({ name: "AbortError" });
  });
});
