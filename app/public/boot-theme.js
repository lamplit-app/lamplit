/*
 * The theme, on the first frame, before there is an app to ask.
 *
 * The app's own setting lives in `settings.json` on the server, and it arrives
 * an app initializer and a fetch after the page does. Until then the page can
 * only be the colour the stylesheet says, and the stylesheet says "whatever
 * this machine is in" — which is right for the reader following their machine
 * and wrong for the one who chose the other side. That reader used to watch
 * the app flip on every load.
 *
 * So `applyUi` leaves the chosen theme in `localStorage` and this reads it
 * back. `settings.json` is still where the setting lives: this is a per-device
 * copy of it, and per-device is the honest place for it — one settings file is
 * read by the machine that serves it and by every phone that has scanned the
 * code, and this is about which screen is in front of you.
 *
 * A separate file rather than three lines inline, because the server sends
 * `script-src 'self'` and an inline script is exactly what that forbids — see
 * the note over `CONTENT_SECURITY_POLICY` in *server/src/app.js*, which turned
 * off Angular's critical-CSS inlining for the same reason. It costs one
 * request to a server on this machine, before the stylesheet, and it is
 * cached.
 *
 * Nothing is written when the theme follows the machine: the key is removed
 * instead, so a stale answer can never pin the app to a theme the desktop has
 * since left. The name is `THEME_CACHE_KEY` in *app/src/app/core/theming.ts*,
 * and it is written down twice — here and there — because nothing in a plain
 * script in `public/` can import from the app.
 */
try {
  var theme = localStorage.getItem('lamplit-theme');
  // An inline style on <html>, which is where `applyUi` writes it too and what
  // beats the stylesheet's own `color-scheme: light dark`. Only the two names
  // the app ever writes; anything else in there is somebody else's, or ours
  // from a version that meant something different by it.
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.style.colorScheme = theme;
  }
} catch {
  // A page with no storage at all — a private window with cookies blocked —
  // throws on the property rather than the call. One frame of the machine's own
  // theme is not worth a script error on the way in.
}
