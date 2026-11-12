// Correctness rules only (formatting is Prettier's job). Globals are listed by hand, no extra
// dependency: Node for the server, tests and scripts; the browser for app/** and for the code that
// Playwright scripts run inside the page (page.evaluate callbacks).
const readonly = (names) => Object.fromEntries(names.map((name) => [name, 'readonly']));

// Shared by Node and the browser (WHATWG / web platform APIs that Node also provides).
const webCommon = [
  'AbortController',
  'AbortSignal',
  'Blob',
  'BroadcastChannel',
  'CustomEvent',
  'DOMException',
  'Event',
  'EventTarget',
  'File',
  'FormData',
  'Headers',
  'MessageChannel',
  'ReadableStream',
  'Request',
  'Response',
  'TextDecoder',
  'TextEncoder',
  'TransformStream',
  'URL',
  'URLSearchParams',
  'WritableStream',
  'atob',
  'btoa',
  'clearInterval',
  'clearTimeout',
  'console',
  'crypto',
  'fetch',
  'performance',
  'queueMicrotask',
  'setInterval',
  'setTimeout',
  'structuredClone',
];

const nodeGlobals = readonly([
  ...webCommon,
  'Buffer',
  'clearImmediate',
  'global',
  'process',
  'setImmediate',
]);

const browserGlobals = readonly([
  ...webCommon,
  'CSS',
  'Element',
  'EventSource',
  'FileReader',
  'HTMLElement',
  'HTMLImageElement',
  'HTMLInputElement',
  'Image',
  'IntersectionObserver',
  'KeyboardEvent',
  'MouseEvent',
  'MutationObserver',
  'Node',
  'Notification',
  'ResizeObserver',
  'alert',
  'cancelAnimationFrame',
  'confirm',
  'document',
  'getComputedStyle',
  'history',
  'innerHeight',
  'innerWidth',
  'localStorage',
  'location',
  'matchMedia',
  'navigator',
  'requestAnimationFrame',
  'scrollTo',
  'scrollX',
  'scrollY',
  'sessionStorage',
  'window',
]);

// Node scripts that drive Chromium: their page.evaluate callbacks use browser globals.
const playwrightScripts = [
  'scripts/browser-smoke.mjs',
  'scripts/measure-network.mjs',
  'scripts/measure-quick-tab.mjs',
  'scripts/page-settle.mjs',
  'scripts/ux-review-acceptance.mjs',
  'scripts/ux-review-contact.mjs',
  'scripts/ux-review-measure.mjs',
  'scripts/ux-shots.mjs',
];

export default [
  {
    ignores: [
      'node_modules/**',
      'scan-results/**',
      'coverage/**',
      'fixtures/**',
      'scratch/**',
      'artifacts/**',
      'screens/**',
    ],
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: nodeGlobals },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-constant-binary-expression': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    // Frontend modules run in the browser; their *.test.mjs files run in Node and keep Node globals.
    files: ['app/**/*.js'],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: playwrightScripts,
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals } },
  },
];
