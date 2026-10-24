{% if values.withCms -%}
// `ng serve` proxy: /cms/ and /uploads/ behave as nginx does in the cluster
// (nginx-app.conf) — Strapi's /api/ with the token added here, GET only, its
// user and auth endpoints refused. STRAPI_URL (default http://localhost:1337)
// and STRAPI_API_TOKEN come from the shell; neither reaches the bundle. Without
// a token /cms/ answers an empty 200 with X-Cms: off, as an unconfigured
// environment does.
const token = process.env.STRAPI_API_TOKEN ?? '';
const target = process.env.STRAPI_URL || 'http://localhost:1337';
const refused = /^\/cms\/(users|users-permissions|auth|connect|upload)(\/|\?|$)/;

export default {
  '/cms/': {
    target,
    changeOrigin: true,
    pathRewrite: { '^/cms/': '/api/' },
    headers: token ? { authorization: `Bearer ${token}`, cookie: '' } : {},
    bypass(req, res) {
      if (!token) {
        res.writeHead(200, { 'content-type': 'application/json', 'x-cms': 'off', 'cache-control': 'no-store' });
        res.end('{"data":null,"meta":{"cms":"off"}}');
        return false;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(403, { 'x-cms': 'strapi' });
        res.end();
        return false;
      }
      if (refused.test(req.url ?? '')) {
        res.writeHead(404, { 'x-cms': 'strapi' });
        res.end();
        return false;
      }
      return undefined;
    },
  },
  '/uploads/': { target, changeOrigin: true, headers: { cookie: '' } },
};
{%- else -%}
// Content from Strapi is off for this app (scaffolded with withCms: false), so
// `ng serve` proxies nothing.
export default {};
{%- endif %}
