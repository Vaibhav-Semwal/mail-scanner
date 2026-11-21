# Mail Scanner

Electron tray app. Starts with your PC, checks your inbox over IMAP every N minutes,
and shows a notification for new unread mail. Clicking the app in your app drawer /
Start menu opens the settings window.

## Run in development
    npm install
    npm start

(Start-at-login is only registered in the packaged build, not in `npm start`.)

## Build an installer (adds the app-drawer / Start menu entry)
    npm run dist

Output is in `dist/`:
- Windows: `Mail Scanner Setup x.y.z.exe`, which installs and adds a Start menu shortcut
- Linux: `.deb` (adds a launcher entry) and `.AppImage`
- macOS: `.dmg` (drag to Applications). Build on a Mac.

## Notes
- Use an app password, not your normal password (Gmail needs 2-step verification on first).
  IMAP must be enabled on the mailbox.
- Your app password is encrypted with the OS keyring via Electron `safeStorage`.
- The app reads sender and subject only. It does not download message bodies or mark mail as read.
- Closing the window hides it to the tray. Quit from the tray menu.

## Versions and security (checked 25 Oct 2026)
- Dependencies are pinned exactly (Electron 45.0.0, electron-builder 26.18.0, imapflow 2.9.1) and
  `package-lock.json` is included. `npm audit` reports 0 known vulnerabilities.
- Two different Node.js versions are involved:
  1. The Node on your PC, used only for `npm install` and `npm run dist`. Use 24.22.1 or newer
     (or 22.23.4+ / 26.12.1+). These are the first releases with the 21 Oct 2026 security fixes.
     Node 20 and 25 are end of life and get no fixes. `.nvmrc` is set to 24.22.1.
  2. The Node bundled inside Electron, which is what actually runs your installed app.
     Electron 45.0.0 bundles Node 24.22.0, one patch behind the 21 Oct fixes. Bump `electron` to the
     next 45.x release that bundles Node 24.22.1 or later when it is published, then run `npm install`
     and `npm run dist` again.
- The app never uses the affected features (Brotli decompression, `fetch`, `dns.resolve`, the
  Permission Model, or single-executable snapshots). The window runs with `contextIsolation` on,
  `nodeIntegration` off, a strict CSP, and email text is rendered as plain text only.
- Check the bundled versions any time with:
      ELECTRON_RUN_AS_NODE=1 npx electron -p "process.versions.node"
