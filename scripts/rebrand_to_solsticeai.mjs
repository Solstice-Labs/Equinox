import fs from "node:fs";
import path from "node:path";

function mapPackageName(oldName) {
  if (!oldName.startsWith('@deepseek-ai/')) return oldName;
  if (oldName === '@solsticeai/equinox') return '@solsticeai/equinox';
  if (oldName === '@solsticeai/equinox-root') return '@solsticeai/equinox-root';
  if (oldName === '@solsticeai/equinox-cli') return '@solsticeai/equinox-cli';
  if (oldName === '@solsticeai/equinox-web-frontend') return '@solsticeai/equinox-web-frontend';
  if (oldName.startsWith('@solsticeai/equinox-')) {
    return '@solsticeai/equinox-' + oldName.slice('@solsticeai/equinox-'.length);
  }
  return '@solsticeai/' + oldName.slice('@deepseek-ai/'.length);
}

function findFiles(dir, matchExts) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "lib") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findFiles(fullPath, matchExts));
    } else if (matchExts.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

console.log("=== STEP 1: Updating package.json files ===");
const pkgFiles = findFiles(".", ["package.json"]);
let updatedPkgs = 0;

for (const pkgPath of pkgFiles) {
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const json = JSON.parse(raw);
    let modified = false;

    if (json.name && json.name.startsWith('@deepseek-ai/')) {
      json.name = mapPackageName(json.name);
      modified = true;
    }

    if (json.repository && typeof json.repository.url === 'string') {
      if (json.repository.url.includes('deepseek-ai/deepseek-harness')) {
        json.repository.url = json.repository.url.replace('deepseek-ai/deepseek-harness', 'Solstice-Labs/Equinox');
        modified = true;
      }
    }

    if (pkgPath.includes("apps/cli/package.json")) {
      json.bin = {
        "equinox": "lib/bin.js",
        "eq": "lib/bin.js",
        "dsh": "lib/bin.js"
      };
      modified = true;
    }

    const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides'];
    for (const field of depFields) {
      if (json[field] && typeof json[field] === 'object') {
        const newObj = {};
        for (const [dep, version] of Object.entries(json[field])) {
          const newDepName = mapPackageName(dep);
          newObj[newDepName] = version;
          if (newDepName !== dep) modified = true;
        }
        json[field] = newObj;
      }
    }

    if (modified) {
      fs.writeFileSync(pkgPath, JSON.stringify(json, null, 2) + "\n");
      updatedPkgs++;
    }
  } catch (err) {
    console.error(`Error processing ${pkgPath}:`, err.message);
  }
}
console.log(`Updated ${updatedPkgs} package.json files.`);

console.log("\n=== STEP 2: Updating tsconfig, pnpm-workspace, source code, and markdown configs ===");
const textFiles = findFiles(".", [".json", ".ts", ".tsx", ".js", ".mjs", ".yml", ".yaml", ".md"]);
let updatedTextFiles = 0;

for (const filePath of textFiles) {
  if (filePath.endsWith("package.json") || filePath.endsWith("pnpm-lock.yaml")) continue;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    let replaced = content;

    // Package names
    replaced = replaced.replace(/@deepseek-ai\/dsh-([a-zA-Z0-9_-]+)/g, "@solsticeai/equinox-$1");
    replaced = replaced.replace(/@deepseek-ai\/dsh\b/g, "@solsticeai/equinox");
    replaced = replaced.replace(/@deepseek-ai\/cordis/g, "@solsticeai/cordis");
    replaced = replaced.replace(/@deepseek-ai\/cosmokit/g, "@solsticeai/cosmokit");
    replaced = replaced.replace(/@deepseek-ai\/schemastery/g, "@solsticeai/schemastery");
    replaced = replaced.replace(/@deepseek-ai\/miniscan/g, "@solsticeai/miniscan");
    replaced = replaced.replace(/@deepseek-ai\/yolox/g, "@solsticeai/yolox");
    replaced = replaced.replace(/@deepseek-ai\/landlock/g, "@solsticeai/landlock");
    replaced = replaced.replace(/@deepseek-ai\/([a-zA-Z0-9_-]+)/g, "@solsticeai/$1");

    // Repository URLs
    replaced = replaced.replace(/github\.com\/deepseek-ai\/deepseek-harness/g, "github.com/Solstice-Labs/Equinox");

    if (replaced !== content) {
      fs.writeFileSync(filePath, replaced);
      updatedTextFiles++;
    }
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err.message);
  }
}
console.log(`Updated ${updatedTextFiles} text and config files.`);
console.log("\n=== REBRAND COMPLETE ===");
