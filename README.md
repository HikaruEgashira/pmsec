# pmsec

`pmsec` は npm / pnpm / yarn / bun / cargo / mise / uv の **install-time cooldown**（新しく公開されたパッケージを一定期間インストールさせない設定）を一括で検査・適用する CLI です。

供給チェーン攻撃の多くは公開後数時間〜数日で検出・撤去されるため、3〜7 日程度の cooldown を入れるだけで影響範囲を大きく削れます。

- Node 版（`npx`）と Python 版（`uvx`）を同梱、依存ゼロ
- check / set / unset を持ち、`check` は不足時に exit 1（CI gate に使える）
- macOS / Linux / Windows のパス解決対応
- `set` 時に各ツールの `--version` を preflight し、cooldown キーが認識されない古いランタイムへの書き込み事故を防止（uv は config を読めず壊れるため block、それ以外は warn）

## 対応ツール

| Tool | Key | Unit | Path (Unix / Windows) | Min |
|------|-----|------|------------------------|-----|
| npm | `min-release-age` | days | `~/.npmrc` | 11.10 |
| pnpm | `minimum-release-age` | minutes | `~/.npmrc` | 10.6 |
| yarn (v4+) | `npmMinimalAgeGate` | duration `"7d"` | `~/.yarnrc.yml` | 4.10 |
| bun | `[install].minimumReleaseAge` | seconds | `~/.bunfig.toml` | 1.3 |
| cargo | `[install].minimum-release-age` | duration `"7d"` | `$CARGO_HOME/config.toml` / `~/.cargo/config.toml` | RFC #3801 |
| mise | `[settings].minimum_release_age` | duration `"7d"` | `~/.config/mise/config.toml` / `%LOCALAPPDATA%\mise\config.toml` | latest |
| uv | `exclude-newer` | duration `"7 days"` | `~/.config/uv/uv.toml` / `%APPDATA%\uv\uv.toml` | 0.9.17 |

`pmsec set 7` 一回で全ツールに 7 日 cooldown を書き込みます。各ツールが要求する単位（日 / 分 / 秒 / duration string）には pmsec が自動変換するので、ユーザは「日数」だけ意識すればよい構造です。

> note: pnpm の旧名 `installBefore` (= `install_before`) は `minimumReleaseAge` に rename されており、pmsec は新名のみ書き出します。mise も同様に `install_before` → `minimum_release_age` を踏襲しています。

## このリポジトリから直接実行する

```bash
# Node（要 Node 20+）
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
npx -p @hikae/pmsec pmsec check --min 7
npx -p @hikae/pmsec pmsec set 7

uvx pmsec check --min 7
uvx pmsec set 7
```

公開状況: [npm `@hikae/pmsec`](https://www.npmjs.com/package/@hikae/pmsec) / [PyPI](https://pypi.org/project/pmsec/) — どちらもタグ push (`pmsec-node-vX.Y.Z` / `pmsec-py-vX.Y.Z`) で `.github/workflows/pmsec-release-*.yml` がトリガーする trusted publishing で配布します。

## コマンド

| Command | 説明 |
| --- | --- |
| `pmsec check [--min N]` | 各ツールの設定を読み、`min` 未満 / 未設定があれば exit 1 |
| `pmsec set <DAYS> [--force]` | 全対象ツールに `DAYS` 日の cooldown を書き込み（uv 旧版検出時は `--force` 必須） |
| `pmsec unset` | 各設定ファイルから cooldown キーのみ削除（他キーは保持） |

オプション:

- `--tool npm,pnpm,yarn,bun,cargo,mise,uv` — 対象ツールを限定
- `--json` — JSON 出力（CI 連携用）

## 環境変数による上書き

| 変数 | 用途 |
|------|------|
| `NPM_CONFIG_USERCONFIG` | npm / pnpm の config パス（`.npmrc`） |
| `BUN_CONFIG_FILE` | bun の `.bunfig.toml` |
| `YARN_RC_FILENAME` | yarn の `.yarnrc.yml` |
| `CARGO_HOME` | cargo の `config.toml` |
| `MISE_GLOBAL_CONFIG_FILE` | mise の `config.toml` |
| `UV_CONFIG_FILE` | uv の `uv.toml` |
| `XDG_CONFIG_HOME` / `APPDATA` / `LOCALAPPDATA` | 各 OS の標準ベースを上書き |

## 安全性

`set` 時、初回のみ既存ファイルを `.bak` にバックアップしてから書き換えます（2 回目以降は元の手書き設定を上書き保存しない）。`[section]` ヘッダの前後を尊重し、既存キーは in-place 置換するので他の設定行は壊しません。bun / mise については対応セクション（`[install]` / `[settings]`）が無ければ自動追加します。

## CI での使い方

```yaml
- run: npx -p @hikae/pmsec pmsec check --min 7
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
cd node && node --test

# Python
cd python && uv run --with pytest pytest -q
```

## License

MIT
