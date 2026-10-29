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

Keep host permissions and data collection as narrow as the feature allows. Do not add network uploads, persistent storage of captured traffic, or collection of request or response bodies without an explicit design discussion. Never include real cookies, tokens or private URLs in issues or test fixtures.

By submitting a contribution, you agree that it is licensed under the project's [MIT License](LICENSE).
