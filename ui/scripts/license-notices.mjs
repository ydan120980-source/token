// Third-party notices for the React layer bundle: every npm package whose code ends up in
// agent-ui.js / agent-ui.css, with its license text, plus the vendored fluid-functionalism sources.
// Written next to the bundle as agent-ui.LICENSES.txt by ui/vite.config.ts; sorted, so builds stay
// byte-identical.
import fs from "node:fs";
import path from "node:path";

const MIT = "MIT License\n\nCopyright (c) <holder>\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.";
const LICENSE_FILES =["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md", "LICENCE", "LICENCE.md"];

function packageRoot(id) {
  const file = id.replace(/\\/g, "/").replace(/^\0/, "").replace(/\?.*$/, "");
  const at = file.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = file.slice(at + "/node_modules/".length).split("/");
  const name = rest[0].startsWith("@") ? rest[0] + "/" + rest[1] : rest[0];
  return { dir: file.slice(0, at) + "/node_modules/" + name, name };
}

function licenseText(dir) {
  for (const name of LICENSE_FILES) { const file = path.join(dir, name); if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim(); }
  return null;
}

export function licenseNotices(moduleIds, vendorDir, nodeModules) {
  const packages = new Map();
  // tailwindcss reaches agent-ui.css through @tailwindcss/vite, not as a bundled module.
  for (const id of [...moduleIds, path.join(nodeModules, "tailwindcss/index.css")]) {
    const root = packageRoot(id);
    if (!root || packages.has(root.name)) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(root.dir, "package.json"), "utf8"));
    packages.set(root.name, { name: root.name, version: meta.version, license: meta.license || "see text", text: licenseText(root.dir), meta, dir: root.dir });
  }
  // Some packages publish only a license field. Radix splits one MIT-licensed repository into many
  // packages, so a scope sibling's LICENSE file is the same text; otherwise the MIT text is written
  // out with the package's author as the copyright holder.
  for (const entry of packages.values()) {
    if (entry.text || entry.license !== "MIT") continue;
    if (entry.name.startsWith("@")) {
      const scope = path.dirname(entry.dir);
      const sibling = fs.readdirSync(scope).sort().map(name => licenseText(path.join(scope, name))).find(Boolean);
      if (sibling) { entry.text = sibling + "\n(License file of the same " + entry.name.split("/")[0] + " repository; this package publishes only its license field.)"; continue; }
    }
    const author = typeof entry.meta.author === "string" ? entry.meta.author : entry.meta.author?.name;
    if (author) entry.text = MIT.replace("<holder>", author);
  }
  const missing = [...packages.values()].filter(entry => !entry.text).map(entry => entry.name);
  if (missing.length) throw new Error("UI_LICENSE_TEXT_MISSING: " + missing.join(", "));
  const sections = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)).map(entry => "== " + entry.name + " " + entry.version + " (" + entry.license + ")\n\n" + entry.text);
  sections.unshift("== fluid-functionalism (vendored in ui/src/vendor/fluid, upstream 7387f36, MIT)\n\n" + fs.readFileSync(path.join(vendorDir, "LICENSE"), "utf8").replace(/\r\n/g, "\n").trim());
  return "Third-party software in agent-ui.js and agent-ui.css (Agent Usage React layer).\n\n" + sections.join("\n\n") + "\n";
}
