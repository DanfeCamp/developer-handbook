---
title: 'WordPress'
description: 'Developing themes and plugins for the WordPress platform — hooks, block themes, the REST API, security, performance and modern tooling.'
---

# WordPress

## Introduction

WordPress runs a large share of the web. That fact alone makes it worth
understanding, and it also explains most of what is odd about it: a codebase
begun in 2003 that has never broken backwards compatibility, layered with a
modern React-based editor.

**What it is.** A PHP content management system with a plugin and theme
architecture built around **hooks** — a publish/subscribe system letting code
modify behaviour without touching core. That extensibility is why the ecosystem
is enormous, and why WordPress sites vary so wildly in quality.

**Where it fits.** Content sites, blogs, marketing sites, membership sites and —
via WooCommerce — a great deal of e-commerce. It is also increasingly used
**headless**, serving content over the REST API or GraphQL to a
[Next.js](/knowledge-base/next-js) front end.

**Two worlds coexist.** _Classic_ WordPress is PHP templates and the older
editor. _Block_ WordPress is the React-based block editor plus block themes and
Full Site Editing. New work should be block-based; a large amount of existing
work is not, and both remain supported.

:::note Versions
Written against **WordPress 7.0 "Armstrong"** (20 May 2026). It requires PHP 7.4
as a minimum, though **PHP 8.2+ is what you should actually run** — 7.4 is long
past end of life and receives no security fixes from the PHP project.
:::

---

## Core Concepts

### Hooks

Everything extensible in WordPress goes through hooks. There are two kinds:

- **Actions** — "this happened; do something."
- **Filters** — "here is a value; return a modified one."

```php
// Action: run code at a point in the lifecycle.
add_action( 'init', function () {
    register_post_type( 'product', [
        'public'       => true,
        'label'        => 'Products',
        'supports'     => [ 'title', 'editor', 'thumbnail', 'custom-fields' ],
        'show_in_rest' => true,   // required for the block editor and REST API
        'has_archive'  => true,
    ] );
} );

// Filter: receive a value, return a modified one.
add_filter( 'the_content', function ( string $content ): string {
    if ( is_singular( 'product' ) ) {
        $content .= '<p class="notice">Free delivery over £50.</p>';
    }
    return $content;
} );
```

**A filter must return a value.** Forgetting the `return` silently blanks
whatever you hooked — the single most common WordPress mistake, and one that
produces an empty page rather than an error.

Priority controls ordering (default 10, lower runs earlier), and the fourth
argument declares how many arguments your callback accepts:

```php
add_filter( 'the_title', 'my_callback', 20, 2 );   // priority 20, 2 args
```

### The template hierarchy

Classic themes resolve a template by walking a defined list from most to least
specific. For a single product post:

```text
single-product.php → single.php → singular.php → index.php
```

`index.php` is the guaranteed fallback — a valid classic theme can consist of
`index.php` and `style.css` alone.

### The Loop

```php
if ( have_posts() ) :
    while ( have_posts() ) : the_post();
        the_title( '<h2>', '</h2>' );
        the_excerpt();
    endwhile;
endif;
```

`the_post()` sets up the global post object, which is what makes `the_title()`
and friends work. This global-state design is why WordPress functions take so
few arguments — and why forgetting `wp_reset_postdata()` after a custom
`WP_Query` leaves subsequent template tags reading the wrong post.

### Data model

Six core tables do most of the work:

| Table                           | Holds                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| `wp_posts`                      | Posts, pages, attachments, revisions, **and every custom post type** |
| `wp_postmeta`                   | Arbitrary key/value data attached to posts                           |
| `wp_terms` / `wp_term_taxonomy` | Categories, tags, custom taxonomies                                  |
| `wp_users` / `wp_usermeta`      | Users                                                                |
| `wp_options`                    | Site-wide settings, including transients                             |

**`wp_postmeta` is an EAV table**, and querying by meta value does not scale —
there is no index on `meta_value`. A site that filters products by a dozen meta
fields will be slow, and the fix is usually a custom table or a proper taxonomy
rather than more meta. See [Data Modelling](/knowledge-base/databases/data-modelling).

**Custom post types and taxonomies** are the right tool for structured content:
a taxonomy is indexed and fast, meta is not.

---

## Block Themes and the Block Editor

Block themes replace PHP templates with HTML templates plus a `theme.json`
configuration file, and give users Full Site Editing.

```text
my-theme/
├── style.css              ← theme header (still required)
├── theme.json             ← design system: colours, spacing, typography
├── functions.php
├── templates/
│   ├── index.html
│   ├── single.html
│   └── archive-product.html
├── parts/
│   ├── header.html
│   └── footer.html
└── patterns/
    └── hero.php
```

```json title="theme.json"
{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3,
  "settings": {
    "color": {
      "custom": false,
      "palette": [
        {"slug": "primary", "color": "#0b57d0", "name": "Primary"},
        {"slug": "surface", "color": "#f6f8fc", "name": "Surface"}
      ]
    },
    "typography": {
      "fluid": true,
      "fontSizes": [{"slug": "large", "size": "1.5rem", "name": "Large"}]
    },
    "layout": {"contentSize": "48rem", "wideSize": "72rem"}
  },
  "styles": {
    "color": {"background": "var(--wp--preset--color--surface)"}
  }
}
```

`theme.json` is the highest-leverage file in a modern theme. It defines the
design system once, constrains what editors can change (`"custom": false`
removes the arbitrary colour picker), and generates CSS custom properties
automatically — which is how you stop a site drifting into forty shades of blue.

### Building a custom block

```bash
npx @wordpress/create-block my-block
```

```jsx title="src/edit.js"
import {useBlockProps, RichText} from '@wordpress/block-editor';

export default function Edit({attributes, setAttributes}) {
  const blockProps = useBlockProps();

  return (
    <div {...blockProps}>
      <RichText
        tagName="h2"
        value={attributes.heading}
        onChange={(heading) => setAttributes({heading})}
        placeholder="Heading…"
      />
    </div>
  );
}
```

```json title="block.json"
{
  "apiVersion": 3,
  "name": "acme/callout",
  "title": "Callout",
  "category": "design",
  "attributes": {"heading": {"type": "string", "source": "html", "selector": "h2"}},
  "editorScript": "file:./index.js",
  "render": "file:./render.php"
}
```

`block.json` is the single source of truth for a block's metadata. Prefer
**dynamic blocks** (`render.php`) for anything showing live data — a static
block bakes its markup into post content, so changing the template does not
update existing posts.

---

## The REST API and Headless

Every post type with `show_in_rest` is exposed automatically:

```text
GET  /wp-json/wp/v2/posts?per_page=10&_embed
GET  /wp-json/wp/v2/product?product_cat=42
POST /wp-json/wp/v2/posts          ← requires authentication
```

```php
// A custom endpoint.
add_action( 'rest_api_init', function () {
    register_rest_route( 'acme/v1', '/orders/(?P<id>\d+)', [
        'methods'             => 'GET',
        'callback'            => 'acme_get_order',
        'permission_callback' => function ( WP_REST_Request $request ) {
            return current_user_can( 'read_shop_order', $request['id'] );
        },
        'args'                => [
            'id' => [ 'validate_callback' => 'is_numeric' ],
        ],
    ] );
} );
```

**`permission_callback` is mandatory.** Omitting it triggers a warning and, more
importantly, leaves the endpoint open. Returning `'__return_true'` is a
deliberate declaration that the endpoint is public — never a default.

For headless, **WPGraphQL** is often preferred over REST: one request for
exactly the fields you need, instead of several REST calls plus `_embed`. Either
way, the tradeoff is real — you gain a modern front end and lose the live
preview, plugin front-end output, and much of what non-technical editors expect.

---

## Setup and Tooling

```bash
# Local development
npx @wp-now/wp-now start          # zero-config, instant
# or
wp-env start                       # Docker-based, closer to production

# WP-CLI — indispensable
wp core update
wp plugin list --status=active
wp db export backup.sql
wp search-replace 'old.test' 'new.com' --dry-run
wp cron event list
```

Manage the whole site with Composer so deployments are reproducible:

```json title="composer.json"
{
  "require": {
    "php": ">=8.2",
    "johnpbloch/wordpress": "^7.0",
    "wpackagist-plugin/wordpress-seo": "^24.0"
  },
  "repositories": [{"type": "composer", "url": "https://wpackagist.org"}]
}
```

This is how a WordPress site stops being "whatever is on the server". Core,
plugins and themes are declared, version-controlled and installed identically
everywhere. See [Composer](/knowledge-base/composer).

**Never edit core, and never edit a plugin directly** — the next update
overwrites it. Use hooks; if a plugin offers no hook, submit one upstream or
fork it deliberately.

---

## Security

WordPress's reputation for insecurity is overwhelmingly about **plugins and
neglect**, not core. Core is well audited and auto-updates; a site running
fourteen abandoned plugins is not.

The rules that matter:

```php
// 1. Escape on OUTPUT, every time, matching the context.
echo esc_html( $title );
echo esc_attr( $css_class );
echo esc_url( $link );
echo wp_kses_post( $rich_text );     // allows safe HTML

// 2. Sanitise on INPUT.
$email = sanitize_email( $_POST['email'] ?? '' );
$slug  = sanitize_title( $_POST['slug'] ?? '' );

// 3. Verify a nonce on every state-changing request.
if ( ! isset( $_POST['_wpnonce'] ) || ! wp_verify_nonce( $_POST['_wpnonce'], 'save_order' ) ) {
    wp_die( 'Invalid request' );
}

// 4. Check capabilities — never roles.
if ( ! current_user_can( 'edit_post', $post_id ) ) {
    wp_die( 'Insufficient permissions' );
}

// 5. Prepare every query.
global $wpdb;
$results = $wpdb->get_results(
    $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}orders WHERE user_id = %d", $user_id )
);
```

All five are needed together. A nonce proves the request came from your form; a
capability check proves this user is allowed to do it. **A nonce is not
authorisation** — that mistake is extremely common.

Operationally:

- **Keep core, plugins and themes updated.** Enable auto-updates for core.
- **Audit plugins before installing**: last update date, active installs, open
  issues. Every plugin is code running with full site privileges.
- **Disable file editing**: `define( 'DISALLOW_FILE_EDIT', true );` — otherwise
  an admin compromise is instant code execution.
- **Limit login attempts** and require strong passwords with 2FA for admins.
- **Restrict `xmlrpc.php`** unless something needs it; it is a persistent
  brute-force target.
- **Least-privilege database user** — the application does not need `DROP`.

See [XSS](/knowledge-base/security/xss) and
[SQL Injection](/knowledge-base/security/sql-injection).

---

## Performance

WordPress is fast when the database is not doing unnecessary work.

**Page caching is the single biggest win.** A cached page skips PHP and MySQL
entirely — orders of magnitude faster than any query tuning. Use a plugin
(WP Super Cache, W3 Total Cache), or better, cache at the server or CDN layer.
See [CDN](/knowledge-base/hosting/cdn) and
[Caching](/knowledge-base/operations/caching).

**Object caching** with Redis or Memcached keeps repeated queries out of MySQL
within a request and across requests:

```php
$stats = wp_cache_get( 'order_stats', 'acme' );
if ( false === $stats ) {
    $stats = expensive_calculation();
    wp_cache_set( 'order_stats', $stats, 'acme', HOUR_IN_SECONDS );
}
```

**Transients** are the persistent equivalent, stored in `wp_options` (or the
object cache when one is configured):

```php
$feed = get_transient( 'acme_external_feed' );
if ( false === $feed ) {
    $feed = wp_remote_retrieve_body( wp_remote_get( $url ) );
    set_transient( 'acme_external_feed', $feed, 15 * MINUTE_IN_SECONDS );
}
```

Other things that matter:

- **Never query in a loop.** `WP_Query` with `'update_post_meta_cache' => true`
  primes meta for the whole result set in one query.
- **Avoid `posts_per_page => -1`.** On a large site it is an out-of-memory
  error waiting to happen.
- **`meta_query` does not scale.** Use taxonomies for anything you filter by
  often.
- **WP-Cron runs on page loads**, so it is unreliable on a low-traffic site and
  a tax on a busy one. Disable it and use a real cron:

  ```php
  define( 'DISABLE_WP_CRON', true );
  ```

  ```bash
  * * * * * cd /var/www/site && wp cron event run --due-now
  ```

- **Enqueue assets properly**, and only where needed:

  ```php
  add_action( 'wp_enqueue_scripts', function () {
      if ( is_singular( 'product' ) ) {
          wp_enqueue_script( 'acme-product', get_theme_file_uri( 'build/product.js' ), [], '1.0', true );
      }
  } );
  ```

- **Profile with Query Monitor.** It shows every query, hook and HTTP request
  for the page, and usually identifies the problem in seconds.

---

## Do's and Don'ts

### Do

- Use hooks; never edit core or plugin files.
- Return a value from every filter.
- Escape on output with the function matching the context.
- Verify a nonce **and** check a capability on state-changing requests.
- Use `$wpdb->prepare()` for every query with a variable.
- Define the design system in `theme.json`.
- Use custom post types and taxonomies for structured content.
- Manage core and plugins with Composer.
- Install Query Monitor in development.

### Don't

- Don't use meta queries for anything you filter by frequently.
- Don't use `posts_per_page => -1`.
- Don't forget `wp_reset_postdata()` after a custom `WP_Query`.
- Don't treat a nonce as an authorisation check.
- Don't check roles (`user_can('administrator')`); check capabilities.
- Don't leave `DISALLOW_FILE_EDIT` unset.
- Don't install a plugin without checking when it was last updated.
- Don't run PHP 7.4 in production because WordPress permits it.

---

## Debugging

| Symptom                                  | Cause and fix                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| White screen of death                    | A PHP fatal error. Set `WP_DEBUG` and `WP_DEBUG_LOG`, then read `wp-content/debug.log`.  |
| Content disappears after adding a filter | The filter has no `return`.                                                              |
| "Headers already sent"                   | Whitespace after `?>` in a PHP file. Omit the closing tag entirely.                      |
| Template tags show the wrong post        | A custom `WP_Query` without `wp_reset_postdata()`.                                       |
| Changes not visible                      | Page cache, object cache or a CDN. Flush all three.                                      |
| REST endpoint returns 401                | Missing or failing `permission_callback`, or no nonce on a cookie-authenticated request. |
| Site slow with no obvious cause          | Query Monitor. Usually a meta query or a plugin issuing HTTP requests on every load.     |
| Scheduled task never runs                | WP-Cron needs traffic. Move to a real cron.                                              |
| Block not appearing in the editor        | `block.json` not registered, or the build output is missing.                             |

```php title="wp-config.php (development only)"
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', false );
define( 'SCRIPT_DEBUG', true );
define( 'SAVEQUERIES', true );
```

---

## FAQ

**Is WordPress a good choice in 2026?**
For content-led sites with non-technical editors, yes — nothing else matches its
editing experience and ecosystem. For a web application, use an application
framework.

**Block themes or classic themes?**
Block themes for new projects. Classic themes remain supported and are still the
right choice when you are extending an existing classic codebase.

**Should I go headless?**
Only for a specific reason — an existing React front end, or shared content
across several applications. You lose preview, plugin front-end output and a
good deal of what editors expect, and you gain a second application to maintain.

**ACF or native custom fields?**
ACF is ubiquitous and excellent for building editor interfaces. Native meta with
`register_post_meta` is more portable and works properly with the REST API and
block editor. Many teams use both.

**How do I avoid plugin bloat?**
Ask what each plugin does that fifty lines in your theme would not, and audit
quarterly. Twenty plugins is twenty codebases running with full privileges.

**PHP version?**
8.2 or later. WordPress permits 7.4, but PHP 7.4 is end-of-life and unsupported
upstream.

---

## Check your understanding

<Quiz
question="After adding this filter, product pages render with no content at all. Why?"
options={[
{
text: 'The filter does not return a value, so the content becomes null',
correct: true,
why: 'A filter receives a value and must return one. Without a return, WordPress uses the null return value as the new content — the page renders empty rather than erroring.',
},
{text: 'the_content cannot be filtered on singular pages', why: 'It can, and this is the standard hook for modifying post content.'},
{text: 'The priority argument is missing', why: 'Priority defaults to 10; omitting it is fine.'},
{text: 'is_singular() cannot be called inside a filter', why: 'Conditional tags work normally inside content filters.'},
]}
explanation={<>The most common WordPress mistake, and a quiet one — no error, just missing output. Any callback added with <code>add_filter</code> must return a value on every code path.</>}
reference={{label: 'Hooks', href: '/knowledge-base/wordpress#hooks'}}>

```php
add_filter( 'the_content', function ( $content ) {
    if ( is_singular( 'product' ) ) {
        $content .= '<p>Free delivery over £50.</p>';
    }
} );
```

</Quiz>

<Quiz
question="A form handler verifies a nonce before deleting a post. Is that sufficient protection?"
options={[
{
text: 'No — a nonce proves the request came from your form, but not that this user is permitted to delete the post. A capability check is also required.',
correct: true,
why: 'Nonces defend against CSRF. Authorisation is a separate question, answered by current_user_can( "delete_post", $post_id ).',
},
{text: 'Yes — nonces are WordPress’s authorisation mechanism', why: 'They are a CSRF mechanism. Any logged-in user can obtain a valid nonce for a form they are shown.'},
{text: 'Yes, provided the nonce action string is unique per post', why: 'Uniqueness improves the CSRF protection and still says nothing about permissions.'},
{text: 'No — it needs sanitisation instead', why: 'Sanitisation cleans input values. It does not establish who may perform the action.'},
]}
explanation={<>The pair is always needed: <code>wp_verify_nonce()</code> for "did this request come from my form?" and <code>current_user_can()</code> for "may this user do it?". Check capabilities, never roles.</>}
reference={{label: 'Security', href: '/knowledge-base/wordpress#security'}}
/>

<Quiz
question="A product archive filters by three custom fields using meta_query and takes 8 seconds with 20,000 products. What is the correct fix?"
options={[
{
text: 'Model the filterable attributes as taxonomies, or move them to a custom table — wp_postmeta has no index on meta_value',
correct: true,
why: 'postmeta is an EAV table. Each meta_query condition adds a self-join over an unindexed value column, so cost grows sharply with rows and conditions.',
},
{text: 'Add posts_per_page => -1 so everything is fetched in one query', why: 'That removes pagination and loads 20,000 posts into memory — considerably worse.'},
{text: 'Enable object caching', why: 'Helps repeat requests but does nothing for the first, and filter combinations mean low cache-hit rates.'},
{text: 'Increase PHP memory_limit', why: 'The bottleneck is query time in MySQL, not PHP memory.'},
]}
explanation={<>Taxonomies are indexed and designed for filtering; meta is designed for arbitrary per-post data. Choosing meta for faceted filtering is one of the most common causes of a slow WordPress site.</>}
reference={{label: 'Performance', href: '/knowledge-base/wordpress#performance'}}
/>

<Quiz
question="Which of these are genuine risks of registering a REST route without a permission_callback?"
type="multiple"
options={[
{text: 'The endpoint is publicly accessible to unauthenticated callers', correct: true, why: 'With no permission callback there is nothing to reject the request. It is open to anyone who finds the URL.'},
{text: 'WordPress emits a _doing_it_wrong notice', correct: true, why: 'Core warns because omitting it is almost always a mistake rather than an intentional public endpoint.'},
{text: 'Sensitive data can be enumerated by iterating ids', correct: true, why: 'Without a permission check, an id parameter lets a caller walk through every record the callback can reach.'},
{text: 'The route will not be registered at all', why: 'It registers and works — which is precisely the problem.'},
{text: 'Nonces are automatically enforced instead', why: 'Nonce checking applies to cookie-authenticated requests and is not a substitute for a permission callback.'},
]}
explanation={<>If an endpoint is genuinely public, say so explicitly with <code>'permission_callback' =&gt; '__return_true'</code>. That is a visible decision a reviewer can question, rather than an omission nobody notices.</>}
reference={{label: 'The REST API and headless', href: '/knowledge-base/wordpress#the-rest-api-and-headless'}}
/>

<Quiz
question="A page using a custom WP_Query renders correctly, but the sidebar underneath shows the wrong post's title. What is missing?"
options={[
{
text: 'wp_reset_postdata() after the custom loop, to restore the global post object',
correct: true,
why: 'the_post() overwrites the global $post. Template tags afterwards read that global, so without a reset they describe the last post of the custom query.',
},
{text: 'A unique query variable name for the custom WP_Query', why: 'The variable name is irrelevant; the problem is the global state that the_post() mutates.'},
{text: 'The sidebar should use get_sidebar() instead of direct template tags', why: 'It would still read the same corrupted global.'},
{text: 'The custom query needs suppress_filters => true', why: 'That controls whether query filters apply, not global post state.'},
]}
explanation={<>WordPress's template tags read global state, which is why they take so few arguments — and why <code>wp_reset_postdata()</code> after every secondary loop is mandatory.</>}
reference={{label: 'The Loop', href: '/knowledge-base/wordpress#the-loop'}}
/>

---

## References

- [WordPress Developer Resources](https://developer.wordpress.org/) — the
  authoritative reference for hooks, functions and APIs.
- [Block Editor Handbook](https://developer.wordpress.org/block-editor/) —
  blocks, `block.json`, `theme.json`.
- [Theme Handbook](https://developer.wordpress.org/themes/) — template
  hierarchy and block themes.
- [Plugin Security](https://developer.wordpress.org/plugins/security/) —
  escaping, sanitising, nonces and capabilities.
- [WP-CLI](https://wp-cli.org/) — the command-line interface.
- [Query Monitor](https://querymonitor.com/) — the debugging plugin worth
  installing first.
- [WPGraphQL](https://www.wpgraphql.com/) — for headless projects.
