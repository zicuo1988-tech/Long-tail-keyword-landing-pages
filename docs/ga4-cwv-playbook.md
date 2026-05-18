# GA4 and Core Web Vitals playbook (luxury-life-guides)

This project emits custom events from [`backend/src/services/templateRenderer.ts`](../backend/src/services/templateRenderer.ts) (`buildPageUxScript`): `scroll_depth` (25/50/75/90), `ll_cta_click`, `faq_toggle`, `ll_engagement_timer` (30s). Use them to separate **bounce before scroll** from **scroll without conversion**.

## GA4 exploration

1. **Explore → Free form**  
   - Rows: `Landing page` or `Page path + query string` filtered to `/luxury-life-guides/`.  
   - Columns or nested breakdown: create a segment or secondary dimension on `Event name` = `scroll_depth` / `ll_engagement_timer`.

2. **Funnel / path**  
   - Step 1: `session_start` on landing page = target URL.  
   - Step 2: `scroll_depth` with `percent_scrolled` ≥ 50 (register the parameter as a custom dimension if it does not appear).

3. **Diagnostics**  
   - If most sessions never fire `scroll_depth` at 25: focus on **title–content match**, **above-the-fold answer**, and **LCP** (hero image, fonts, blocking scripts).  
   - If scroll_depth fires but no `ll_cta_click` / purchases: tune **mid-page value** and CTAs, not only SEO snippets.

## Core Web Vitals

1. Use [PageSpeed Insights](https://pagespeed.web.dev/) on the worst **landing URLs** from GA4 (high bounce, meaningful traffic).  
2. Fix **LCP**: priority for the largest above-the-fold image (`fetchpriority="high"` where appropriate), reduce server/TTFB, avoid huge HTML before main content.  
3. Fix **CLS**: set explicit `width` and `height` on product images in WordPress/theme where possible; avoid injecting large blocks above existing content after paint.  
4. **INP**: defer non-critical scripts; keep accordions and buttons responsive.

## Template tweaks in this repo

- [`frontend/default-template.html`](../frontend/default-template.html) uses tighter horizontal padding below 1024px width so the article body reaches the viewport sooner on tablets and small laptops.

When WordPress plugins add analytics or chat widgets, retest PSI on a **logged-out** incognito session to match real users.
