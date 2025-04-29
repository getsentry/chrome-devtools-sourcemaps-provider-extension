# Sentry Devtools Sourcemap Provider Extension

A browser extension to provide sourcemaps which have previously been uploaded to Sentry to the Chrome DevTools.
This extension can be used to have unminified errors and debugging in production without leaking sourcemaps to the public.

## Development

Run `npm i && npm run build` and add the extension to chrome via `chrome://extensions/`, "Developer mode" and "Load unpacked" pointing to `./dist`.

After making changes run `npm run build` once more and reload the extension in `chrome://extensions/`.
