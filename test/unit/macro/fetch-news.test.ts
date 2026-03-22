import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNews } from "../../../src/services/macro/fetch-news.js";

describe("fetchNews", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("通过请求头传递 NewsAPI Key，而不是 query string", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        status: "ok",
        articles: [],
      }),
    });

    await fetchNews("news-api-key", 10);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("newsapi.org/v2/everything");
    expect(url).not.toContain("apiKey=");
    expect(init.headers).toEqual({ "X-Api-Key": "news-api-key" });
  });
});
