// End-to-end: `prismbox` running on examples/vite-hero, driven in real Chromium (WebGL via SwiftShader).
// Run: pnpm build && pnpm e2e    (needs Playwright's Chromium: npx playwright install chromium)
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const example = path.join(repo, 'examples', 'vite-hero');
const heroFile = path.join(example, 'src', 'Hero3D.tsx');
const SHOTS = process.env.E2E_SHOTS ? path.resolve(process.env.E2E_SHOTS) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok ' : 'XX '} ${name}${ok ? '' : `\n      -> ${String(detail).slice(0, 400)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 15000, every = 100, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}
const readHero = () => readFileSync(heroFile);
// an external tool saving the file (write a temp file, rename it over the original), so Vite never reads a half-written file
const saveExternally = (text) => {
  const tmp = `${heroFile}.ext-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, heroFile);
};
const changedLines = (a, b) => {
  const x = a.toString().split('\n');
  const y = b.toString().split('\n');
  if (x.length !== y.length) return { count: -1, lines: [] };
  const lines = x.map((l, i) => (l !== y[i] ? { n: i + 1, before: l, after: y[i] } : null)).filter(Boolean);
  return { count: lines.length, lines };
};

// ---------------- start prismbox on the example ----------------
const ORIGINAL = readHero();
const gitStatus = () => execFileSync('git', ['status', '--porcelain', '--', 'examples/vite-hero'], { cwd: repo, encoding: 'utf8' });
const STATUS_BEFORE = gitStatus();
const cli = spawn(process.execPath, [path.join(repo, 'packages', 'bridge', 'dist', 'cli.js'), '--root', example, '--no-open', '--port', '4173'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
cli.stdout.on('data', (d) => (out += d));
cli.stderr.on('data', (d) => (out += d));
const stopAll = async (browser) => {
  await browser?.close().catch(() => undefined);
  cli.kill();
  await sleep(300);
  writeFileSync(heroFile, ORIGINAL); // never leave the example modified
};

let browser;
try {
  const urls = await until(() => {
    const studio = /studio\s+(http:\/\/\S+)/.exec(out)?.[1];
    const page = /your page\s+(http:\/\/\S+)/.exec(out)?.[1];
    return studio && page ? { studio, page } : null;
  }, { timeout: 60000, what: 'prismbox to print its URLs' });
  console.log(`prismbox is up: page ${urls.page}  studio ${urls.studio.replace(/token=.*/, 'token=…')}\n`);

  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 820 } });
  const consoleErrors = [];
  const watch = (p, label) => {
    p.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${label}: ${m.text().slice(0, 200)}`));
    p.on('pageerror', (e) => consoleErrors.push(`${label}: ${String(e).slice(0, 200)}`));
  };

  // ======== 1. open the real landing page and Studio ========
  const page = await ctx.newPage();
  watch(page, 'page');
  await page.goto(urls.page);
  await page.waitForFunction(() => window.__prismDebug?.info().connected === true, null, { timeout: 60000 });
  await page.evaluate(() => { window.__marker = 'alive'; });
  const studio = await ctx.newPage();
  watch(studio, 'studio');
  await studio.goto(urls.studio);
  await until(async () => /page connected/.test(await studio.textContent('[data-testid=conn]').catch(() => '')), { timeout: 30000, what: 'Studio to see the page' });
  check('1. the real landing page and Studio are open and connected', true);
  check('1. Studio stripped the session token from the URL', !studio.url().includes('token'), studio.url());
  const info0 = await page.evaluate(() => window.__prismDebug.info());
  check('1. the overlay mounted in the page with one canvas and no errors', info0.canvases === 1 && info0.connected, JSON.stringify(info0));
  const heroSrc = ORIGINAL.toString();
  const lineOf = (needle) => {
    const i = heroSrc.indexOf(needle);
    return `src/Hero3D.tsx:${heroSrc.slice(0, i).split('\n').length}:${i - heroSrc.lastIndexOf('\n', i - 1)}`;
  };
  const KNOT = lineOf('<mesh name="knot"');
  const modeText = async () => (await studio.textContent('[data-testid=mode]')).trim();
  const heroClicks = () => page.evaluate(() => ({ ...window.__heroClicks }));
  const knotPoint = () => page.evaluate(() => window.__prismDebug.hitPointOf('knot'));

  // ======== 2. disarmed: the page behaves normally and forged proposals are refused ========
  check('2. Studio starts Disarmed', (await modeText()) === 'Disarmed', await modeText());
  const kp = await knotPoint();
  await page.mouse.move(kp.x, kp.y);
  await page.mouse.click(kp.x, kp.y);
  await sleep(200);
  const c2 = await heroClicks();
  check('2. disarmed: the page\'s own onClick on the 3D mesh fires', (c2['knot.click'] ?? 0) === 1, JSON.stringify(c2));
  const cta = page.locator('button.primary');
  await cta.click();
  check('2. disarmed: the CTA button works', (await page.evaluate(() => window.__ctaClicks)) === 1);
  const before2 = readHero();
  const forged = await page.evaluate(([tag]) => window.__prismDebug.forgeProposal(tag, { position: { from: [0, 0, 0], to: [9, 9, 9] } }), [KNOT]);
  check('2. a forged page proposal while disarmed is rejected by the daemon (DISARMED)', forged.ok === false && forged.code === 'DISARMED', JSON.stringify(forged));
  await sleep(300);
  check('2. ... and Hero3D.tsx is untouched', readHero().equals(before2));
  check('2. ... and Studio tells you', /not armed/.test(await studio.textContent('.banner').catch(() => '')), await studio.textContent('.banner').catch(() => 'no banner'));
  await studio.locator('.banner button').click().catch(() => undefined);

  // ======== 3. arm, drag the mesh on the REAL page ========
  await studio.click('button.arm');
  await page.waitForFunction(() => window.__prismDebug.info().armed === true, null, { timeout: 10000 });
  check('3. arming Studio arms the page overlay', (await modeText()) === 'Armed');
  const heroBeforeDrag = readHero();
  const clicksBefore = await heroClicks();
  const kp2 = await knotPoint();
  await page.mouse.move(kp2.x, kp2.y);
  await page.mouse.click(kp2.x, kp2.y);
  await until(async () => (await page.evaluate(() => window.__prismDebug.info().selected)) === KNOT, { what: 'the pick' });
  check('3. clicking the mesh on the real page resolves its file:line:col', true, KNOT);
  await until(async () => (await studio.textContent('.inspector .node-name').catch(() => '')) === 'knot', { what: 'Studio selection' });
  check('3. Studio selects the same node (tree + inspector)', (await studio.textContent('.tree-row.selected .tree-name')) === 'knot');
  check('3. armed: the page\'s onClick / onPointerDown on that mesh did NOT fire', JSON.stringify(await heroClicks()) === JSON.stringify(clicksBefore), JSON.stringify(await heroClicks()));
  // only the 3D scene is paused: ordinary page controls keep working while armed
  const cb = await cta.boundingBox();
  await page.mouse.click(cb.x + 10, cb.y + 10);
  await sleep(150);
  check('3. armed: only the 3D scene is paused (ordinary page controls still work)', (await page.evaluate(() => window.__ctaClicks)) === 2);
  await page.mouse.click(40, 760); // empty space deselects
  // re-select the knot (the empty-space click deselected it)
  const kp3 = await knotPoint();
  await page.mouse.click(kp3.x, kp3.y);
  await until(async () => (await page.evaluate(() => window.__prismDebug.info().selected)) === KNOT, { what: 're-pick' });

  // find and press the X handle
  let grab = null;
  for (let attempt = 0; attempt < 8 && !grab; attempt++) {
    const c = await page.evaluate(() => window.__prismDebug.screenPointOf('knot'));
    let t0 = null;
    for (let t = 24; t <= 240 && t0 === null; t += 4) {
      await page.mouse.move(c.x + t, c.y);
      if ((await page.evaluate(() => window.__prismDebug.gizmoAxis())) === 'X') t0 = t;
    }
    if (t0 === null) continue;
    await sleep(120);
    check('3. d9: animation freezes while the gizmo handle is hovered', attempt > 0 || (await page.evaluate(() => window.__prismDebug.frozen())) === true);
    await page.mouse.down();
    await sleep(60);
    if ((await page.evaluate(() => window.__prismDebug.gizmoAxis())) === 'X') grab = { x: c.x + t0, y: c.y };
    else await page.mouse.up();
  }
  check('3. the gizmo handle can be grabbed on the real page', !!grab);
  const e1 = await page.evaluate(() => window.__prismDebug.info().clockElapsed);
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(grab.x + i * 9, grab.y);
    await sleep(35);
  }
  const e2 = await page.evaluate(() => window.__prismDebug.info().clockElapsed);
  check('3. d9: the R3F clock is frozen for the whole drag (no jitter source)', e1 === e2, `${e1} vs ${e2}`);
  check('3. ... and Studio shows "Paused while you edit"', (await studio.locator('.chip.paused').count()) === 1);
  check('3. nothing was written during the drag (one proposal, at drag end)', readHero().equals(heroBeforeDrag));
  await page.mouse.up();
  const afterDrag = await until(() => (readHero().equals(heroBeforeDrag) ? null : readHero()), { timeout: 15000, what: 'the edit to reach disk' });
  const d3 = changedLines(heroBeforeDrag, afterDrag);
  check('3. exactly ONE line of Hero3D.tsx changed on real disk', d3.count === 1, JSON.stringify(d3));
  check('3. ... it is the knot\'s position, written with magic-string (no reformat)', /<mesh name="knot" position=\{\[[-\d., ]+\]\} onClick/.test(d3.lines[0]?.after ?? ''), d3.lines[0]?.after);
  const newPos = (/position=\{\[([-\d., ]+)\]\}/.exec(d3.lines[0].after)[1]).split(',').map(Number);
  await until(async () => {
    const p = await page.evaluate(() => window.__prismDebug.localPosition('knot'));
    return p && p.every((v, i) => Math.abs(v - newPos[i]) < 0.002);
  }, { what: 'Vite HMR to apply the new position' });
  check('3. Vite HMR updated the real page (no reload, same object value)', (await page.evaluate(() => window.__marker)) === 'alive');
  const d3strip = await studio.locator('.diff-row').first();
  check('3. Studio shows the diff tagged "page"', (await d3strip.locator('.author').textContent()) === 'page' && /position=/.test(await d3strip.locator('.hunk.add').textContent()), await d3strip.textContent());
  const e3 = await page.evaluate(() => window.__prismDebug.info().clockElapsed);
  await sleep(400);
  check('3. d9: animation resumes cleanly after release', (await page.evaluate(() => window.__prismDebug.info().clockElapsed)) > e3 && (await page.evaluate(() => window.__prismDebug.frozen())) === false);
  const afterStep3 = readHero();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'real-page-armed.png') });
  if (SHOTS) await studio.screenshot({ path: path.join(SHOTS, 'studio-armed.png') });

  // ======== 4. scrub a @prism uniform in Studio ========
  await studio.locator('.tree-row .tree-name', { hasText: /^film$/ }).click();
  const field = studio.locator('.field', { has: studio.locator('.field-label', { hasText: /^uFilm$/ }) });
  const slider = field.locator('input[type=range]');
  await slider.waitFor();
  const sb = await slider.boundingBox();
  await studio.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height / 2);
  await studio.mouse.down();
  await studio.mouse.move(sb.x + sb.width * 0.8, sb.y + sb.height / 2, { steps: 8 });
  await sleep(150);
  const liveUniform = await page.evaluate(() => window.__prismDebug.uniform('knot', 'uFilm'));
  check('4. scrubbing updates the real page live, before anything is written', typeof liveUniform === 'number' && Math.abs(liveUniform - 1.4) > 0.1 && readHero().equals(afterStep3), String(liveUniform));
  await studio.mouse.up();
  const afterUniform = await until(() => (readHero().equals(afterStep3) ? null : readHero()), { timeout: 15000, what: 'the uniform edit to reach disk' });
  const d4 = changedLines(afterStep3, afterUniform);
  check('4. exactly one line changed: the uFilm literal', d4.count === 1 && /uFilm: \{ value: [\d.]+ \}/.test(d4.lines[0].after) && d4.lines[0].before.includes('uFilm: { value: 1.4 }'), JSON.stringify(d4));
  const newFilm = Number(/uFilm: \{ value: ([\d.]+) \}/.exec(d4.lines[0].after)[1]);
  await until(async () => Math.abs((await page.evaluate(() => window.__prismDebug.uniform('knot', 'uFilm'))) - newFilm) < 0.001, { what: 'HMR to apply the uniform' });
  check('4. Vite HMR applied it to the real page (no reload)', (await page.evaluate(() => window.__marker)) === 'alive');
  await until(async () => (await studio.locator('.diff-row').count()) >= 2, { what: 'the uniform diff row' });
  const rows4 = await studio.locator('.diff-row').evaluateAll((els) => els.map((el) => `${el.querySelector('.author')?.textContent}:${el.querySelector('.diff-summary')?.textContent}`));
  check('4. Studio logs it as an edit by "you"', rows4[0] === 'you:uniform uFilm', JSON.stringify(rows4));

  // ======== 5. undo from Studio restores the exact bytes ========
  await until(async () => !(await studio.locator('.diff-strip button', { hasText: 'Undo' }).isDisabled()), { what: 'Undo to enable' });
  await studio.locator('.diff-strip button', { hasText: 'Undo' }).click();
  await until(() => readHero().equals(afterStep3), { what: 'first undo on disk' });
  check('5. Undo #1 restores the file byte-exact to its state before the uniform edit', readHero().equals(afterStep3));
  await until(async () => !(await studio.locator('.diff-strip button', { hasText: 'Undo' }).isDisabled()), { what: 'Undo to enable again' });
  await studio.locator('.diff-strip button', { hasText: 'Undo' }).click();
  await until(() => readHero().equals(ORIGINAL), { what: 'second undo on disk' });
  check('5. Undo #2 restores Hero3D.tsx byte-exact to the original', readHero().equals(ORIGINAL));
  await until(async () => Math.abs((await page.evaluate(() => window.__prismDebug.uniform('knot', 'uFilm'))) - 1.4) < 0.001, { what: 'HMR after undo' });
  check('5. ... and the real page followed (HMR)', (await page.evaluate(() => window.__marker)) === 'alive');

  // ======== 6. external edit (Claude Code, VS Code) ========
  const external = ORIGINAL.toString().replace('args={[1, 0.34, 400, 64, 2, 3]}', 'args={[1.1, 0.34, 400, 64, 2, 3]}');
  const oldHash = await studio.evaluate(() => window.__prismStudio.hash());
  saveExternally(external);
  await until(async () => /File reloaded/.test(await studio.textContent('.banner').catch(() => '')), { timeout: 10000, what: 'Studio to notice the external edit' });
  check('6. an external edit refreshes Studio live ("File reloaded")', true);
  await studio.locator('.tree-row .tree-name', { hasText: /^torusKnotGeometry$/ }).click();
  const argsField = studio.locator('.field', { has: studio.locator('.field-label', { hasText: /^args$/ }) });
  check('6. the inspector shows the externally edited value', (await argsField.locator('input').first().inputValue()) === '1.1', await argsField.textContent());
  check('6. the strip tags it "external"', (await studio.locator('.diff-row .author.external').count()) >= 1);
  // a write built on the old view of the file must be refused (compare-and-set)
  const before6 = readHero();
  await studio.evaluate(([h]) => window.__prismStudio.raw({ type: 'edit', id: 424242, file: 'src/Hero3D.tsx', baseHash: h, op: { kind: 'prop', node: 'knot', prop: 'scale', value: 3 } }), [oldHash]);
  await until(async () => /Conflict/.test(await studio.textContent('.banner').catch(() => '')), { timeout: 10000, what: 'the conflict banner' });
  check('6. a stale write is blocked by compare-and-set (CONFLICT banner)', true);
  check('6. ... and the file on disk is exactly what the other tool wrote', readHero().equals(before6) && readHero().toString() === external);
  // undo for the earlier edits is unavailable (nothing to undo), and external bytes are never clobbered
  saveExternally(ORIGINAL);
  await until(async () => (await studio.locator('.diff-row').count()) >= 2, { what: 'external restore diff' });

  // ======== 7. production build: zero Prismbox bytes, clean git status ========
  cli.kill();
  await sleep(500);
  execFileSync('pnpm', ['exec', 'vite', 'build'], { cwd: example, stdio: 'pipe', shell: process.platform === 'win32' });
  const dist = path.join(example, 'dist');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const bad = ['__PrismOverlay', 'userData-prism', 'virtual:prism', 'prism-overlay', '__prismDebug', '__PRISMBOX_DAEMON__', '/__prism/', 'prismbox', 'Prismbox'];
  const hits = {};
  let bytes = 0;
  for (const f of walk(dist)) {
    const t = readFileSync(f, 'utf8');
    bytes += t.length;
    for (const s of bad) if (t.includes(s)) hits[s] = (hits[s] ?? 0) + 1;
  }
  check('7. `vite build` in examples/vite-hero: dist/ has 0 Prismbox bytes', Object.keys(hits).length === 0 && bytes > 100000, JSON.stringify({ hits, bytes }));
  const status = gitStatus();
  check('7. `git status` inside examples/vite-hero is unchanged by the whole session (nothing created or modified)', status === STATUS_BEFORE, `before: ${JSON.stringify(STATUS_BEFORE)} after: ${JSON.stringify(status)}`);
  const pkg = JSON.parse(readFileSync(path.join(example, 'package.json'), 'utf8'));
  check('7. the example has zero prismbox dependencies or config entries', !JSON.stringify(pkg).includes('prismbox') && !readFileSync(path.join(example, 'vite.config.ts'), 'utf8').toLowerCase().includes('prism'));

  const fatal = consoleErrors.filter((e) => !/Failed to load resource|WebSocket|net::ERR/.test(e));
  check('console: no errors in the page or Studio during the whole run', fatal.length === 0, fatal.join(' | '));
} catch (e) {
  check('run completed', false, e instanceof Error ? e.stack : String(e));
} finally {
  await stopAll(browser);
}
writeFileSync(path.join(repo, '.gstack', 'tmp', 'm2-e2e.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
