// src の中で、import していないグローバルの React 名前空間（React.CSSProperties など）を使っていないか調べる。
//
// エンジンは作品のプロジェクトからソースのまま読まれる。作品側の型チェックでは @types/react が
// 作品とエンジンの node_modules に1つずつあり、"react" から import した型はエンジン側、
// グローバルの React 名前空間は作品側を指す。両者が混ざると型が合わずに作品のビルドが止まるが、
// エンジン単体の tsc では @types/react が1つしかないので見つからない。そのためここで検査する。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pattern = /\bReact\.[A-Za-z_]/;

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

const hits = [];
for (const file of sourceFiles(join(root, "src"))) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (pattern.test(code)) hits.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
  });
}

if (hits.length > 0) {
  console.error("グローバルの React 名前空間を使っています。型は \"react\" から import してください:");
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
