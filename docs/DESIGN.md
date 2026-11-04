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

`src/element/numeric.ts` uses a private decimal.js context to compare original JSON number literals or numeric strings with localized DOM values. It recognizes Western grouping, decimal separators, currency labels, rounding to displayed precision, fraction removal and explicit percent formatting. It compares raw source strings without converting IDs or monetary values through JavaScript Number. Source literals are bounded to 256 characters and absolute exponents of 300; arithmetic precision is 512 significant digits. Plain displays require at least three digits, percentages two; zero and malformed or mixed text are excluded. Local grouping comes from the selected element/document language, falling back to the page navigator language and then English. Small aggregate innerText samples join values split across DOM spans.

Dividing by 100 requires both a JSON field ending in Minor/Cents/Kopecks and a DOM sample labelled with a recognized currency that uses two decimal minor units. Unlabelled values and ambiguous zero-decimal currency symbols do not enable that conversion. Evidence retains the raw JSON value, rendered sample, JSONPath and the transformation used. Among numeric evidence, currency-labelled values take priority over incidental plain counts. Other unit scaling and arbitrary business calculations are not guessed.

Budgets: 1,500 visited DOM nodes and queued nodes; computed styles for at most 200 elements; 300 resource URLs; 80 text/attribute samples of up to 160 characters. Text samples need 8 characters, while shorter samples containing digits are retained for numeric analysis. A scan checks up to 60 recent completed Fetch/XHR bodies, each at most 256 KiB, with 4 MiB of eligible source text and a 10-second scan deadline (1.5 seconds per body). Encoded, truncated, oversized and unavailable bodies are skipped. Collection/scan limits and unavailable body counts are exposed in the UI. A missing recorded response is reported separately from a completed analysis with no matches. The evidence list shows the first 80 results; the table includes all matches. The existing four-body response cache is shared with request details.

The evidence snapshot does not track later DOM mutations automatically. Users refresh the selected element after it changes. This is a foundation for future framework-aware or instrumented tracing, with provenance kept explicit.

API contracts: [selected-window evaluation](https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow), [Elements selection events](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels#type-ElementsPanel), and [recorded response content](https://developer.chrome.com/docs/extensions/reference/api/devtools/network).

## Chromium research

Reviewed the official ChromeDevTools/devtools-frontend mirror at revision `a0c962bc04993dd4b0843f34fa0d2b2afa6d0936`:

- [NetworkPanel.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkPanel.ts): split table/detail widgets and request selection lifecycle.
- [NetworkLogViewColumns.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkLogViewColumns.ts): column descriptors, visibility and comparators.
- [NetworkDataGridNode.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkDataGridNode.ts): row selection, cell rendering and sort behavior.
- [NetworkItemView.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkItemView.ts): Headers, Payload, Preview, Response, Initiator, Timing and Cookies views.
- [Network reference](https://developer.chrome.com/docs/devtools/network/reference/) and [extension Network API](https://developer.chrome.com/docs/extensions/reference/api/devtools/network): public behavior and extension data limits.

Odinet implements these interaction patterns independently. Chromium's internal UI framework and SDK are not extension dependencies. The public DevTools API provides HAR data and response content, with completed-request notifications. It does not expose native Network's full CDP event stream or all internal controls.
