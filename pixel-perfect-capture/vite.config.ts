// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// `npm run build:desktop` (or TACIT_DESKTOP=1): a static single-page build, with no server, in
// dist-desktop/client, that the packaged Electron app serves from app://tacit (electron/main.cjs).
// The script name is read instead of an env var so the script works in every shell (Windows CI).
const desktop =
  process.env["npm_lifecycle_event"] === "build:desktop" || process.env["TACIT_DESKTOP"] === "1";

export default defineConfig({
  vite: {
    // allowedHosts lets a second laptop load the UI by name (mithras-mbp.lan), not just by IP.
    server: { port: 8081, strictPort: true, allowedHosts: [".lan", ".local"] },
    ...(desktop && { build: { outDir: "dist-desktop" } }),
  },
  ...(desktop && { nitro: false as const }),
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // The shell page every route starts from; the router renders the page in the browser.
    ...(desktop && { spa: { enabled: true, prerender: { outputPath: "/index.html" } } }),
  },
});
