<h1 align="center">pmsec</h1>

<p align="center">
  Install-time cooldown for npm / pnpm / yarn / bun / cargo / mise / uv.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@hikae/pmsec">npm</a> · <a href="https://pypi.org/project/pmsec/">PyPI</a>
</p>

```bash
npx @hikae/pmsec check --min 7   # CI gate, exit 1 if any tool below 7 days
npx @hikae/pmsec set 7           # write 7-day cooldown to all tools
npx @hikae/pmsec unset           # remove cooldown keys only
```

`uvx pmsec ...` でも同じ。`--tool npm,pnpm,yarn,bun,cargo,mise,uv` で対象を絞り、`--json` で機械可読出力。

書き込み先と key:

- **npm** `~/.npmrc` `min-release-age` (npm 11.10+)
- **pnpm** `~/.npmrc` `minimum-release-age` (pnpm 10.6+)
- **yarn** `~/.yarnrc.yml` `npmMinimalAgeGate` (yarn 4.10+)
- **bun** `~/.bunfig.toml` `[install].minimumReleaseAge` (bun 1.3+)
- **cargo** `$CARGO_HOME/config.toml` `[install].minimum-release-age`
- **mise** `~/.config/mise/config.toml` `[settings].minimum_release_age` (mise 2026.4.22+)
- **uv** `~/.config/uv/uv.toml` `exclude-newer` (uv 0.9.17+)

ランタイムが古くて key を無視する場合は ⚠ で告知。書き込み先が他ユーザー所有なら自動で `sudo chown` を 1 回挟んで書き戻す。

[MIT](LICENSE)
