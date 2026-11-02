// 打包成单文件 exe（Node SEA）。思路与 BiliGiftDrop 一致：
// 下载 postject → 生成 sea.blob（内嵌 src 与 static）→ 复制 node.exe → 注入 blob。
// 需要：Windows x64、Node 22+、网络（第一次下载 postject）。
import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('这个打包脚本目前只支持 Windows x64');
}

const STATIC_SOURCE = path.resolve(root, '..', 'livesub_local', 'static');
const POSTJECT_URL = 'https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz';
const POSTJECT_SHA = 'd1447b53e87d49ddaf7fb3350c870afafa72760eca47f6d5cce4cefd537e7d92';

await rm('build', { recursive: true, force: true });
await mkdir('build', { recursive: true });
await mkdir('dist', { recursive: true });

// 1) postject（只用来把 blob 注入 exe，构建期用一次）
const archive = 'build/postject.tgz';
let tarball;
try {
  tarball = await readFile(archive);
} catch {
  console.log('[1/5] postject をダウンロード中…');
  const response = await fetch(POSTJECT_URL);
  if (!response.ok) throw new Error(`postject download failed: ${response.status}`);
  tarball = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(tarball).digest('hex') !== POSTJECT_SHA) {
  throw new Error('postject のチェックサムが一致しません');
}
await writeFile(archive, tarball);
execFileSync('tar', ['-xf', archive, '-C', 'build']);
if (!(await stat('build/package/dist/api.js').catch(() => null))) {
  throw new Error('postject の展開に失敗しました');
}

// 2) 内嵌するファイル一覧（src + static）
console.log('[2/5] 埋め込むファイルを収集中…');
const files = [];
async function walk(dir, prefix) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, `${prefix}/${entry.name}`);
    else files.push({ key: `${prefix}/${entry.name}`, file: full });
  }
}
await walk(path.join(root, 'src'), 'src');
await walk(STATIC_SOURCE, 'static');
// 配置模板也带上：首次运行时复制到 exe 旁边。
files.push({ key: 'templates/config.example.toml', file: path.resolve(root, '..', 'config.example.toml') });
files.push({ key: 'templates/api.example.toml', file: path.resolve(root, '..', 'api.example.toml') });
files.sort((a, b) => a.key.localeCompare(b.key));

const hash = createHash('sha256');
const assets = {};
for (const item of files) {
  hash.update(item.key).update(await readFile(item.file));
  assets[item.key] = item.file;
}
const manifest = { hash: hash.digest('hex').slice(0, 20), files: files.map((item) => item.key) };
await writeFile('build/manifest.json', JSON.stringify(manifest));
assets.manifest = path.resolve('build/manifest.json');

// 3) sea.blob
console.log('[3/5] sea.blob を生成中…');
await writeFile('build/sea-config.json', JSON.stringify({
  main: 'scripts/sea-bootstrap.cjs',
  output: 'build/sea.blob',
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
}));
execFileSync(process.execPath, ['--experimental-sea-config', 'build/sea-config.json'], { stdio: 'inherit' });

// 4) node.exe をコピーして CUI に直し、署名を取り除く
console.log('[4/5] exe を準備中…');
const exe = 'dist/LiveSubLocal.exe';
const binary = await readFile(process.execPath);
const pe = binary.readUInt32LE(0x3c);
const optional = pe + 24;
binary.writeUInt16LE(3, optional + 68); // IMAGE_SUBSYSTEM_WINDOWS_CUI：ダブルクリックでもコンソールを出す
const security = optional + (binary.readUInt16LE(optional) === 0x20b ? 112 : 96) + 4 * 8;
const certificate = binary.readUInt32LE(security);
const certificateSize = binary.readUInt32LE(security + 4);
binary.fill(0, security, security + 8);
await writeFile(
  exe,
  certificate && certificate + certificateSize === binary.length ? binary.subarray(0, certificate) : binary,
);

// 5) blob を注入
console.log('[5/5] blob を注入中…');
const { inject } = createRequire(import.meta.url)('../build/package/dist/api.js');
await inject(exe, 'NODE_SEA_BLOB', await readFile('build/sea.blob'), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});

console.log(`完了: ${exe}`);
