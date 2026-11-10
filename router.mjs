// A table of HTTP routes instead of a chain of path conditions. A route is a method (or a list, or
// '*') and a path pattern: '/api/sets/:offerId/candidates' (":name" matches one path segment and is
// URL-decoded here, once), optionally ending in '/*' for a prefix ('/api/buyback/*' also matches
// '/api/buyback'). Routes are tried in the order they were added; the first match wins.

function compile(pattern) {
  const prefix = pattern.endsWith('/*');
  const body = prefix ? pattern.slice(0, -2) : pattern;
  const names = [];
  const source = body
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        names.push(part.slice(1).replace(/\?$/, ''));
        return part.endsWith('?') ? '(?:/([^/]+))?' : '/([^/]+)';
      }
      return part ? '/' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    })
    .join('');
  return { regex: new RegExp('^' + source + (prefix ? '(?:/.*)?$' : '$')), names };
}

export function createRouter() {
  const routes = [];
  const router = {
    /** @param {string|string[]} methods @param {string} pattern @param {Function} handler */
    add(methods, pattern, handler) {
      const list = methods === '*' ? null : [].concat(methods).map((method) => method.toUpperCase());
      routes.push({ methods: list, pattern, handler, ...compile(pattern) });
      return router;
    },
    /**
     * The route for (method, path): { handler, params } when one matches, { methodNotAllowed: true }
     * when the path is known but not for this method, or null.
     */
    match(method, path) {
      let pathKnown = false;
      for (const route of routes) {
        const found = route.regex.exec(path);
        if (!found) continue;
        pathKnown = true;
        if (route.methods && !route.methods.includes(String(method).toUpperCase())) continue;
        const params = {};
        route.names.forEach((name, index) => {
          const value = found[index + 1];
          if (value === undefined) return;
          try {
            params[name] = decodeURIComponent(value);
          } catch {
            params[name] = value;
          }
        });
        return { handler: route.handler, params, pattern: route.pattern };
      }
      return pathKnown ? { methodNotAllowed: true } : null;
    },
    routes: () => routes.map(({ methods, pattern }) => ({ methods, pattern })),
  };
  return router;
}
