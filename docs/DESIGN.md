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

The viewer provides keyboard navigation, a selected JSONPath, value/document/path copy actions and cancellable key/value search. Arrays and wide objects show 100 children per page. Search reveals the required ancestor pages. A tree render expands at most 2,500 rows and search retains at most 500 matches. Large source views keep all text, with highlighting bounded to 10,000 tokens. Formatting falls back to the original source above the depth/size budget. Clipboard failures expose a selected, read-only copy field.

## Chromium research

Reviewed the official ChromeDevTools/devtools-frontend mirror at revision `a0c962bc04993dd4b0843f34fa0d2b2afa6d0936`:

- [NetworkPanel.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkPanel.ts): split table/detail widgets and request selection lifecycle.
- [NetworkLogViewColumns.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkLogViewColumns.ts): column descriptors, visibility and comparators.
- [NetworkDataGridNode.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkDataGridNode.ts): row selection, cell rendering and sort behavior.
- [NetworkItemView.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/a0c962bc04993dd4b0843f34fa0d2b2afa6d0936/front_end/panels/network/NetworkItemView.ts): Headers, Payload, Preview, Response, Initiator, Timing and Cookies views.
- [Network reference](https://developer.chrome.com/docs/devtools/network/reference/) and [extension Network API](https://developer.chrome.com/docs/extensions/reference/api/devtools/network): public behavior and extension data limits.

Odinet implements these interaction patterns independently. Chromium's internal UI framework and SDK are not extension dependencies. The public DevTools API provides HAR data and response content, with completed-request notifications. It does not expose native Network's full CDP event stream or all internal controls.
