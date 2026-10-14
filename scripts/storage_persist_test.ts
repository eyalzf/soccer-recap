/**
 * Zero-quota unit test for the storage layer (lib/recap/persist.ts).
 *
 * Two modes (persist.ts reads its env at module load, so the R2 phase
 * runs in a child process with the storage env already set):
 *
 *  - default: Phase 1 checks the in-memory fallback semantics; then it
 *    starts a local fake implementing the storage-worker protocol and
 *    spawns the child (`r2-child`) against it, asserting the wire-level
 *    behaviour afterwards (key prefixing, auth header, deletes).
 *  - `r2-child`: runs against STORAGE_API_URL from the environment and
 *    exercises pset/pget/plist/pdel through the R2 path.
 *
 * The Blob archive fallback is NOT covered (needs a real Blob token);
 * it is a read-only try/catch path in pget/pdel.
 *
 * Run: npx tsx scripts/storage_persist_test.ts
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}`, extra ?? '');
  }
};

async function childMain() {
  const p = await import('../lib/recap/persist');
  check('r2: backend is r2', p.storageBackend() === 'r2');
  check('r2: configured', p.storageConfigured() === true);
  await p.pset('game/v10/la-liga/a-b-2026-01-01', { results: [1, 2] });
  const back = await p.pget<{ results: number[] }>('game/v10/la-liga/a-b-2026-01-01');
  check('r2: round-trip', back?.val.results.length === 2, back);
  check('r2: fetchedAt set', typeof back?.fetchedAt === 'number');
  const page = await p.plist('game/v10/');
  check(
    'r2: plist strips prefix',
    page.items.length === 1 &&
      page.items[0].pathname === 'game/v10/la-liga/a-b-2026-01-01' &&
      typeof page.items[0].uploadedAt === 'number',
    page
  );
  await p.pdel(['game/v10/la-liga/a-b-2026-01-01']);
  check(
    'r2: pget after delete -> null',
    (await p.pget('game/v10/la-liga/a-b-2026-01-01')) === null
  );
  console.log(failures === 0 ? 'CHILD ALL PASS' : `CHILD ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  // ---------- Phase 1: memory fallback ----------
  delete process.env.STORAGE_API_URL;
  delete process.env.STORAGE_API_SECRET;
  delete process.env.STORAGE_PREFIX;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const mem = await import('../lib/recap/persist');
  check('memory: backend is memory', mem.storageBackend() === 'memory');
  check('memory: not configured', mem.storageConfigured() === false);
  await mem.pset('test/mem.json', { hello: 'world' });
  const got = await mem.pget<{ hello: string }>('test/mem.json');
  check('memory: round-trip', got?.val.hello === 'world', got);
  check('memory: fetchedAt set', typeof got?.fetchedAt === 'number');
  check('memory: missing -> null', (await mem.pget('test/nope.json')) === null);
  const memList = await mem.plist('test/');
  check('memory: plist empty page', memList.items.length === 0 && !memList.hasMore);
  await mem.pdel(['test/mem.json']); // must not throw in memory mode
  check('memory: pdel no-op does not throw', true);

  // ---------- Phase 2: fake R2 storage worker + child ----------
  const objects = new Map<string, { body: string; uploadedAt: number }>();
  const seenAuth: string[] = [];
  const seenPutKeys: string[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seenAuth.push(req.headers.authorization ?? '');
      const payload = JSON.parse(raw);
      const send = (obj: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (payload.op === 'get') {
        const o = objects.get(payload.key);
        send(o ? { exists: true, body: o.body } : { exists: false });
      } else if (payload.op === 'put') {
        seenPutKeys.push(payload.key);
        objects.set(payload.key, { body: payload.body, uploadedAt: Date.now() });
        send({ ok: true });
      } else if (payload.op === 'list') {
        const items = [...objects.entries()]
          .filter(([k]) => k.startsWith(payload.prefix))
          .map(([k, v]) => ({ pathname: k, uploadedAt: v.uploadedAt }));
        send({ items, hasMore: false });
      } else if (payload.op === 'del') {
        for (const k of payload.keys) objects.delete(k);
        send({ ok: true });
      } else {
        res.writeHead(400);
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  // Async spawn: the fake worker lives in THIS process, so a blocking
  // spawn would deadlock the child's storage calls against it.
  const childResult = await new Promise<{ code: number | null }>((resolve) => {
    const child = spawn(
      'npx',
      ['-y', 'tsx', 'scripts/storage_persist_test.ts', 'r2-child'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          STORAGE_API_URL: `http://127.0.0.1:${port}`,
          STORAGE_API_SECRET: 'test-secret',
          STORAGE_PREFIX: 'preview',
          BLOB_READ_WRITE_TOKEN: '',
        },
        stdio: 'inherit',
      }
    );
    const killer = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ code });
    });
  });
  check('r2: child passed', childResult.code === 0, childResult.code);
  check(
    'r2: key prefixed on the wire',
    seenPutKeys.length >= 1 &&
      seenPutKeys.every((k) => k === 'preview/game/v10/la-liga/a-b-2026-01-01'),
    seenPutKeys
  );
  check('r2: objects all deleted by child end', objects.size === 0, [...objects.keys()]);
  check(
    'r2: auth header sent on every call',
    seenAuth.length >= 4 && seenAuth.every((a) => a === 'Bearer test-secret'),
    seenAuth
  );

  server.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('r2-child')) {
  childMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
