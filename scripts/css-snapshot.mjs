// Computed-style snapshot of the whole UI, to prove that a CSS change does not change the look.
//   node scripts/css-snapshot.mjs <port> <out-dir> --verify [--rev <git-rev>] [--coverage]
//        the usual check: the CSS of <git-rev> (default HEAD) against the working tree
//   node scripts/css-snapshot.mjs <port> <out-dir> [--rev <git-rev>] [--coverage] [--only <regex>]
//        [--workers <n>]                       one capture
//   node scripts/css-snapshot.mjs --compare <dir-before> <dir-after> [--limit <n>]
// Server for <port> (another than 4317), on a copy of the data, background work off:
//   node scripts/backup-catalog.mjs <scratch>/copy.sqlite
//   BOOKFLIP_LOCAL_PORT=4398 BOOKFLIP_CATALOG_DB=<scratch>/copy.sqlite BOOKFLIP_CATALOG_AUTO_RESOLVE=0
//   BOOKFLIP_DETAIL_ENRICHMENT=0 BOOKFLIP_SCHEDULED_SCANS=0 BOOKFLIP_OFFER_LIFECYCLE=0 BOOKFLIP_E_ISBN=0
//   BOOKFLIP_EDITION_GAPS=0 BOOKFLIP_AUTO_BACKUP=0 BOOKFLIP_CATALOG_SEEDS=0 BOOKFLIP_STARTER_PROFILES=0
//   BOOKFLIP_BUYBACK_AUTO=0 node local-app.mjs --no-open
// --verify: a state counts as different only if it differs again in two fresh captures of both
// sides (the app has a few asynchronous races); a full run takes about 1.5 h with 7 workers.
// Capture: every view (and the states that do not show by themselves: dialogs, the command palette,
// open details, review focus mode, the batch grid, "Odrzuć z regułą…", empty lists, hover and focus
// of the main controls) at 390, 1100, 1440 and 1920 px, light and dark theme, with and without
// trading mode. For every element (and its ::before, ::after, ::marker, ::placeholder, ::backdrop)
// the computed style is stored, keyed by the element's path in the DOM tree. Each element stores only
// the properties whose value differs from its parent's, so equal files mean equal computed styles.
// --rev serves app/index.html and the CSS files of that git revision instead of the working tree
// (the JavaScript stays as it is): "before" and "after" run on the same server, data and clock.
// --coverage also writes coverage.json: the style rules whose selector matched no element in any
// captured state (with its media query active) — the snapshot does not protect those rules.
// Run against a server on a copy of the data with background jobs off (see CLAUDE.md).
// Needs playwright (see CLAUDE.md).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { settle, trackRequests } from './page-settle.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const positional = args.filter(
  (arg, index) =>
    !arg.startsWith('--') &&
    !['--rev', '--only', '--workers', '--limit', '--compare'].includes(args[index - 1]),
);

// ---------------------------------------------------------------------------------------------
// States

const WIDTHS = [390, 1100, 1440, 1920];
const HEIGHT = { 390: 844, 1100: 800, 1440: 900, 1920: 1080 };
const THEMES = ['light', 'dark'];
const TRADING = [false, true];
const FIXED_NOW = new Date('2026-11-13T09:00:00Z');

/** Clicks a navigation entry the way the user does (the sidebar is hidden on phones). */
async function view(page, name) {
  await page.evaluate((target) => {
    const button =
      document.querySelector(`.sidebar [data-view="${target}"]`) ||
      document.querySelector(`.mobile-bottom-nav [data-view="${target}"]`);
    button?.click();
  }, name);
  await quiet(page);
}
async function queue(page, type) {
  await view(page, 'queue');
  await click(page, `#queueTypes [data-queue-type="${type}"]`);
}
/** Clicks the first match through the DOM (works for elements outside the viewport too). */
async function click(page, selector, { wait = true } = {}) {
  const found = await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return false;
    element.click();
    return true;
  }, selector);
  if (wait) await quiet(page);
  return found;
}
async function openDetails(page, scope) {
  await page.evaluate((root) => {
    document.querySelectorAll(`${root} details`).forEach((details) => (details.open = true));
  }, scope);
  await quiet(page);
}
async function type(page, selector, text) {
  await page.evaluate(
    ([target, value]) => {
      const input = document.querySelector(target);
      if (!input) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [selector, text],
  );
  await page.waitForTimeout(500);
  await quiet(page);
}
async function quiet(page) {
  await page.waitForTimeout(150);
  if (!(await stable(page))) (page.__warnings ||= []).push('DOM still changing after 10 s');
}
/**
 * Waits until no request runs and the DOM has not changed for a while: images that load or fail
 * replace their placeholders, and details that arrive late are drawn. False after the timeout.
 */
async function stable(page, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await settle(page, { quietMs: 300, timeoutMs: 5000 });
    const calm = await page.evaluate(() => performance.now() - (window.__lastMutation || 0) > 1000);
    if (calm && !page.__inflight.size) return true;
    await page.waitForTimeout(150);
  }
  return false;
}
/** Hover / keyboard focus on the first visible match; the capture covers its parent's subtree. */
function pointer(kind, selector) {
  return async (page) => {
    await stable(page);
    const handle = await page.evaluateHandle((target) => {
      const visible = (element) => {
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          box.bottom > 0 &&
          box.top < innerHeight &&
          box.right > 0 &&
          box.left < innerWidth &&
          getComputedStyle(element).visibility !== 'hidden'
        );
      };
      return [...document.querySelectorAll(target)].find(visible) || null;
    }, selector);
    const element = handle.asElement();
    if (!element) return null;
    if (kind === 'hover') await element.hover({ force: true, timeout: 2000 }).catch(() => {});
    else {
      await page.keyboard.press('Shift'); // keyboard modality, so :focus-visible applies
      await element.evaluate((node) => node.focus({ focusVisible: true }));
    }
    await page.waitForTimeout(100);
    return element.evaluateHandle((node) => node.parentElement || node);
  };
}

// name → steps; each state starts on a freshly loaded page. A step may return an element handle:
// then only that subtree is captured (hover and focus states).
const STATES = {
  today: async (page) => view(page, 'today'),
  'today-tile': async (page) => click(page, '#todayBody .today-tile'),
  scanner: async (page) => view(page, 'scanner'),
  'scanner-details': async (page) => {
    await view(page, 'scanner');
    await openDetails(page, '#view-scanner');
  },
  review: async (page) => queue(page, 'review'),
  'review-open': async (page) => {
    await queue(page, 'review');
    await click(page, '#reviewList .review-item');
  },
  'review-proposal': async (page) => {
    await queue(page, 'review');
    await click(page, '#reviewList .review-item');
    await click(page, '#reviewProposals .rv-cand');
  },
  'review-more': async (page) => {
    await queue(page, 'review');
    await click(page, '#reviewList .review-item');
    await page.evaluate(() => {
      const more = document.querySelector('#reviewDetail .rv-more');
      if (more) more.open = true;
    });
  },
  'review-focus': async (page) => {
    await queue(page, 'review');
    await click(page, '#reviewList .review-item');
    await click(page, '#reviewFocusToggle');
  },
  'review-menu': async (page) => {
    await queue(page, 'review');
    await openDetails(page, '.review-toolbar');
  },
  'review-select': async (page) => {
    await queue(page, 'review');
    await click(page, '#reviewSelectToggle');
    await click(page, '#reviewList input[type=checkbox], #reviewList .review-item');
  },
  'review-reject-rule': async (page) => {
    await queue(page, 'review');
    await click(page, '#reviewList .review-item');
    await click(page, '#rejectWithRule');
  },
  'review-photo-zoom': async (page) => {
    await queue(page, 'review');
    await click(page, '#reviewList .review-item');
    await click(page, '#reviewDetail [data-photo-zoom]');
  },
  'review-search-empty': async (page) => {
    await queue(page, 'review');
    await type(page, '#reviewSearch', 'zzzz-brak-wynikow-qq');
  },
  ...Object.fromEntries(
    ['quick', 'add', 'noisbn', 'bundle', 'games', 'other'].map((tab) => [
      'review-tab-' + tab,
      async (page) => {
        await queue(page, 'review');
        await click(page, `#reviewTabs [data-review-tab="${tab}"]`);
      },
    ]),
  ),
  sets: async (page) => queue(page, 'sets'),
  'sets-open': async (page) => {
    await queue(page, 'sets');
    await click(page, '#setList [data-set-id]');
    await openDetails(page, '#view-sets');
  },
  'sets-empty': async (page) => {
    await queue(page, 'sets');
    await type(page, '#setFilter', 'zzzz-brak-wynikow-qq');
  },
  conflicts: async (page) => queue(page, 'conflicts'),
  duplicates: async (page) => queue(page, 'duplicates'),
  catalog: async (page) => view(page, 'catalog'),
  'catalog-open': async (page) => {
    await view(page, 'catalog');
    await click(page, '#catalogList [data-catalog-id]');
    await openDetails(page, '#catalogDetail');
  },
  'catalog-edition': async (page) => {
    await view(page, 'catalog');
    await click(page, '#catalogList [data-catalog-id]');
    // On a phone the work page sometimes draws again over the first click: click until it shows.
    for (let attempt = 0; attempt < 4; attempt++) {
      await click(page, '#catalogDetail [data-edition-detail]');
      if (await page.locator('#backToWork').count()) break;
    }
  },
  'catalog-grid': async (page) => {
    await view(page, 'catalog');
    await click(page, '[data-catalog-view="grid"]');
  },
  'catalog-series': async (page) => {
    await view(page, 'catalog');
    await click(page, '[data-catalog-view="series"]');
    await click(page, '#catalogList button, #catalogList [data-series-id], #catalogList summary');
  },
  'catalog-tools': async (page) => {
    await view(page, 'catalog');
    await openDetails(page, '#view-catalog');
    await page.waitForTimeout(800);
    await quiet(page);
  },
  'catalog-empty': async (page) => {
    await view(page, 'catalog');
    await type(page, '#catalogSearch', 'zzzz-brak-wynikow-qq');
  },
  'catalog-dialog': async (page) => {
    await view(page, 'catalog');
    await click(page, '#openCatalogForm');
  },
  'catalog-dialog-manual': async (page) => {
    await view(page, 'catalog');
    await click(page, '#openCatalogForm');
    await click(page, '[data-catalog-mode="manual"]');
  },
  offers: async (page) => view(page, 'offers'),
  'offers-open': async (page) => {
    await view(page, 'offers');
    await click(page, '#offersTableBody [data-offer-id], #offersMobileList [data-mobile-offer-id]');
    await page.waitForTimeout(400);
    await openDetails(page, '#offerDrawer');
  },
  'offers-filters': async (page) => {
    await view(page, 'offers');
    await openDetails(page, '#view-offers');
  },
  'offers-empty': async (page) => {
    await view(page, 'offers');
    await type(page, '#offerSearch', 'zzzz-brak-wynikow-qq');
  },
  settings: async (page) => view(page, 'settings'),
  'settings-details': async (page) => {
    await view(page, 'settings');
    await openDetails(page, '#view-settings');
  },
  palette: async (page) => {
    await page.keyboard.press('Control+k');
    await quiet(page);
  },
  'palette-query': async (page) => {
    await page.keyboard.press('Control+k');
    await page.keyboard.type('sol');
    await page.waitForTimeout(400);
    await quiet(page);
  },
  'confirm-dialog': async (page) => {
    await page.evaluate(() => {
      void import('/core/dialogs.js').then((module) =>
        module.confirmDialog('Czy na pewno?', { title: 'Potwierdź', danger: true }),
      );
    });
    await quiet(page);
  },
  'density-compact': async (page) => {
    await page.evaluate(() => {
      localStorage.setItem('bookflip.density', 'compact');
      document.body.classList.add('density-compact');
    });
    await queue(page, 'review');
  },
  'density-compact-catalog': async (page) => {
    await page.evaluate(() => {
      localStorage.setItem('bookflip.density', 'compact');
      document.body.classList.add('density-compact');
    });
    await view(page, 'catalog');
  },
  'hover-nav': pointer('hover', '.sidebar .nav-item:not(.active), .mobile-nav-item:not(.active)'),
  'focus-nav': pointer('focus', '.sidebar .nav-item, .mobile-nav-item'),
  'hover-primary': pointer('hover', '.view:not([hidden]) .button.primary'),
  'focus-primary': pointer('focus', '.view:not([hidden]) .button.primary'),
  'hover-secondary': pointer('hover', '.view:not([hidden]) .button.secondary'),
  'focus-secondary': pointer('focus', '.view:not([hidden]) .button.secondary'),
  'hover-review-item': async (page) => {
    await queue(page, 'review');
    return pointer('hover', '#reviewList .review-item:not(.active)')(page);
  },
  'focus-review-item': async (page) => {
    await queue(page, 'review');
    return pointer('focus', '#reviewList .review-item')(page);
  },
  'hover-review-tab': async (page) => {
    await queue(page, 'review');
    return pointer('hover', '#reviewTabs .rv-tab:not(.is-active)')(page);
  },
  'hover-review-action': async (page) => {
    await queue(page, 'review');
    await click(page, '#reviewList .review-item');
    return pointer('hover', '#reviewDetail .lean-review-primary-actions .button.secondary')(page);
  },
  'focus-review-action': async (page) => {
    await queue(page, 'review');
    await click(page, '#reviewList .review-item');
    return pointer('focus', '#reviewDetail .lean-review-primary-actions .button')(page);
  },
  'hover-catalog-row': async (page) => {
    await view(page, 'catalog');
    return pointer('hover', '#catalogList [data-catalog-id]:not(.active)')(page);
  },
  'focus-catalog-search': async (page) => {
    await view(page, 'catalog');
    return pointer('focus', '#catalogSearch')(page);
  },
  'hover-offer-row': async (page) => {
    await view(page, 'offers');
    return pointer('hover', '#offersTableBody tr, #offersMobileList .mobile-offer')(page);
  },
  'hover-link': async (page) => {
    await view(page, 'scanner');
    return pointer('hover', '#view-scanner .link-button')(page);
  },
  'focus-summary': async (page) => {
    await view(page, 'settings');
    return pointer('focus', '#view-settings summary')(page);
  },
};

// ---------------------------------------------------------------------------------------------
// In-page capture

/**
 * Runs in the page. Returns [key, label, own, pseudo] per element, where `own` lists the properties
 * (index=value) that differ from the parent's computed value (the root lists all of them) and
 * `pseudo` the pseudo-elements that exist, each relative to the element itself.
 */
function captureInPage({ root }) {
  const sample = getComputedStyle(document.documentElement);
  const standard = [];
  for (let i = 0; i < sample.length; i++) if (!sample[i].startsWith('--')) standard.push(sample[i]);
  const custom = new Set();
  const collect = (rules) => {
    for (const rule of rules) {
      if (rule.style)
        for (let i = 0; i < rule.style.length; i++)
          if (rule.style[i].startsWith('--')) custom.add(rule.style[i]);
      if (rule.cssRules) collect(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      collect(sheet.cssRules);
    } catch {}
  }
  const props = [...standard.sort(), ...[...custom].sort()];
  const read = (style) => props.map((name) => style.getPropertyValue(name));
  const encode = (values, base) => {
    const parts = [];
    for (let i = 0; i < values.length; i++)
      if (!base || values[i] !== base[i]) parts.push(props[i] + ':' + values[i]);
    return parts.join('\n');
  };
  const out = [];
  // A path segment: the element's id, or its tag and position among siblings of that tag without
  // an id (elements with an id that arrive in a different order keep their keys).
  const stableId = (node) => node.id && !/^dialog-title-/.test(node.id);
  const segment = (node) => {
    if (stableId(node)) return '#' + node.id;
    let position = 0;
    for (const sibling of node.parentElement.children) {
      if (sibling.tagName === node.tagName && !stableId(sibling)) position++;
      if (sibling === node) break;
    }
    return node.tagName.toLowerCase() + position;
  };
  const visit = (element, key, parentValues) => {
    const values = read(getComputedStyle(element));
    const pseudo = [];
    const tag = element.tagName.toLowerCase();
    const candidates = ['::before', '::after'];
    if (tag === 'summary' || tag === 'li' || values[props.indexOf('display')] === 'list-item')
      candidates.push('::marker');
    if ((tag === 'input' || tag === 'textarea') && element.hasAttribute('placeholder'))
      candidates.push('::placeholder');
    if (tag === 'dialog' && element.open) candidates.push('::backdrop');
    for (const name of candidates) {
      const style = getComputedStyle(element, name);
      if ((name === '::before' || name === '::after') && /^(none|normal)$/.test(style.content))
        continue;
      pseudo.push(name + '\n' + encode(read(style), values));
    }
    const id = element.id && !/^dialog-title-/.test(element.id) ? '#' + element.id : '';
    const classes = typeof element.className === 'string' ? element.className.trim() : '';
    out.push([
      key,
      tag + id + (classes ? '.' + classes.split(/\s+/).slice(0, 4).join('.') : ''),
      encode(values, parentValues),
      pseudo,
    ]);
    const used = new Set();
    for (const child of element.children) {
      if (child.tagName === 'HEAD') continue;
      let childKey = key + '>' + segment(child);
      while (used.has(childKey)) childKey += '~';
      used.add(childKey);
      visit(child, childKey, values);
    }
  };
  const start = root || document.documentElement;
  let key = 'html';
  if (root) {
    const chain = [];
    for (let node = root; node && node !== document.documentElement; node = node.parentElement)
      chain.unshift(segment(node));
    key = ['html', ...chain].join('>');
  }
  visit(start, key, root?.parentElement ? read(getComputedStyle(root.parentElement)) : null);
  return out;
}

/** Runs in the page: keys of the style rules whose selector matches an element now. */
function coverageInPage() {
  const split = (text) => {
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && !depth) {
        parts.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(text.slice(start).trim());
    return parts;
  };
  // Dynamic states are not in the DOM when the snapshot runs: match without them.
  const loosen = (selector) =>
    selector
      .replace(/::?(?:before|after|marker|placeholder|backdrop|-webkit-[a-z-]+)\b/g, '')
      .replace(/:(?:hover|focus-visible|focus-within|focus|active|visited)\b/g, '')
      .replace(/:not\(\s*\)/g, '')
      .replace(/(^|[\s>+~(,])(?=$|[\s>+~),])/g, '$1*');
  const all = [];
  const matched = [];
  const walk = (rules, context, active) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        for (const selector of split(rule.selectorText)) {
          const key = context + ' | ' + selector;
          all.push(key);
          if (!active) continue;
          try {
            if (document.querySelector(loosen(selector))) matched.push(key);
          } catch {}
        }
      } else if (rule instanceof CSSMediaRule)
        walk(
          rule.cssRules,
          context + '@media ' + rule.media.mediaText + ' ',
          active && matchMedia(rule.media.mediaText).matches,
        );
      else if (rule instanceof CSSSupportsRule)
        walk(
          rule.cssRules,
          context + '@supports ' + rule.conditionText + ' ',
          active && CSS.supports(rule.conditionText),
        );
      else if (rule.cssRules && rule.conditionText !== undefined)
        walk(rule.cssRules, context + '@container ' + rule.conditionText + ' ', active);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, '', true);
    } catch {}
  }
  // Which selectors match the same element (media ignored): one sorted list per distinct element.
  const selectors = [...new Set(all.map((key) => key.slice(key.indexOf(' | ') + 3)))];
  const byElement = new Map();
  selectors.forEach((selector, index) => {
    let found = [];
    try {
      found = document.querySelectorAll(loosen(selector));
    } catch {}
    for (const element of found) {
      if (!byElement.has(element)) byElement.set(element, []);
      byElement.get(element).push(index);
    }
  });
  const signatures = [...new Set([...byElement.values()].map((list) => list.join(',')))];
  return { all, matched, selectors, signatures };
}

// ---------------------------------------------------------------------------------------------
// Capture driver

async function capture({ base, out, rev, coverage, only, workers }) {
  const revFiles = new Map();
  const fromRev = (path) => {
    if (!revFiles.has(path))
      try {
        revFiles.set(
          path,
          execFileSync('git', ['show', `${rev}:app/${path}`], { maxBuffer: 64 << 20 }),
        );
      } catch {
        revFiles.set(path, null);
      }
    return revFiles.get(path);
  };
  const configs = [];
  for (const width of WIDTHS)
    for (const theme of THEMES)
      for (const trading of TRADING) configs.push({ width, theme, trading });
  const jobs = [];
  for (const config of configs)
    for (const name of Object.keys(STATES)) {
      const id = `${name}@${config.width}-${config.theme}${config.trading ? '-trading' : ''}`;
      if (!only || only.test(id)) jobs.push({ id, name, config });
    }
  await mkdir(out, { recursive: true });
  const styles = new Map();
  const states = {};
  const cover = { all: new Set(), matched: new Set(), signatures: new Set() };
  const intern = (text) => {
    const hash = createHash('sha1').update(text).digest('base64url').slice(0, 16);
    styles.set(hash, text);
    return hash;
  };
  const browser = await chromium.launch();
  const started = Date.now();
  let done = 0;
  const failures = [];
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const { width, theme, trading } = job.config;
      const context = await browser.newContext({
        viewport: { width, height: HEIGHT[width] },
        colorScheme: theme,
        reducedMotion: 'no-preference',
      });
      await context.addInitScript(
        ([value, trade]) => {
          try {
            localStorage.setItem('bookflip.theme', value);
            if (trade) localStorage.setItem('bookflip.tradingMode', '1');
          } catch {}
          window.__lastMutation = 0;
          // Lazy images would load depending on timing: every image loads at once.
          new MutationObserver((records) => {
            window.__lastMutation = performance.now();
            for (const record of records)
              for (const node of record.addedNodes)
                if (node.nodeType === 1)
                  for (const image of node.tagName === 'IMG'
                    ? [node]
                    : node.querySelectorAll('img'))
                    if (image.loading === 'lazy') image.loading = 'eager';
          }).observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          // Toasts stay until the capture: whether one shows must not depend on timing.
          const remove = Element.prototype.remove;
          Element.prototype.remove = function () {
            if (!this.classList?.contains('toast')) remove.call(this);
          };
          let seed = 1234567;
          Math.random = () => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        },
        [theme, trading],
      );
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (/^\/api\/(image|cover)|^\/api\/offers\/[^/]+\/image/.test(url.pathname)) {
          // No shop or cover service is asked; a third of the images fail, like broken links.
          const hash = createHash('sha1')
            .update(url.pathname + url.search)
            .digest()[0];
          return hash % 3 === 0
            ? route.fulfill({ status: 404, body: '' })
            : route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
        }
        if (rev && (url.pathname === '/' || url.pathname === '/index.html')) {
          return route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: fromRev('index.html'),
          });
        }
        if (rev && url.pathname.endsWith('.css')) {
          const body = fromRev(url.pathname.slice(1));
          return body
            ? route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body })
            : route.fulfill({ status: 404, body: '' });
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.__inflight = trackRequests(page);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.setFixedTime(FIXED_NOW);
      try {
        await page.goto(base + '/', { waitUntil: 'load' });
        await stable(page);
        const subtree = await STATES[job.name](page);
        await quiet(page);
        await page.waitForTimeout(150);
        // Transitions end, endless animations stop at their start: the computed style is stable.
        await page.evaluate(() => {
          for (const animation of document.getAnimations()) {
            if (animation.effect?.getComputedTiming().iterations === Infinity) {
              animation.pause();
              animation.currentTime = 0;
            } else animation.finish();
          }
        });
        const root = subtree?.asElement ? subtree.asElement() : null;
        const list = await page.evaluate(captureInPage, { root });
        states[job.id] = list.map(([key, label, own, pseudo]) => [
          key,
          label,
          intern(own),
          pseudo.map((text) => intern(text)),
        ]);
        if (coverage) {
          const result = await page.evaluate(coverageInPage);
          result.all.forEach((key) => cover.all.add(key));
          result.matched.forEach((key) => cover.matched.add(key));
          for (const signature of result.signatures)
            cover.signatures.add(
              signature
                .split(',')
                .map((index) => result.selectors[index])
                .join('\n'),
            );
        }
        errors.push(...(page.__warnings || []));
        if (errors.length) failures.push(`${job.id}: ${errors.join(' | ')}`);
      } catch (error) {
        failures.push(`${job.id}: ${error.message.split('\n')[0]}`);
      }
      await context.close();
      done++;
      if (done % 20 === 0)
        console.log(`${done} states, ${Math.round((Date.now() - started) / 1000)} s`);
    }
  };
  try {
    await Promise.all(Array.from({ length: workers }, worker));
  } finally {
    await browser.close();
  }
  const sorted = Object.fromEntries(Object.entries(states).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(`${out}/states.json.gz`, gzipSync(JSON.stringify(sorted)));
  await writeFile(
    `${out}/styles.json.gz`,
    gzipSync(JSON.stringify(Object.fromEntries([...styles].sort()))),
  );
  if (coverage) {
    const unmatched = [...cover.all].filter((key) => !cover.matched.has(key)).sort();
    // Co-matching evidence: selector texts, and per distinct element the selectors it matched.
    const selectors = [...new Set([...cover.signatures].flatMap((text) => text.split('\n')))];
    const index = new Map(selectors.map((selector, position) => [selector, position]));
    const signatures = [...cover.signatures].map((text) =>
      text.split('\n').map((selector) => index.get(selector)),
    );
    await writeFile(
      `${out}/coverage.json`,
      JSON.stringify({ rules: cover.all.size, unmatched, selectors, signatures }) + '\n',
    );
    console.log(`coverage: ${unmatched.length} of ${cover.all.size} selectors matched nothing`);
  }
  await writeFile(`${out}/failures.json`, JSON.stringify(failures, null, 1) + '\n');
  console.log(
    `${Object.keys(sorted).length} states, ${styles.size} distinct styles, ` +
      `${failures.length} failures, ${Math.round((Date.now() - started) / 1000)} s → ${out}`,
  );
}

// 2×2 PNG served for every image (1×1 means "no cover" to the app).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGM4sWXaiS3TGCAUADrOCEmIUA/EAAAAAElFTkSuQmCC',
  'base64',
);

// ---------------------------------------------------------------------------------------------
// Compare

async function load(dir) {
  return {
    states: JSON.parse(gunzipSync(await readFile(`${dir}/states.json.gz`)).toString()),
    styles: JSON.parse(gunzipSync(await readFile(`${dir}/styles.json.gz`)).toString()),
  };
}

/** Full computed style of every element (own properties over the parent's), keyed by path. */
function resolve(list, styles) {
  const byKey = new Map();
  for (const [key, label, own, pseudo] of list) {
    const parent = byKey.get(key.slice(0, key.lastIndexOf('>')));
    const values = Object.create(parent ? parent.values : null);
    for (const line of styles[own] ? styles[own].split('\n') : [])
      if (line) values[line.slice(0, line.indexOf(':'))] = line.slice(line.indexOf(':') + 1);
    const pseudos = {};
    for (const hash of pseudo) {
      const [name, ...lines] = styles[hash].split('\n');
      const style = Object.create(values);
      for (const line of lines)
        if (line) style[line.slice(0, line.indexOf(':'))] = line.slice(line.indexOf(':') + 1);
      pseudos[name] = style;
    }
    byKey.set(key, { label, values, pseudos, sig: own + pseudo.join(','), parent });
  }
  return byKey;
}

function allProps(style) {
  const names = new Set();
  for (let level = style; level; level = Object.getPrototypeOf(level))
    for (const name of Object.keys(level)) names.add(name);
  return names;
}

async function compare(beforeDir, afterDir, limit) {
  const diffs = await differences(beforeDir, afterDir);
  report(diffs, afterDir, limit);
  return diffs.length ? 1 : 0;
}

function report(diffs, dir, limit, total = null) {
  const states = new Set(diffs.map((diff) => diff.state));
  for (const diff of diffs.slice(0, limit))
    console.log(`${diff.state}  ${diff.element}  ${diff.property}: ${diff.before} → ${diff.after}`);
  console.log(
    diffs.length
      ? `${diffs.length} differences in ${states.size} states (all in ${dir}/diff.json)`
      : `No differences${total ? `: ${total} states compared` : ''}.`,
  );
}

/**
 * Captures the revision (before) and the working tree (after) and compares them. The app has a few
 * asynchronous races (which request answers first, e.g. the counts on the scan result card); a
 * state counts as different only if it differs again each time both of its sides are captured
 * anew, up to `retries` times. A real CSS difference shows in every capture.
 */
async function verify({ base, out, rev, workers, only, coverage, retries = 2, limit = 40 }) {
  await capture({ base, out: out + '/before', rev, workers, only });
  await capture({ base, out: out + '/after', workers, only, coverage });
  let diffs = await differences(out + '/before', out + '/after');
  const total = Object.keys((await load(out + '/after')).states).length;
  for (let attempt = 1; attempt <= retries && diffs.length; attempt++) {
    const ids = [...new Set(diffs.map((diff) => diff.state))];
    console.log(`retry ${attempt}: ${ids.length} states differ, capturing them again`);
    const escape = (id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^(?:' + ids.map(escape).join('|') + ')$');
    const dir = `${out}/retry-${attempt}`;
    await capture({ base, out: dir + '/before', rev, workers, only: pattern });
    await capture({ base, out: dir + '/after', workers, only: pattern });
    const again = await differences(dir + '/before', dir + '/after');
    const still = new Set(again.map((diff) => diff.state));
    diffs = again.filter((diff) => still.has(diff.state) && ids.includes(diff.state));
  }
  await writeFile(`${out}/diff.json`, JSON.stringify(diffs, null, 1) + '\n');
  report(diffs, out, limit, total);
  return diffs.length ? 1 : 0;
}

/** Differences between two captures: [{ state, element, property, before, after }]. */
async function differences(beforeDir, afterDir) {
  const before = await load(beforeDir);
  const after = await load(afterDir);
  const diffs = [];
  const ids = [...new Set([...Object.keys(before.states), ...Object.keys(after.states)])].sort();
  for (const id of ids) {
    if (!before.states[id] || !after.states[id]) {
      diffs.push({
        state: id,
        element: '(state)',
        property: 'present',
        before: Boolean(before.states[id]),
        after: Boolean(after.states[id]),
      });
      continue;
    }
    if (JSON.stringify(before.states[id]) === JSON.stringify(after.states[id])) continue;
    const a = resolve(before.states[id], before.styles);
    const b = resolve(after.states[id], after.styles);
    const changed = new Set();
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(key);
      const y = b.get(key);
      if (!x || !y) {
        diffs.push({
          state: id,
          element: key + ' ' + (x || y).label,
          property: 'element',
          before: Boolean(x),
          after: Boolean(y),
        });
        continue;
      }
      // Same own styles and nothing changed above: the element is equal.
      const parentKey = key.slice(0, key.lastIndexOf('>'));
      if (x.sig === y.sig && !changed.has(parentKey)) continue;
      let differs = false;
      const pairs = [['', x.values, y.values]];
      for (const name of new Set([...Object.keys(x.pseudos), ...Object.keys(y.pseudos)]))
        pairs.push([name, x.pseudos[name], y.pseudos[name]]);
      for (const [pseudo, p, q] of pairs) {
        if (!p || !q) {
          differs = true;
          diffs.push({
            state: id,
            element: key + pseudo + ' ' + x.label,
            property: 'pseudo-element',
            before: Boolean(p),
            after: Boolean(q),
          });
          continue;
        }
        for (const name of new Set([...allProps(p), ...allProps(q)]))
          if (p[name] !== q[name]) {
            differs = true;
            diffs.push({
              state: id,
              element: key + pseudo + ' ' + x.label,
              property: name,
              before: p[name] ?? '(none)',
              after: q[name] ?? '(none)',
            });
          }
      }
      if (differs) changed.add(key);
    }
  }
  await writeFile(`${afterDir}/diff.json`, JSON.stringify(diffs, null, 1) + '\n');
  return diffs;
}

// ---------------------------------------------------------------------------------------------

if (args.includes('--verify')) {
  const [port = '4398', out = 'artifacts/css-snapshot/verify'] = positional;
  process.exitCode = await verify({
    base: `http://127.0.0.1:${port}`,
    out,
    rev: option('--rev') || 'HEAD',
    coverage: args.includes('--coverage'),
    only: option('--only') ? new RegExp(option('--only')) : null,
    workers: Number(option('--workers') || 4),
    limit: Number(option('--limit') || 40),
  });
} else if (args.includes('--compare')) {
  const before = option('--compare');
  const after = positional[0];
  if (!before || !after) throw Error('usage: --compare <dir-before> <dir-after>');
  process.exitCode = await compare(before, after, Number(option('--limit') || 40));
} else {
  const [port = '4398', out = 'artifacts/css-snapshot/run'] = positional;
  await capture({
    base: `http://127.0.0.1:${port}`,
    out,
    rev: option('--rev'),
    coverage: args.includes('--coverage'),
    only: option('--only') ? new RegExp(option('--only')) : null,
    workers: Number(option('--workers') || 4),
  });
}
