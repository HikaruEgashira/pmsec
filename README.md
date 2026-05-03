<h1 align="center">pmsec</h1>

<p align="center">
  Install-time cooldown for npm / pnpm / yarn / bun / cargo / mise / uv.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pmsec">npm</a> · <a href="https://pypi.org/project/pmsec/">PyPI</a>
</p>

```bash
npx pmsec check --min 7
npx pmsec set 7
npx pmsec unset
```

```bash
uvx pmsec check --min 7
uvx pmsec set 7
uvx pmsec unset
```

> Bootstrap: pmsec itself is subject to cooldown, so the very first install
> may be filtered. Override just for that call
>
> ```bash
> npx --registry=https://registry.npmjs.org/ --min-release-age=0 pmsec check
> uvx --index https://pypi.org/simple --exclude-newer-package pmsec=2099-01-01 pmsec check
> ```

supported tools

- npm `~/.npmrc` `min-release-age` (npm 11.10+)
- pnpm `~/.npmrc` `minimum-release-age` (pnpm 10.6+)
- yarn `~/.yarnrc.yml` `npmMinimalAgeGate` (yarn 4.10+)
- bun `~/.bunfig.toml` `[install].minimumReleaseAge` (bun 1.3+)
- cargo `$CARGO_HOME/config.toml` `[install].minimum-release-age`
- mise `~/.config/mise/config.toml` `[settings].minimum_release_age` (mise 2026.4.22+)
- uv `~/.config/uv/uv.toml` `exclude-newer` (uv 0.9.17+)

[MIT](LICENSE)
