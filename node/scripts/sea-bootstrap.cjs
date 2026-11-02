// SEA 启动器：把内嵌的源码与 static 解包到 %LOCALAPPDATA%，再从那里启动应用。
// 配置/密钥仍然读 exe 所在目录（LIVESUB_APP_DIR）。
const { getAsset } = require('node:sea');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

(async () => {
  const manifest = JSON.parse(getAsset('manifest', 'utf8'));
  // 既定では exe と同じフォルダの _app に展開する（どこに置いても動く・後片付けが簡単）。
  const home = process.env.LIVESUB_DATA_DIR
    || path.join(path.dirname(process.execPath), '_app');
  const app = path.join(home, 'app', manifest.hash);

  for (const file of manifest.files) {
    const target = path.join(app, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(getAsset(file)));
  }

  process.env.LIVESUB_APP_DIR = path.dirname(process.execPath);
  process.env.LIVESUB_BUNDLE_DIR = app;
  process.env.LIVESUB_STATIC_DIR = path.join(app, 'static');
  process.env.LIVESUB_SEA = '1';

  // 初回起動：exe の隣に config.toml / api.toml を用意する。
  for (const name of ['config', 'api']) {
    const target = path.join(process.env.LIVESUB_APP_DIR, `${name}.toml`);
    const template = path.join(app, 'templates', `${name}.example.toml`);
    try {
      await fs.access(target);
    } catch {
      try {
        await fs.copyFile(template, target);
        console.log(`[情報] ${target} を作成しました。`);
      } catch {
        // テンプレートが無ければ既定値で動く
      }
    }
  }

  await import(pathToFileURL(path.join(app, 'src/run.mjs')).href);
})().catch((error) => {
  console.error(`[エラー] 起動に失敗しました: ${error && error.message ? error.message : error}`);
  console.error('       もう一度実行してください。改善しない場合は node/ から `node src/run.mjs` で起動できます。');
  process.exitCode = 1;
});
