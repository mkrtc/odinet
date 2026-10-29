# Odinet

**Odinet** is an open source Chromium extension for observing HTTP and HTTPS requests while exploring websites. This repository currently contains the capture foundation and a small popup. Page parsing and advanced Network tools are planned for later stages.

[Русская версия](README.ru.md)

## Current features

- Captures visible HTTP and HTTPS requests across browser tabs with Manifest V3 `chrome.webRequest`.
- Groups request lifecycle events by request ID, including redirects, completion and network errors.
- Shows method, URL, resource type, tab ID and final HTTP status in the popup.
- Keeps up to 200 recent records in session memory. No captured data is sent to a server.

## Requirements and setup

Install [Bun](https://bun.com/docs/installation) 1.4.0 or newer.

```sh
git clone https://github.com/mkrtc/odinet.git
cd odinet
bun ci
bun run check
bun test
bun run build
```

Open `chrome://extensions` in a Chromium browser, enable Developer mode and load the **`dist`** directory as an unpacked extension. On Helium, use its extensions page if the `chrome://` address is redirected. The popup then shows requests made after installation.

## Scope and privacy

The extension asks for `webRequest`, `storage`, and HTTP/HTTPS host access so it can observe traffic from all sites. Captured URLs may contain secrets in query parameters. The journal lives in `chrome.storage.session` and is cleared when the browser restarts or the extension is reloaded, disabled or updated. Use **Clear** in the popup to remove it sooner.

This version captures metadata only. It does not capture request or response bodies, headers or page content. It does not export or upload data. Browser protected requests and some internal traffic are not exposed to extensions, so results cannot exactly match DevTools Network.

## Project

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [MIT License](LICENSE) © 2026 Mkrtchian Sarkis
