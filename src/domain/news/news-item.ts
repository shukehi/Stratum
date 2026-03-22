// PHASE_02 已冻结：不要修改字段定义
export type NewsItem = {
  id: string;
  source: string;
  publishedAt: string;
  title: string;
  category: "macro" | "crypto";
  url?: string;
};
