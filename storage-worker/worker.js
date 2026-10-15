/**
 * Soccer Recap storage Worker — the app's only door to its Cloudflare R2
 * bucket.
 *
 * Why a Worker instead of S3 credentials in the app: the bucket is bound
 * to this Worker (binding `BUCKET`), so no S3 access keys exist anywhere.
 * The Vercel app authenticates with one shared secret (Worker secret
 * `STORAGE_SECRET`, mirrored as the app's STORAGE_API_SECRET env var).
 *
 * Protocol: POST / with a JSON body and `Authorization: Bearer <secret>`.
 *   { op: 'get',  key }                 -> { exists, body? }   (body = raw stored string)
 *   { op: 'put',  key, body }           -> { ok: true }
 *   { op: 'list', prefix, cursor?, limit? }
 *                                       -> { items: [{ pathname, uploadedAt }], cursor?, hasMore }
 *   { op: 'del',  keys: [...] }         -> { ok: true }
 * GET / (no auth) returns { ok: true, service: 'soccer-recap-storage' }
 * as a liveness probe; it exposes no data.
 *
 * Deploy (account-level, done by the agent via the Cloudflare API, not by
 * `npm run build`): PUT /accounts/<id>/workers/scripts/soccer-recap-storage
 * with metadata bindings:
 *   [{ name: 'BUCKET', type: 'r2_bucket', bucket_name: 'soccer-recap' },
 *    { name: 'STORAGE_SECRET', type: 'secret_text', text: '<secret>' }]
 * and the workers.dev subdomain route enabled.
 */

const MAX_KEY_LEN = 1024;
const MAX_BODY_LEN = 8 * 1024 * 1024; // largest record is a day of search log / a deep playlist cache
const MAX_LIST_LIMIT = 1000;
const MAX_DEL_KEYS = 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function validKey(key) {
  return (
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= MAX_KEY_LEN &&
    !key.startsWith('/') &&
    !key.includes('\0')
  );
}

export default {
  async fetch(req, env) {
    if (req.method === 'GET') {
      return json({ ok: true, service: 'soccer-recap-storage' });
    }
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    if (!env.STORAGE_SECRET) return json({ error: 'secret not configured' }, 503);
    if (req.headers.get('authorization') !== `Bearer ${env.STORAGE_SECRET}`) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (!env.BUCKET) return json({ error: 'bucket not bound' }, 503);

    let payload;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }

    try {
      switch (payload?.op) {
        case 'get': {
          if (!validKey(payload.key)) return json({ error: 'invalid key' }, 400);
          const obj = await env.BUCKET.get(payload.key);
          if (!obj) return json({ exists: false });
          const body = await obj.text();
          return json({ exists: true, body });
        }
        case 'put': {
          if (!validKey(payload.key)) return json({ error: 'invalid key' }, 400);
          if (typeof payload.body !== 'string' || payload.body.length > MAX_BODY_LEN) {
            return json({ error: 'invalid body' }, 400);
          }
          await env.BUCKET.put(payload.key, payload.body, {
            httpMetadata: { contentType: 'application/json' },
          });
          return json({ ok: true });
        }
        case 'list': {
          const prefix = payload.prefix ?? '';
          if (typeof prefix !== 'string' || prefix.length > MAX_KEY_LEN) {
            return json({ error: 'invalid prefix' }, 400);
          }
          const limit = Math.min(
            Math.max(1, Number(payload.limit) || MAX_LIST_LIMIT),
            MAX_LIST_LIMIT
          );
          const res = await env.BUCKET.list({
            prefix,
            cursor: payload.cursor || undefined,
            limit,
          });
          return json({
            items: res.objects.map((o) => ({
              pathname: o.key,
              uploadedAt: o.uploaded.getTime(),
            })),
            hasMore: res.truncated,
            cursor: res.truncated ? res.cursor : undefined,
          });
        }
        case 'del': {
          const keys = payload.keys;
          if (
            !Array.isArray(keys) ||
            keys.length > MAX_DEL_KEYS ||
            !keys.every(validKey)
          ) {
            return json({ error: 'invalid keys' }, 400);
          }
          if (keys.length) await env.BUCKET.delete(keys);
          return json({ ok: true });
        }
        default:
          return json({ error: 'unknown op' }, 400);
      }
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  },
};
