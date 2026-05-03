<h1 align="center">pmsec</h1>

<p align="center">
  Install-time cooldown manager for npm / pnpm / yarn / bun / cargo / mise / uv.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@hikae/pmsec">npm</a> · <a href="https://pypi.org/project/pmsec/">PyPI</a>
</p>

---

`pmsec` は各パッケージマネージャの「公開直後 N 日はインストールしない」設定（`min-release-age` / `exclude-newer` 等）を一括で検査・適用する CLI です。供給チェーン攻撃の多くは公開後数時間〜数日で検出・撤去されるため、3〜7 日の cooldown を入れるだけで影響範囲が大きく削れます。

Node 版（`npx`）と Python 版（`uvx`）を同梱、依存ゼロ。macOS / Linux / Windows 対応。

## なぜ pmsec？

- **1 コマンドで 7 ツール一括** — 各マネージャごとに `~/.npmrc` `~/.bunfig.toml` `~/.yarnrc.yml` を覚えて手書きする必要がない
- **CI gate になる** — `pmsec check --min 7` は不足時 exit 1。PR で「cooldown が緩んでないか」を強制できる
- **ランタイム劣化に気付ける** — 古い npm / mise / uv が cooldown を silently ignore する場合は ⚠ 行で告知
- **権限事故から自己復旧** — `~/.npmrc` が root 所有になっていても `sudo chown` を 1 回挟んで書き戻す
- **OS 横断** — bash 製 OSS と違い Windows・GitHub Actions・ローカル開発を同じ呼び出しでカバー

## Quick Start

```bash
# 検査（CI gate 用、不足時 exit 1）
npx @hikae/pmsec check --min 7

# 7 日 cooldown を全ツールに書き込み
npx @hikae/pmsec set 7

# cooldown キーだけ削除（他の設定は触らない）
npx @hikae/pmsec unset
```

`uvx pmsec ...` でも同じ。`--tool npm,pnpm,yarn,bun,cargo,mise,uv` で対象を絞れます。

CI:

```yaml
- run: npx @hikae/pmsec check --min 7
```

## 対応ツールと書き込み先

`pmsec set 7` は単位（日 / 分 / 秒 / duration string）を自動変換します。ユーザは「日数」だけ指定すれば、各ツールが要求する形式に正しく書き換わります。

- **npm** — `~/.npmrc` の `min-release-age=DAYS`（要 npm 11.10+）
- **pnpm** — `~/.npmrc` の `minimum-release-age=MINUTES`（要 pnpm 10.6+）
- **yarn v4+** — `~/.yarnrc.yml` の `npmMinimalAgeGate: "7d"`（要 yarn 4.10+）
- **bun** — `~/.bunfig.toml` の `[install].minimumReleaseAge=SECONDS`（要 bun 1.3+）
- **cargo** — `$CARGO_HOME/config.toml` の `[install].minimum-release-age = "7d"`（RFC #3801）
- **mise** — `~/.config/mise/config.toml` の `[settings].minimum_release_age = "7d"`（要 mise 2026.4.22+）
- **uv** — `~/.config/uv/uv.toml` の `exclude-newer = "7 days"`（要 uv 0.9.17+）

環境変数 `NPM_CONFIG_USERCONFIG` / `BUN_CONFIG_FILE` / `YARN_RC_FILENAME` / `CARGO_HOME` / `MISE_GLOBAL_CONFIG_FILE` / `UV_CONFIG_FILE` で個別パスを上書き可能。Windows は `APPDATA` / `LOCALAPPDATA` を、Linux は `XDG_CONFIG_HOME` を尊重します。

## 安全性

`set` 時、初回のみ既存ファイルを `.bak` にバックアップしてから書き換えます（2 回目以降は手書き設定を上書き保存しません）。`[section]` ヘッダ前後を尊重し、既存キーは in-place 置換、対応セクション（`[install]` / `[settings]`）が無ければ自動追加します。

書き込み先ファイルが他ユーザー所有（典型例: 過去に `sudo npm config set` を叩いた `~/.npmrc`）の場合は自動で `sudo chown $(id -u):$(id -g) <path>` を発火して所有を取り戻し、書き込みを続行します。パスワード入力は初回 1 度だけ。

## 既存 OSS との比較

- [`cooldowns.dev`](https://cooldowns.dev/) — bash 製、対象ツールが多いが、シェル前提で Windows / 軽量 CI で使いづらい
- [`set-minimum-package-release-age`](https://github.com/dehrenschwender/set-minimum-package-release-age) — bash 製、Linux / macOS 別スクリプト
- [StepSecurity NPM Package Cooldown Check](https://www.stepsecurity.io/blog/introducing-the-npm-package-cooldown-check) — GitHub PR 専用 SaaS

`pmsec` は **OS 非依存で `npx` / `uvx` 1 コマンド**にまとめ、ランタイム検出と権限自己復旧を備えるのが差分です。

## 開発

```bash
cd node && node --test
cd python && uv run --with pytest pytest -q
```

## License

[MIT](LICENSE)
