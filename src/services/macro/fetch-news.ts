import type { NewsItem } from "../../domain/news/news-item.js";

/**
 * 新闻获取客户端  (PHASE_07)
 *
 * 从 NewsAPI (/v2/everything) 拉取过去 24h 内的宏观与加密新闻。
 * 分类规则：标题含 bitcoin / btc / crypto / ethereum / defi / blockchain → crypto；其余 → macro。
 *
 * 调用时需提供有效的 NEWS_API_KEY（来自 env.NEWS_API_KEY）。
 * 若 apiKey 为空，函数直接返回 []，不抛错（下游可优雅降级）。
 */

const CRYPTO_KEYWORDS = ["bitcoin", "btc", "crypto", "ethereum", "eth", "defi", "blockchain", "altcoin"];

const DEFAULT_QUERY =
  "bitcoin OR BTC OR crypto OR macroeconomics OR FOMC OR CPI OR inflation OR interest+rate OR SEC OR regulation";

function classifyCategory(title: string): "macro" | "crypto" {
  const lower = title.toLowerCase();
  return CRYPTO_KEYWORDS.some((kw) => lower.includes(kw)) ? "crypto" : "macro";
}

type NewsApiArticle = {
  source: { name: string };
  publishedAt: string;
  title: string;
  url?: string;
};

type NewsApiResponse = {
  status: string;
  articles: NewsApiArticle[];
};

export async function fetchNews(apiKey: string, maxItems: number): Promise<NewsItem[]> {
  if (!apiKey) return [];

  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = new URL("https://newsapi.org/v2/everything");
  url.searchParams.set("q", DEFAULT_QUERY);
  url.searchParams.set("sortBy", "publishedAt");
  url.searchParams.set("language", "en");
  url.searchParams.set("from", from);
  url.searchParams.set("pageSize", String(Math.min(maxItems, 100)));
  url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`NewsAPI HTTP ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as NewsApiResponse;
  if (data.status !== "ok") {
    throw new Error(`NewsAPI status error: ${data.status}`);
  }

  return data.articles.slice(0, maxItems).map((article, i) => ({
    id: `news-${Date.now()}-${i}`,
    source: article.source.name,
    publishedAt: article.publishedAt,
    title: article.title,
    category: classifyCategory(article.title),
    url: article.url,
  }));
}
