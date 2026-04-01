Sanity + Next.js 联调说明（与 backend/src/services/sanityPublisher.ts 对齐）

1) 环境变量（Next 前台，只读，用 public dataset + CDN）
   NEXT_PUBLIC_SANITY_PROJECT_ID=xxx
   NEXT_PUBLIC_SANITY_DATASET=production
   NEXT_PUBLIC_SANITY_API_VERSION=2024-01-01

2) 依赖
   npm install next-sanity next react react-dom

3) 将 sanity/schemaTypes/luxuryLifeGuide.ts 复制到对方 Sanity Studio 工程并注册（default export）：
   import luxuryLifeGuide from "./schemaTypes/luxuryLifeGuide";
   export const schemaTypes = [luxuryLifeGuide, ...];

4) Slug 约定（与当前生成器一致）
   - slug.current = "luxury-life-guides/<baseSlug>"
   - 前台路径 = /luxury-life-guides/<baseSlug>/
   - 本示例动态段 [slug] 只接收 <baseSlug>，查询时拼成 fullSlug。

5) SANITY_BASE_URL（后端发布用）建议填站点根，例如 https://vertu.com
   不要填 https://vertu.com/luxury-life-guides（易与 slug 重复）。
   若误填带 /luxury-life-guides 的后端会自动去掉该段再拼 pageUrl（见 publicSiteUrl.ts）。

6) 若对方希望 slug 只存 <baseSlug>（不带 luxury-life-guides/ 前缀），需同时改 sanityPublisher 里 slug 与 pageUrl 的拼接逻辑，双方再对齐一次。

7) 模板输出可能是完整 HTML 文档；用 dangerouslySetInnerHTML 包在 layout 的 main 里时，若含 html/body 标签，可考虑改为只渲染 body 内或让对方用 iframe 沙箱。

8) 合并到已有 Next 项目：复制 schema 到 Studio；复制 app/luxury-life-guides 与 lib/sanity.client.ts；安装依赖见 package.json；配置 NEXT_PUBLIC_SANITY_*。

--- 404 排查（线上 vertu.com 打开落地页 404，但生成器显示成功）---

A) 在 Sanity Vision（production dataset）执行：
   *[_type == "luxuryLifeGuide" && slug.current == "luxury-life-guides/你的文章段"][0]
   能查到 → 数据在库，问题在「前台站点」；查不到 → 看 dataset / projectId / 类型名是否一致。

B) 前台必须有路由：/luxury-life-guides/[slug]，且 GROQ 用 slug.current == "luxury-life-guides/" + params.slug（与本仓库 page.tsx 一致）。

C) 部署：该路由必须已随 Next 发布到 vertu.com；迁移期若旧站未接新路由，会进统一 404 页。

D) page.tsx 建议 export const dynamic = "force-dynamic"（已在示例中），避免新文档被静态生成阶段判成无数据。

E) 读 token：前台用 Viewer 即可；与后端写入用的 Editor Token 无关。
