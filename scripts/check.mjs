import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
for (const f of readdirSync("dist/src").filter((f) => f.endsWith(".js"))) {
  const r = spawnSync(process.execPath, ["--check", `dist/src/${f}`], {
    stdio: "inherit",
  });
  if (r.status) process.exit(r.status);
}
for (const file of ["dist/index.html", "dist/admin.html"]) {
  const html = readFileSync(file, "utf8");
  for (const [, path] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    if (/^(https?:|\.\/|downloads\/|admin\.html)/.test(path)) continue;
    try {
      readFileSync(`dist/${path}`);
    } catch {
      throw new Error(`${file}: falta ${path}`);
    }
  }
}
console.log("Módulos JavaScript y recursos locales: correctos.");
