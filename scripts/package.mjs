import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const slug = "prettify-manga-reader";
const packageName = `${slug}-${manifest.version}`;
const distDir = path.join(root, "dist");
const stageDir = path.join(distDir, packageName);
const zipPath = path.join(distDir, `${packageName}.zip`);
const files = ["manifest.json", "background.js", "content.js", "content.css"];

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(stageDir, file));
}

const python = spawnSync("python", ["-c", `
import pathlib
import sys
import zipfile

stage = pathlib.Path(sys.argv[1])
zip_path = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(stage.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(stage))
`, stageDir, zipPath], { stdio: "inherit" });

if (python.status !== 0) {
  process.exit(python.status || 1);
}

console.log(`Wrote ${path.relative(root, zipPath)}`);
