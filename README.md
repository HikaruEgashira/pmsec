# pmsec

`pmsec` は npm と uv の **install-time cooldown**（新しく公開されたパッケージを一定期間インストールさせない設定）を検査・適用する CLI です。npm の `min-release-age` と uv の `exclude-newer` を user-global config に書き込みます。

供給チェーン攻撃の多くは公開後数時間〜数日で検出・撤去されるため、7 日程度の cooldown を入れるだけで影響範囲を大きく削れます。

- Node 版（`npx`）と Python 版（`uvx`）を同梱
- 依存ゼロ（Node は標準ライブラリのみ、Python は stdlib のみ）
- check / set / unset を持ち、`check` は不足時に exit 1（CI gate に使える）
- macOS / Linux / Windows のパス解決対応
- `set` 時に `uv --version` を preflight し、`exclude-newer = "N days"` 構文を理解できない古い uv（< 0.9.17）に書き込むと自身が起動不能になる事故を防止

## このリポジトリから直接実行する

```bash
# Node（要 Node 18+）
npm exec --package=./node -- pmsec check
npm exec --package=./node -- pmsec set 7
npm exec --package=./node -- pmsec unset

# Python（要 Python 3.10+, uv 0.9.17+）
uvx --from ./python pmsec check
uvx --from ./python pmsec set 7
uvx --from ./python pmsec unset
```

## レジストリ公開後の使い方

```bash
npx pmsec check --min 7
npx pmsec set 7

uvx pmsec check --min 7
uvx pmsec set 7
```

公開状況: [npm](https://www.npmjs.com/package/pmsec) / [PyPI](https://pypi.org/project/pmsec/) — どちらもタグ push で `.github/workflows/release.yml` がトリガーする trusted publishing で配布します。

## コマンド

| Command | 説明 |
| --- | --- |
| `pmsec check [--min N]` | 各ツールの設定を読み、`min` 未満 / 未設定があれば exit 1 |
| `pmsec set <DAYS> [--force]` | 全対象ツールに `DAYS` 日の cooldown を書き込み（uv 旧版検出時は `--force` 必須） |
| `pmsec unset` | 各設定ファイルから cooldown キーのみ削除（他キーは保持） |

オプション:

- `--tool npm,uv` — 対象ツールを限定
- `--json` — JSON 出力（CI 連携用）

## 書き込む設定

| Tool | Key | Path (Unix) | Path (Windows) |
| --- | --- | --- | --- |
| npm | `min-release-age` | `~/.npmrc` | `%USERPROFILE%\.npmrc` |
| uv | `exclude-newer` | `${XDG_CONFIG_HOME:-~/.config}/uv/uv.toml` | `%APPDATA%\uv\uv.toml` |

`set` 時、初回のみ既存ファイルを `.bak` にバックアップしてから書き換えます（2 回目以降は元の手書き設定を上書き保存しない）。`[section]` ヘッダの前に挿入し、既存キーは in-place 置換するので他の設定行は壊しません。

環境変数で出力先を上書きできます:

- `NPM_CONFIG_USERCONFIG` → npm のユーザー config パス
- `UV_CONFIG_FILE` → uv の config パス
- `XDG_CONFIG_HOME` / `APPDATA` → 各 OS の標準を上書き

## バージョン要件

- npm: `11.10.0` 以上で `min-release-age` が解釈されます。
- uv: `0.9.17` 以上で `"7 days"` のような相対 duration が読めます。古い uv で書き込むと config 解析失敗で uv 自身が動かなくなるため、`pmsec set` は preflight でブロックします（明示的に通すなら `--force`）。
- pip / pnpm / yarn / bun などへの拡張は `node/src/tools/` または `python/src/pmsec/tools/` にプラグインを追加すれば対応できます。スコープを絞るため v1 は npm + uv のみです。

## CI での使い方

```yaml
- run: npx pmsec check --min 7
```

これだけで PR / CI で「cooldown が緩んでないか」を gate できます。

## 既存 OSS との比較

- [`cooldowns.dev`](https://cooldowns.dev/) (`cooldowns.sh`) — bash 製、対象ツールが多い。シェル前提なので Windows / 軽量 CI で使いづらい。
- [`set-minimum-package-release-age`](https://github.com/dehrenschwender/set-minimum-package-release-age) — bash 製、Linux / macOS 別スクリプト。
- [StepSecurity NPM Package Cooldown Check](https://www.stepsecurity.io/blog/introducing-the-npm-package-cooldown-check) — GitHub PR 専用 SaaS。

`pmsec` の差分: **OS 非依存で `npx` / `uvx` 1 コマンド**。Windows・GitHub Actions・ローカル開発を同じ呼び出しでカバーし、uv 旧版への書き込み事故も preflight で防ぐ。

## 開発

```bash
# Node
cd node && node --test 'test/**/*.test.mjs'

# Python
cd python && uv run --with pytest pytest -q
```

## License

MIT
