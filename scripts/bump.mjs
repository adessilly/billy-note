// Change la version de l'application partout où elle apparaît :
//   npm run bump 0.2.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage : npm run bump X.Y.Z");
  process.exit(1);
}

const edit = (file, from, to) => {
  const text = readFileSync(file, "utf8");
  if (!from.test(text)) throw new Error(`version introuvable dans ${file}`);
  writeFileSync(file, text.replace(from, to));
};

edit("package.json", /("version": ")[^"]+(")/, `$1${version}$2`);
edit("package-lock.json", /("name": "billy-note",\s+"version": ")[^"]+(")/g, `$1${version}$2`);
edit("src-tauri/tauri.conf.json", /("version": ")[^"]+(")/, `$1${version}$2`);
edit("src-tauri/Cargo.toml", /^(version = ")[^"]+(")/m, `$1${version}$2`);
edit("src-tauri/Cargo.lock", /(name = "billy-note"\nversion = ")[^"]+(")/, `$1${version}$2`);

console.log(`Version ${version}. Ensuite :
  git commit -am "chore: release v${version}"
  git tag v${version}
  git push && git push origin v${version}`);
