/**
 * 公开站点根地址（仅 origin，或带路径时已去掉末尾 /luxury-life-guides）。
 * 避免 SANITY_BASE_URL / STATIC_BASE_URL 误填为 .../luxury-life-guides 时与 slug 重复拼接。
 */
export function normalizePublicSiteRoot(url: string): string {
  let u = (url || "").trim();
  if (!u) return "";
  if (!u.startsWith("http://") && !u.startsWith("https://")) {
    u = `https://${u}`;
  }
  u = u.replace(/\/+$/, "");
  if (u.endsWith("/luxury-life-guides")) {
    u = u.slice(0, -"/luxury-life-guides".length).replace(/\/+$/, "");
  }
  return u;
}
