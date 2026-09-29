#!/usr/bin/env node
/**
 * Agent Kit visual-verify driver.
 *
 * Logs into the SPA through its real login form, then screenshots each route at
 * every configured viewport — or, with VV_VIDEO / VV_FLOW, records a short video
 * walkthrough per flow. Stack-agnostic: everything comes from environment
 * variables so the same driver serves a Vite project and a CRA project.
 *
 *   VV_BASE_URL        default http://localhost:5173
 *   VV_PAGES           comma-separated SPA paths, default "/"
 *   VV_LABEL           "before" | "after", default "after"
 *   VV_OUT_DIR         default screenshots/<branch-slug>/ for stills,
 *                      .agentkit/visual/<branch-slug>/ for video
 *   VV_VIEWPORTS       default "1280x800,375x812"
 *   VV_FULLPAGE        "1" for full-page instead of viewport-cropped
 *   VV_USER / VV_PASS  credentials for the login form
 *   VV_LOGIN_PATH      default /login
 *   VV_USER_SELECTOR / VV_PASS_SELECTOR / VV_SUBMIT_SELECTOR
 *   VV_SETTLE_MS       extra wait after navigation, default 1200
 *
 * Video (P9 — uploaded to the Hub, never committed):
 *
 *   VV_VIDEO           "1": record one clip per route in VV_PAGES
 *   VV_FLOW            path to a walkthrough file; records one clip per flow
 *                      (implies VV_VIDEO):
 *                        {"flows": [{"criterion": 1, "label": "Undo a match",
 *                                    "steps": [{"goto": "/payables"},
 *                                              {"click": "text=Undo"},
 *                                              {"fill": ["#q", "abc"]},
 *                                              {"press": ["#q", "Enter"]},
 *                                              {"waitFor": "text=Unmatched"},
 *                                              {"pause": 800}]}]}
 *                      Steps: goto (a path, never a URL), click, hover,
 *                      fill, press, select, waitFor, pause (ms).
 *   VV_VIDEO_VIEWPORT  default 1280x800 — one viewport; a person watches it
 *
 * Every file written is also printed as one JSON line —
 * {"path", "phase", "criterion", "label", "ok"} — so a stage can upload each
 * one with `hub_events.py media`. A flow also leaves a still of its final
 * state beside its clip, because the model checking the work can read an
 * image and cannot watch a video.
 *
 * Exits non-zero when login fails, a page never settles or a flow's step
 * fails, so a caller can tell a broken capture from a captured break. A failed
 * flow still keeps its clip: it shows where the flow stopped.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const env = process.env;
const BASE_URL = (env.VV_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const PAGES = (env.VV_PAGES || '/').split(',').map((p) => p.trim()).filter(Boolean);
const LABEL = env.VV_LABEL || 'after';
const FULLPAGE = env.VV_FULLPAGE === '1';
const LOGIN_PATH = env.VV_LOGIN_PATH || '/login';
const SETTLE_MS = Number(env.VV_SETTLE_MS || 1200);
const parseViewport = (v) => {
  const [width, height] = v.trim().split('x').map(Number);
  return { width, height };
};
const VIEWPORTS = (env.VV_VIEWPORTS || '1280x800,375x812').split(',').map(parseViewport);
const VIDEO = env.VV_VIDEO === '1' || Boolean(env.VV_FLOW);
const VIDEO_VIEWPORT = parseViewport(env.VV_VIDEO_VIEWPORT || '1280x800');
// Long enough between actions for a person to see what was clicked, and at the
// end for the result to register before the clip stops.
const STEP_PAUSE_MS = 500;
const END_PAUSE_MS = 1500;
const STEP_TIMEOUT_MS = 10000;

function branchSlug() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return branch.replace(/[^a-zA-Z0-9._-]+/g, '-');
  } catch {
    return 'detached';
  }
}

// Video defaults to .agentkit/, which is gitignored: a clip must never reach a
// commit (P9 D9.7), and screenshots/ is tracked on purpose.
const OUT_DIR = env.VV_OUT_DIR || path.join(VIDEO ? path.join('.agentkit', 'visual') : 'screenshots', branchSlug());
const slug = (p) => (p === '/' ? 'root' : p.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]+/g, '-'));
const labelSlug = (text, fallback) =>
  String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || fallback;
const size = (v) => `${v.width}x${v.height}`;
const samePath = (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, '');
const onLoginPage = (page) => samePath(new URL(page.url()).pathname, LOGIN_PATH);

function report(file, phase, criterion, label, ok = true, error = undefined) {
  const line = { path: file, phase, criterion: criterion ?? null, label, ok };
  if (error) line.error = error;
  console.log(JSON.stringify(line));
}

async function findFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) return locator;
  }
  return null;
}

async function login(page) {
  if (!env.VV_USER || !env.VV_PASS) {
    console.log('visual-verify: no VV_USER/VV_PASS, capturing unauthenticated');
    return;
  }
  await page.goto(BASE_URL + LOGIN_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE_MS);

  const user = await findFirst(page, [
    env.VV_USER_SELECTOR,
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[type="text"]',
  ].filter(Boolean));
  const pass = await findFirst(page, [
    env.VV_PASS_SELECTOR,
    'input[name="password"]',
    'input[type="password"]',
  ].filter(Boolean));

  if (!user || !pass) {
    throw new Error(`login form not found at ${LOGIN_PATH}: set VV_USER_SELECTOR / VV_PASS_SELECTOR`);
  }

  await user.fill(env.VV_USER);
  await pass.fill(env.VV_PASS);

  const submit = await findFirst(page, [
    env.VV_SUBMIT_SELECTOR,
    'button[type="submit"]',
    'input[type="submit"]',
    'form button',
  ].filter(Boolean));

  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    submit ? submit.click() : pass.press('Enter'),
  ]);
  await page.waitForTimeout(SETTLE_MS);

  if (onLoginPage(page)) {
    throw new Error('login did not navigate away from the login page: check the credentials and the user\'s access flags');
  }
  console.log(`visual-verify: logged in as ${env.VV_USER}, landed on ${new URL(page.url()).pathname}`);
}

// ---------------------------------------------------------------- stills

async function captureStills(browser) {
  let failed = 0;
  let written = 0;
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.warn(`  page error: ${e.message}`));

    await login(page);

    for (const route of PAGES) {
      const target = BASE_URL + route;
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(SETTLE_MS);
        const file = path.join(OUT_DIR, `${LABEL}__${slug(route)}__${size(viewport)}.png`);
        await page.screenshot({ path: file, fullPage: FULLPAGE });
        written += 1;
        console.log(`  captured ${route} @ ${size(viewport)} -> ${file}`);
        report(file, ['before', 'after'].includes(LABEL) ? LABEL : null, null, `${route} @ ${size(viewport)}`);
      } catch (err) {
        failed += 1;
        console.error(`  FAILED ${route} @ ${size(viewport)}: ${err.message}`);
      }
    }
    await context.close();
  }
  console.log(`visual-verify: ${written} image(s) in ${OUT_DIR}${failed ? `, ${failed} failed` : ''}`);
  return failed;
}

// ---------------------------------------------------------------- video

const STEPS = {
  goto: (v) => typeof v === 'string' && v.startsWith('/'),
  click: (v) => typeof v === 'string' && v.length > 0,
  hover: (v) => typeof v === 'string' && v.length > 0,
  waitFor: (v) => typeof v === 'string' && v.length > 0,
  fill: (v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string'),
  press: (v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string'),
  select: (v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string'),
  pause: (v) => Number.isInteger(v) && v >= 0 && v <= 10000,
};

/** The flows to record, checked before a browser starts. A bad file is the caller's to fix. */
function loadFlows() {
  if (!env.VV_FLOW) {
    return PAGES.map((route) => ({ label: route, steps: [{ goto: route }] }));
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(env.VV_FLOW, 'utf8'));
  } catch (err) {
    throw new Error(`VV_FLOW ${env.VV_FLOW}: ${err.message}`);
  }
  const flows = data && data.flows;
  if (!Array.isArray(flows) || flows.length === 0) {
    throw new Error(`VV_FLOW ${env.VV_FLOW}: expected {"flows": [ … ]} with at least one flow`);
  }
  flows.forEach((flow, i) => {
    const where = `VV_FLOW flow ${i + 1}`;
    if (flow.criterion !== undefined && !(Number.isInteger(flow.criterion) && flow.criterion >= 1)) {
      throw new Error(`${where}: criterion is the 1-based number of an acceptance criterion`);
    }
    if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
      throw new Error(`${where}: steps must be a non-empty list`);
    }
    flow.steps.forEach((step, j) => {
      const keys = step && typeof step === 'object' ? Object.keys(step) : [];
      const [kind] = keys;
      if (keys.length !== 1 || !STEPS[kind] || !STEPS[kind](step[kind])) {
        // goto takes a path so a flow cannot leave the local stack: this
        // driver logs in, and with a seeded user it writes data.
        throw new Error(`${where} step ${j + 1}: ${JSON.stringify(step)} is not one of `
          + 'goto "/path", click/hover/waitFor "selector", fill/press/select ["selector", "value"], pause ms');
      }
    });
  });
  return flows;
}

async function gotoPath(page, route) {
  const go = async () => {
    await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
  };
  await go();
  if (env.VV_USER && env.VV_PASS && onLoginPage(page) && !samePath(route, LOGIN_PATH)) {
    // The app keeps its session per tab (sessionStorage), so the login done on
    // its own page did not carry over. Log in here, on camera, and go again.
    await login(page);
    await go();
  }
  await page.waitForTimeout(SETTLE_MS);
}

async function runStep(page, step) {
  const [kind] = Object.keys(step);
  const value = step[kind];
  const at = (selector) => page.locator(selector).first();
  const timeout = STEP_TIMEOUT_MS;
  switch (kind) {
    case 'goto': return gotoPath(page, value);
    case 'click': return at(value).click({ timeout });
    case 'hover': return at(value).hover({ timeout });
    case 'fill': return at(value[0]).fill(value[1], { timeout });
    case 'press': return at(value[0]).press(value[1], { timeout });
    case 'select': return at(value[0]).selectOption(value[1], { timeout });
    case 'waitFor': return at(value).waitFor({ state: 'visible', timeout });
    case 'pause': return page.waitForTimeout(value);
    default: throw new Error(`unknown step ${kind}`);
  }
}

async function recordFlow(browser, flow, index, rawDir) {
  const label = flow.label || `flow ${index}`;
  const stem = `walkthrough__${index}__${labelSlug(flow.label, `flow-${index}`)}__${size(VIDEO_VIEWPORT)}`;
  const video = path.join(OUT_DIR, `${stem}.webm`);
  const still = path.join(OUT_DIR, `${stem}.png`);
  const context = await browser.newContext({
    viewport: VIDEO_VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: rawDir, size: VIDEO_VIEWPORT },
  });
  // Every page of a recording context gets a clip of its own. Logging in on a
  // separate page keeps the login form out of the clip a person watches, and
  // the session it sets is shared by the context.
  let loginPage = null;
  if (env.VV_USER && env.VV_PASS) {
    loginPage = await context.newPage();
    await login(loginPage);
    await loginPage.close();
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => console.warn(`  page error: ${e.message}`));

  let error = null;
  for (const [j, step] of flow.steps.entries()) {
    try {
      await runStep(page, step);
      if (!('pause' in step)) await page.waitForTimeout(STEP_PAUSE_MS);
    } catch (err) {
      error = `step ${j + 1} ${JSON.stringify(step)}: ${err.message.split('\n')[0]}`;
      break;
    }
  }
  await page.waitForTimeout(END_PAUSE_MS);
  await page.screenshot({ path: still }).catch(() => {});
  // The clip is only written out when its context closes.
  await context.close();
  fs.renameSync(await page.video().path(), video);
  if (loginPage) await loginPage.video().delete().catch(() => {});

  if (error) console.error(`  FAILED ${label}: ${error}`);
  else console.log(`  recorded ${label} @ ${size(VIDEO_VIEWPORT)} -> ${video}`);
  report(video, 'walkthrough', flow.criterion, label, !error, error || undefined);
  if (fs.existsSync(still)) report(still, 'after', flow.criterion, `${label} — final state`, !error);
  return error ? 1 : 0;
}

async function recordFlows(browser, flows) {
  const rawDir = path.join(OUT_DIR, '.recording');
  let failed = 0;
  for (const [i, flow] of flows.entries()) {
    failed += await recordFlow(browser, flow, i + 1, rawDir);
  }
  fs.rmSync(rawDir, { recursive: true, force: true });
  console.log(`visual-verify: ${flows.length - failed} of ${flows.length} walkthrough(s) in ${OUT_DIR}`);
  return failed;
}

// ---------------------------------------------------------------- main

(async () => {
  let flows = null;
  if (VIDEO) {
    const top = path.relative(process.cwd(), path.resolve(OUT_DIR)).split(path.sep)[0];
    if (top === 'screenshots') {
      console.error('visual-verify: refusing to record video under screenshots/, which is committed. '
        + 'Video goes to the Hub, never into git — leave VV_OUT_DIR unset or point it under .agentkit/.');
      process.exit(2);
    }
    try {
      flows = loadFlows();
    } catch (err) {
      console.error(`visual-verify: ${err.message}`);
      process.exit(2);
    }
  }

  // Loaded after the inputs are checked, so a bad flow file is named even where
  // Playwright is not installed yet.
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    console.error('visual-verify: playwright is not installed. Run: npm install -D playwright && npx playwright install chromium');
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  let failed = 0;
  try {
    failed = VIDEO ? await recordFlows(browser, flows) : await captureStills(browser);
  } catch (err) {
    console.error(`visual-verify: ${err.message}`);
    await browser.close();
    process.exit(1);
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
