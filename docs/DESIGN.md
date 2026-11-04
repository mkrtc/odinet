# Odinet Network interface

## Reference and theme

A developer compares network requests beside the inspected page in the same DevTools window. Follow the user's DevTools light or dark theme, compact controls and information density.

Use neutral surfaces, one blue selection accent, semantic request type colors and error text. Avoid decorative motion, cards and oversized titles. Body text is the platform UI font at 12px. Data rows are 21px and table headers and toolbars are about 27px.

## Layout

The panel has a toolbar, filter row, scrollable request table and summary footer. Selecting a request opens a resizable details region beside the table. Narrow panels stack details below the table. Hide secondary columns while details are open; preserve the Name, Method, Status, Type and Time columns. HTTP methods use readable text, including the request detail title. Escape closes details.

## Extension points

Column descriptors own display and sorting. Detail tabs own their rendering. The DevTools adapter owns HAR entries and lazy response content, separate from rendering. The popup continues to consume the bounded background session log.

## JSON inspection

`src/ui/json-document.ts` parses a strict JSON source tree with jsonc-parser. Values are read and copied from source ranges, preserving large numeric IDs, exponent notation, string escapes and duplicate object keys. `src/ui/json-viewer.ts` renders the tree and highlighted text without executing captured markup.

The viewer provides keyboard navigation, a selected JSONPath, value/document/path copy actions and cancellable key/value search. Every tree row has a copy button, revealed on hover, selection or keyboard focus. It copies the complete value without its property name, including collapsed branches and children outside the current page. Arrays and wide objects show 100 children per page. Search reveals the required ancestor pages. A tree render expands at most 2,500 rows and search retains at most 500 matches. Large source views keep all text, with highlighting bounded to 10,000 tokens. Formatting falls back to the original source above the depth/size budget. Clipboard failures expose a selected, read-only copy field.

## Element request associations

`src/element/snapshot.ts` collects a bounded snapshot of the selected Elements node through `inspectedWindow.eval` and `$0`. The evaluated function is self-contained and performs reads only. Its page-controlled result is validated before use. Collection covers descendants and open Shadow DOM, current image/media URLs, frame URLs and computed CSS images (including pseudo-elements). Form values and script/style source are excluded from text evidence. Same-document fragment references are ignored.

`src/element/relations.ts` matches resource URLs, exact normalized JSON string values and recognizable rendered numbers, returning the source JSONPath. Resource references prove URL association only. Data matches are candidates, never causal render dependencies. Request times must belong to the selected document's lifetime and precede the snapshot; JSON scans additionally require a completed response before the snapshot. Global styles/scripts, closed Shadow DOM, framework state, arbitrary calculations and unique attribution of repeated URLs are not inferred.

`src/element/controller.ts` owns native Elements selection events, automatic JSON scans while the mode is enabled, evidence rows and main-table filtering. A scan starts after a valid selection snapshot, with progress shown instead of a premature empty result. Rescan responses repeats analysis of the same snapshot. Switching selection, navigation or closing the mode invalidates pending reads/scans. Clearing the network log cancels its active data scan. Results remain in panel memory and are never written to background storage. No HTTP requests are replayed and no page APIs are patched.

The element toolbar keeps the selector, compact match/progress count and short controls on one row where space permits. Guidance, checked-response counts and limitations live in a keyboard-accessible `?` disclosure; incomplete results change it to an amber `!`. Numeric evidence shows JSONPath and the rendered value, with raw values and conversions in tooltips. Request names omit query strings in this list, with the full URL available on hover. Resource rows avoid repeating their URL below the name. Full action labels remain available to assistive technology.

`src/element/numeric.ts` uses a private decimal.js context to compare original JSON number literals or numeric strings with localized DOM values. It recognizes Western grouping, decimal separators, currency labels, rounding to displayed precision, fraction removal and explicit percent formatting. It compares raw source strings without converting IDs or monetary values through JavaScript Number. Source literals are bounded to 256 characters and absolute exponents of 300; arithmetic precision is 512 significant digits. Plain displays require at least three digits, percentages two; zero and malformed or mixed text are excluded. Local grouping comes from the selected element/document language, falling back to the page navigator language and then English. Small aggregate innerText samples join values split across DOM spans.

Dividing by 100 requires both a JSON field ending in Minor/Cents/Kopecks and a DOM sample labelled with a recognized currency that uses two decimal minor units. Unlabelled values and ambiguous zero-decimal currency symbols do not enable that conversion. Evidence retains the raw JSON value, rendered sample, JSONPath and the transformation used. Among numeric evidence, currency-labelled values take priority over incidental plain counts. Other unit scaling and arbitrary business calculations are not guessed.

Budgets: 1,500 visited DOM nodes and queued nodes; computed styles for at most 200 elements; 300 resource URLs; 80 text/attribute samples of up to 160 characters. Text samples need 8 characters, while shorter samples containing digits are retained for numeric analysis. A scan checks up to 60 recent completed Fetch/XHR bodies, each at most 256 KiB, with 4 MiB of eligible source text and a 10-second scan deadline (1.5 seconds per body). Encoded, truncated, oversized and unavailable bodies are skipped. Collection/scan limits and unavailable body counts are exposed in the UI. A missing recorded response is reported separately from a completed analysis with no matches. The evidence list shows the first 80 results; the table includes all matches. The existing four-body response cache is shared with request details.

The evidence snapshot does not track later DOM mutations automatically. Users refresh the selected element after it changes. This is a foundation for future framework-aware or instrumented tracing, with provenance kept explicit.

## Direct page picking

Element requests starts the page picker automatically. `src/element/picker-client.ts` owns its control port and desired picking/visibility state; `picker-broker.ts` accepts control sessions only from the extension panel, injects `element-picker.js` into the inspected tab's permitted existing frames, and routes individual frame ports to that session. Up to 128 frames are retained. Frame connections from other tabs, late connections after cancellation and stale injection results cannot activate a closed session. Control-port heartbeats keep the MV3 worker available. A disconnected owner closes its frame ports and removes their click interception.

`src/element/page-picker.ts` owns highlight rendering, hover and capture listeners. The content bundle runs in the ISOLATED world, uses `composedPath()` to select inside open Shadow DOM, collects snapshots directly and never invokes `inspect()` or changes the native Elements selection. The highlight uses a closed shadow root and pointer-transparent top-layer host, with fixed positioning as a fallback. Original element styles are not overwritten. Picker markup is excluded from evidence collection. Click-related events are consumed during picking so ordinary link/button actions do not run.

Escape pauses all participating frames. Pause keeps the chosen element available for Refresh element, and results stay visible. Panel onShown/onHidden events suspend picking outside Odinet and resume the intended state on return. Explicit pauses survive visibility changes. Navigation clears the old selection and starts a new session in the current document. Mode closure, pagehide, DevTools closure, connection loss and injection failures clean up listeners, overlays and retained selections. Inaccessible pages fall back to native Elements selection; frames created later may require restarting the mode.

Picker controls, guide text and overlay instructions use the EN/RU catalogs. The `scripting` permission is used only for on-demand picker installation; no persistent content script is registered.

API contracts: [selected-window evaluation](https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow), [panel visibility and Elements events](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels), [isolated script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting), [runtime ports](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), and [recorded response content](https://developer.chrome.com/docs/extensions/reference/api/devtools/network).

## Request copy menu

`src/ui/context-menu.ts` renders nested menus with keyboard navigation, viewport-aware placement and focus restoration. Request tables, element match rows and the selected request heading use the same `RequestCopyMenu`. Escape closes the menu without pausing the element picker or closing request details. `src/ui/request-copy.ts` loads bodies on demand, writes only on an explicit copy action, and offers a selected read-only field if clipboard access fails. New menu actions, log clearing, navigation and panel disposal invalidate older asynchronous exports. No replay code is executed.

`src/network/export.ts` serializes available HAR request text to cURL (POSIX/bash), browser Fetch, Node.js native fetch (18+, .mjs) and Python Requests. Browser-managed headers use the browser session; server formats retain captured authorization/cookies. Stale transport headers are omitted. Shell arguments and code string literals are escaped; cURL uses data-raw so a leading @ cannot read a local file. Missing upload/body bytes fail explicitly. Response copies preserve raw text, retain base64 encoding for binary data and refuse truncated content.

`src/network/redaction.ts` implements agent-copy credential removal on request and response headers, URL userinfo/query fields, JSON keys and URL-encoded forms. JSON edits operate on source ranges, preserving duplicate keys and numeric precision. Credential-bearing containers are replaced as a whole to avoid overlapping edits. Agent output labels unavailable, binary, undecodable and truncated response bodies instead of pretending they are complete. Multipart body content is omitted from agent copies. Markdown fences expand when captured text contains backticks. Captured content is marked as untrusted data. The policy recognizes known secret names/patterns and does not promise general payload anonymization.

## Read-only MCP integration

The optional local stdio server lives in `src/mcp/{server,broker,config}.ts` and `scripts/mcp.ts`. The official TypeScript SDK owns MCP framing, lifecycle, tool validation and cancellation. Its dependencies are not bundled into the extension. The WebSocket broker binds to literal IPv4 loopback and checks Host, extension Origin and a random 256-bit token offered through a subprotocol. It accepts at most 16 explicit panel sessions, with four pending calls each, a 12-second deadline and a 1 MiB frame limit. Pending maps are session-scoped and cleaned on completion, cancellation, timeout, disconnect or shutdown.

`src/mcp/protocol.ts` owns strict schemas shared by both sides. `panel-client.ts` accepts only list/read commands, handles authenticated connection setup, bounded reconnection and generation-based suppression of late results. `reader.ts` operates on the existing HAR adapter, shares its lazy body cache, checks entry identity again after asynchronous reads, and never replays traffic. Full source redaction precedes pagination. List metadata includes redacted bounded URLs; read documents preserve original JSON literals.

`src/ui/mcp-controls.ts` supplies a compact toolbar disclosure: port, password-masked token, connection state and Connect/Disconnect. Pairing is never enabled or persisted automatically. No extra browser permission is requested. Closing DevTools or disconnecting revokes access; an explicitly connected session remains available while the user views another DevTools tab. The localhost server retains only socket/session metadata and pending results, with no traffic persistence. The sole persistent file stores port and token; diagnostics go to stderr. See [MCP contracts and limits](MCP.md).

## Chromium research

Reviewed the official ChromeDevTools/devtools-frontend mirror at revision `a0c962bc04993dd4b0843f34fa0d2b2afa6d0936`:

- [NetworkPanel.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkPanel.ts): split table/detail widgets and request selection lifecycle.
- [NetworkLogViewColumns.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkLogViewColumns.ts): column descriptors, visibility and comparators.
- [NetworkDataGridNode.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkDataGridNode.ts): row selection, cell rendering and sort behavior.
- [NetworkItemView.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkItemView.ts): Headers, Payload, Preview, Response, Initiator, Timing and Cookies views.
- [Network reference](https://developer.chrome.com/docs/devtools/network/reference/) and [extension Network API](https://developer.chrome.com/docs/extensions/reference/api/devtools/network): public behavior and extension data limits.

Odinet implements these interaction patterns independently. Chromium's internal UI framework and SDK are not extension dependencies. The public DevTools API provides HAR data and response content, with completed-request notifications. It does not expose native Network's full CDP event stream or all internal controls.
