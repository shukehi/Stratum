// PHASE_02 FROZEN - do not modify fields
export type NewsItem = {
  id: string;
  source: string;
  publishedAt: string;
  title: string;
  category: "macro" | "crypto";
  url?: string;
};
