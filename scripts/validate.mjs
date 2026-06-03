import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const requiredFiles = ["manifest.json", "background.js", "content.js", "content.css"];
const errors = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    errors.push(`Missing extension file: ${file}`);
  }
}

if (manifest.manifest_version !== 3) {
  errors.push("manifest.json must use Manifest V3");
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) {
  errors.push(`Invalid manifest version: ${manifest.version}`);
}

if (pkg.version !== manifest.version) {
  errors.push(`package.json version (${pkg.version}) must match manifest.json version (${manifest.version})`);
}

if (manifest.host_permissions?.length) {
  errors.push("Avoid broad host_permissions; activeTab plus content_scripts are enough for this extension");
}

if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length !== 1) {
  errors.push("Expected one content script declaration");
}

const contentScript = manifest.content_scripts?.[0];
if (contentScript) {
  for (const file of ["content.js", "content.css"]) {
    const key = file.endsWith(".js") ? "js" : "css";
    if (!contentScript[key]?.includes(file)) {
      errors.push(`content_scripts must include ${file}`);
    }
  }
}

const contentJs = fs.readFileSync(path.join(root, "content.js"), "utf8");
if (/function\s+preferredImageUrl\b/.test(contentJs)) {
  errors.push("Remove unused preferredImageUrl helper");
}
if (!contentJs.includes("MIN_DETECTED_PAGES") || !contentJs.includes("LANDSCAPE_SPREAD_RATIO")) {
  errors.push("Core heuristic thresholds should be named constants");
}

if (errors.length) {
  for (const error of errors) {
    console.error(`validate: ${error}`);
  }
  process.exit(1);
}

console.log(`Validated ${manifest.name} ${manifest.version}`);
