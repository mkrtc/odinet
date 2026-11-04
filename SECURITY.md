# Security policy

Odinet can observe URLs from pages you visit. The DevTools panel can also access HAR headers, cookies, request bodies and response content. Captured traffic can contain credentials and personal information. DevTools details stay in panel memory; the popup's background metadata stays in session storage. Nothing is uploaded by the extension.

When element inspection is enabled, Odinet reads a bounded snapshot of the selected DOM subtree, including visible text, selected attributes and resource URLs. Selecting an element automatically compares its snapshot with recorded response bodies without replaying requests. Snapshots and match evidence stay in panel memory and are cleared on selection changes, navigation, mode closure or DevTools closure.

The direct picker is injected on demand with `scripting` into the inspected tab's isolated extension world. It temporarily adds a pointer-transparent highlight and capture listeners that consume selection clicks. Escape, pause, hidden panels, mode closure and disconnected sessions release interception. Closing the mode or losing its connection also releases stored DOM references. Runtime ports are routed by the inspected tab and only the extension panel can start a picker session. No page globals, `inspect()` calls or page network APIs are modified.

Please do not publish a vulnerability or a captured request in a public issue. Use [GitHub's private vulnerability reporting](https://github.com/mkrtc/odinet/security/advisories/new) when it is available for this repository. If that option is unavailable, contact the repository owner privately through their GitHub profile before disclosing details.

Security fixes are prioritized for the latest version on the default branch. There is no published release support policy yet.
