<?php
/**
 * WordPress URL Rewrite for Luxury Life Guides
 * 
 * 将此代码添加到您的WordPress主题的 functions.php 文件中
 * 或者作为独立插件使用
 * 
 * 功能：自动为带有 _custom_url_prefix 自定义字段的页面添加URL前缀 /luxury-life-guides/
 * /luxury-life-guides/ 根路径返回 200 主题聚合页（含内链与 ItemList JSON-LD），不再 301 到首页
 * 不影响其他页面
 * 
 * 使用方法：
 * 1. 将此代码添加到主题的 functions.php 文件末尾
 * 2. 进入 WordPress 后台：设置 → 固定链接 → 保存更改（刷新重写规则）
 * 3. 完成！新发布的页面会自动使用 /luxury-life-guides/ 前缀
 */

// 添加URL重写规则（必须在init钩子中）
function luxury_life_guides_add_rewrite_rules() {
    // 添加重写规则：luxury-life-guides/{slug}/ -> 映射到对应的页面
    add_rewrite_rule(
        '^luxury-life-guides/([^/]+)/?$',
        'index.php?pagename=$matches[1]',
        'top'
    );
    
    // /luxury-life-guides/ 由 luxury_life_guides_render_hub_page 输出聚合页（200）
    add_rewrite_rule(
        '^luxury-life-guides/?$',
        'index.php?pagename=luxury-life-guides-index',
        'top'
    );
    
    // 添加重写标签（如果需要）
    add_rewrite_tag('%luxury_guide_page%', '([^/]+)');
}
add_action('init', 'luxury_life_guides_add_rewrite_rules', 10);

// 修改页面的permalink，为带有 _custom_url_prefix 的页面添加前缀
// 使用多个过滤器确保在所有情况下都能正确工作
function luxury_life_guides_filter_page_link($permalink, $post_id, $leavename) {
    // 只处理页面类型
    if (get_post_type($post_id) !== 'page') {
        return $permalink;
    }
    
    // 检查是否有自定义URL前缀
    $url_prefix = get_post_meta($post_id, '_custom_url_prefix', true);
    
    if ($url_prefix && $url_prefix === 'luxury-life-guides') {
        // 获取页面的slug
        $post = get_post($post_id);
        if ($post && $post->post_name) {
            $slug = $post->post_name;
            // 构建新的URL（确保格式正确）
            $home_url = trailingslashit(home_url());
            $new_permalink = $home_url . $url_prefix . '/' . $slug . '/';
            return $new_permalink;
        }
    }
    
    return $permalink;
}
// 使用多个过滤器确保在所有情况下都能工作
add_filter('page_link', 'luxury_life_guides_filter_page_link', 10, 3);
add_filter('post_link', 'luxury_life_guides_filter_page_link', 10, 3);
add_filter('post_type_link', 'luxury_life_guides_filter_page_link', 10, 3);

// 处理URL重写请求，确保能正确解析 /luxury-life-guides/slug/ 到实际页面
function luxury_life_guides_parse_request($wp) {
    // 获取请求的路径
    $request_uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
    
    // 处理 /luxury-life-guides/ 目录页面（不带 slug）：由 template_redirect 输出 hub
    if (preg_match('#^/luxury-life-guides/?$#', $request_uri)) {
        $wp->query_vars['pagename'] = 'luxury-life-guides-index';
        $wp->query_vars['post_type'] = 'page';
        return;
    }
    
    // 检查是否是 /luxury-life-guides/{slug}/ 的请求
    if (preg_match('#^/luxury-life-guides/([^/]+)/?#', $request_uri, $matches)) {
        $slug = $matches[1];
        
        // 查找具有该slug的页面
        $page = get_page_by_path($slug, OBJECT, 'page');
        
        if ($page) {
            // 检查该页面是否有 _custom_url_prefix 自定义字段
            $url_prefix = get_post_meta($page->ID, '_custom_url_prefix', true);
            
            if ($url_prefix === 'luxury-life-guides') {
                // 设置正确的查询变量，让WordPress识别这个页面
                $wp->query_vars['pagename'] = $slug;
                $wp->query_vars['page_id'] = $page->ID;
                $wp->query_vars['post_type'] = 'page';
                
                // 清除可能冲突的查询变量
                unset($wp->query_vars['name']);
                unset($wp->query_vars['attachment']);
            }
        }
    }
}
add_action('parse_request', 'luxury_life_guides_parse_request', 5);

/**
 * 输出 /luxury-life-guides/ 主题 hub：列出所有带 _custom_url_prefix=luxury-life-guides 的已发布页面。
 * 使用 200 + CollectionPage / ItemList 结构化数据，利于主题集群与内链。
 */
function luxury_life_guides_render_hub_page() {
    if (is_admin()) {
        return;
    }
    $req_path = isset($_SERVER['REQUEST_URI']) ? strtok($_SERVER['REQUEST_URI'], '?') : '';
    if ($req_path === false || !preg_match('#^/luxury-life-guides/?$#', $req_path)) {
        return;
    }

    global $wp_query;
    status_header(200);
    if ($wp_query) {
        $wp_query->is_404 = false;
        $wp_query->is_page = false;
        $wp_query->is_singular = false;
        $wp_query->is_home = false;
        $wp_query->is_archive = false;
    }

    $hub_url = trailingslashit(home_url('/luxury-life-guides/'));
    $q = new WP_Query(array(
        'post_type'      => 'page',
        'post_status'    => 'publish',
        'posts_per_page' => -1,
        'orderby'        => 'modified',
        'order'          => 'DESC',
        'meta_key'       => '_custom_url_prefix',
        'meta_value'     => 'luxury-life-guides',
    ));

    $items = array();
    if ($q->have_posts()) {
        while ($q->have_posts()) {
            $q->the_post();
            $items[] = array(
                'url'   => get_permalink(),
                'title' => get_the_title(),
            );
        }
        wp_reset_postdata();
    }

    $list_elements = array();
    $position = 1;
    foreach ($items as $row) {
        $list_elements[] = array(
            '@type'    => 'ListItem',
            'position' => $position++,
            'url'      => $row['url'],
            'name'     => $row['title'],
        );
    }

    $schema = array(
        '@context' => 'https://schema.org',
        '@graph'   => array(
            array(
                '@type'           => 'CollectionPage',
                '@id'             => $hub_url . '#webpage',
                'url'             => $hub_url,
                'name'            => __('Luxury Life Guides', 'luxury-life-guides'),
                'description'     => __('Editorial guides and buying advice from VERTU.', 'luxury-life-guides'),
                'inLanguage'      => 'en-GB',
                'isPartOf'        => array('@id' => trailingslashit(home_url('/')) . '#website'),
                'breadcrumb'      => array('@id' => $hub_url . '#breadcrumb'),
            ),
            array(
                '@type'           => 'BreadcrumbList',
                '@id'             => $hub_url . '#breadcrumb',
                'itemListElement' => array(
                    array(
                        '@type'    => 'ListItem',
                        'position' => 1,
                        'name'     => __('Home', 'luxury-life-guides'),
                        'item'     => trailingslashit(home_url('/')),
                    ),
                    array(
                        '@type'    => 'ListItem',
                        'position' => 2,
                        'name'     => __('Luxury Life Guides', 'luxury-life-guides'),
                        'item'     => $hub_url,
                    ),
                ),
            ),
            array(
                '@type'            => 'ItemList',
                'name'             => __('Luxury Life Guides', 'luxury-life-guides'),
                'numberOfItems'    => count($list_elements),
                'itemListElement'  => $list_elements,
            ),
        ),
    );

    header('Content-Type: text/html; charset=' . get_option('blog_charset'));
    ?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title><?php echo esc_html(get_bloginfo('name') . ' — Luxury Life Guides'); ?></title>
    <meta name="description" content="<?php echo esc_attr(__('Browse VERTU luxury life guides: phones, wearables, and concierge-led buying advice.', 'luxury-life-guides')); ?>" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="<?php echo esc_url($hub_url); ?>" />
    <script type="application/ld+json"><?php echo wp_json_encode($schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?></script>
    <?php wp_head(); ?>
    <style>
        body.llg-hub{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fafafa;color:#111;line-height:1.5}
        .llg-wrap{max-width:720px;margin:0 auto;padding:2rem 1.25rem 3rem}
        .llg-wrap h1{font-size:1.5rem;font-weight:700;margin:0 0 .5rem}
        .llg-wrap p.lead{margin:0 0 1.5rem;color:#444;font-size:1rem}
        .llg-list{list-style:none;padding:0;margin:0}
        .llg-list li{border-bottom:1px solid #e5e5e5}
        .llg-list a{display:block;padding:.85rem 0;text-decoration:none;color:#0a3d91;font-weight:500}
        .llg-list a:hover{text-decoration:underline}
        .llg-home{margin-top:2rem;font-size:.95rem}
        .llg-home a{color:#333}
    </style>
</head>
<body class="llg-hub">
    <main class="llg-wrap">
        <h1><?php esc_html_e('Luxury Life Guides', 'luxury-life-guides'); ?></h1>
        <p class="lead"><?php esc_html_e('Editorial guides and buying advice. Select a topic below.', 'luxury-life-guides'); ?></p>
        <?php if (empty($items)) : ?>
            <p><?php esc_html_e('No guides are published yet. Check back soon.', 'luxury-life-guides'); ?></p>
        <?php else : ?>
            <ul class="llg-list">
                <?php foreach ($items as $row) : ?>
                    <li><a href="<?php echo esc_url($row['url']); ?>"><?php echo esc_html($row['title']); ?></a></li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
        <p class="llg-home"><a href="<?php echo esc_url(home_url('/')); ?>">&larr; <?php esc_html_e('Back to home', 'luxury-life-guides'); ?></a></p>
    </main>
    <?php wp_footer(); ?>
</body>
</html>
    <?php
    exit;
}
add_action('template_redirect', 'luxury_life_guides_render_hub_page', 0);

// 在模板重定向时确保正确加载页面
function luxury_life_guides_template_redirect() {
    global $wp_query;
    
    // 如果查询变量中有我们设置的page_id，确保能正确加载页面
    if (isset($wp_query->query_vars['page_id'])) {
        $page_id = $wp_query->query_vars['page_id'];
        $url_prefix = get_post_meta($page_id, '_custom_url_prefix', true);
        
        if ($url_prefix === 'luxury-life-guides') {
            // 确保查询正确设置
            $wp_query->is_page = true;
            $wp_query->is_singular = true;
            $wp_query->queried_object = get_post($page_id);
            $wp_query->queried_object_id = $page_id;
        }
    }
}
add_action('template_redirect', 'luxury_life_guides_template_redirect', 5);

// 刷新重写规则（首次激活时运行）
function luxury_life_guides_flush_rewrite_rules() {
    luxury_life_guides_add_rewrite_rules();
    flush_rewrite_rules();
}

// 在主题切换时也刷新规则
add_action('after_switch_theme', 'luxury_life_guides_flush_rewrite_rules');

// ============================================
// 自动设置自定义字段（关键功能）
// ============================================

/**
 * 通过REST API创建或更新页面时，自动检测并设置 _custom_url_prefix 字段
 * 只对明确通过我们的系统创建的页面进行设置，不影响正常创建的页面
 */
function luxury_life_guides_auto_set_url_prefix($post, $request, $creating) {
    // 只处理页面类型
    if ($post->post_type !== 'page') {
        return;
    }
    
    // 重要：检查是否已经有自定义字段（避免覆盖已存在的页面设置）
    $existing_prefix = get_post_meta($post->ID, '_custom_url_prefix', true);
    if ($existing_prefix) {
        // 如果已经有自定义字段（无论是luxury-life-guides还是其他值），都不覆盖
        // 这样可以保护已存在的页面和手动设置的页面
        return;
    }
    
    // 只通过REST API请求中的meta字段来设置（最可靠、最安全的方法）
    // 这样可以确保只有我们的系统明确要求设置的页面才会被设置
    if (isset($request['meta']) && isset($request['meta']['_custom_url_prefix'])) {
        $url_prefix = $request['meta']['_custom_url_prefix'];
        if ($url_prefix === 'luxury-life-guides') {
            // 只有在REST API请求明确要求设置时才设置
            update_post_meta($post->ID, '_custom_url_prefix', $url_prefix);
            return;
        }
    }
    
    // 不再使用基于slug模式或内容关键词的自动检测
    // 这样可以避免误判正常创建的页面
    // 只有通过REST API明确传递meta字段的页面才会被设置
}
add_action('rest_insert_page', 'luxury_life_guides_auto_set_url_prefix', 10, 3);

/**
 * 注意：我们不使用 save_post_page hook 来自动设置
 * 原因：
 * 1. save_post_page 在WordPress后台保存时也会触发，可能影响正常创建的页面
 * 2. 无法可靠地区分是通过REST API还是后台创建的页面
 * 3. 只依赖 rest_insert_page hook，它只在REST API创建/更新时触发
 * 
 * 这样可以确保：
 * - 只对通过REST API明确传递meta字段的页面进行设置
 * - 不影响通过WordPress后台正常创建的页面
 * - 不影响已存在的页面（如果已有自定义字段，不会覆盖）
 */

/**
 * 注册REST API字段，允许通过REST API设置和获取 _custom_url_prefix
 * 这样后端代码就可以直接通过REST API设置这个字段了
 */
function luxury_life_guides_register_rest_field() {
    register_rest_field('page', '_custom_url_prefix', array(
        'get_callback' => function($post) {
            return get_post_meta($post['id'], '_custom_url_prefix', true);
        },
        'update_callback' => function($value, $post) {
            return update_post_meta($post->ID, '_custom_url_prefix', $value);
        },
        'schema' => array(
            'description' => 'Custom URL prefix for luxury-life-guides pages',
            'type' => 'string',
            'context' => array('view', 'edit'),
        ),
    ));
}
add_action('rest_api_init', 'luxury_life_guides_register_rest_field');


