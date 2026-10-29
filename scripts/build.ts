import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const output = join(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/background.ts"), join(root, "src/popup.ts")],
  outdir: output,
  target: "browser",
  format: "esm",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exitCode = 1;
} else {
  await cp(join(root, "public"), output, { recursive: true });
  console.log(`Odinet built: ${output}`);
}
