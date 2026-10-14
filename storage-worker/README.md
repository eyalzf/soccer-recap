# Storage Worker (Cloudflare R2 gateway)

The app's persistent storage lives in a Cloudflare **R2** bucket named
`soccer-recap`. The Vercel app never talks to R2's S3 API directly — it
calls this Worker, which holds the bucket as a native binding, so no S3
credentials exist anywhere.

- Worker name: `soccer-recap-storage`
- URL: `https://soccer-recap-storage.eyalzf.workers.dev`
- Bindings: `BUCKET` (r2_bucket → `soccer-recap`), `STORAGE_SECRET`
  (secret_text)
- App env vars (Vercel, production + preview): `STORAGE_API_URL`,
  `STORAGE_API_SECRET` (same secret). Preview additionally sets
  `STORAGE_PREFIX=preview`, which namespaces every key under `preview/`
  in the same bucket; production keys are unprefixed and mirror the old
  Vercel Blob pathnames.

While `BLOB_READ_WRITE_TOKEN` remains set on the app, `lib/recap/persist.ts`
also reads the old Blob store as a read-only archive fallback (deny list,
candidate decisions, settled caches written before the migration), and
deletes remove the Blob copy too. Once that state has fully carried over,
the Blob token can be removed from Vercel and the fallback becomes inert.

The protocol is documented at the top of `worker.js`. Redeploying the
Worker is an account-level action via the Cloudflare API (upload script +
bindings metadata); it is not part of the Vercel build.
