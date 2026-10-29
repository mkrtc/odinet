# Contributing to Odinet

Thanks for helping improve Odinet. Before opening a pull request, check existing issues and describe the problem you want to solve. Small, focused changes are easier to review.

## Development

Install [Bun](https://bun.com/docs/installation) 1.4.0 or newer, then run:

```sh
bun ci
bun run check
bun test
bun run build
```

Load `dist` as an unpacked extension in a Chromium browser. When changing request capture, test a normal response, a redirect and a failed request. Include the browser name and version in bug reports.

Keep host permissions and data collection as narrow as the feature allows. The popup uses background metadata, while the DevTools adapter retains HAR data in panel memory and loads response bodies on demand. Discuss new persistent storage or network uploads before implementing them. Never include real cookies, tokens or private URLs in issues or test fixtures. Add columns in `src/network/columns.ts` and detail views in `src/ui/request-details.ts`; keep data acquisition separate from rendering.

By submitting a contribution, you agree that it is licensed under the project's [MIT License](LICENSE).
