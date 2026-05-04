#!/usr/bin/env bash
# Mirrors node/test/cli.test.mjs — runs the bash port against a fresh $HOME
# and checks the same on-disk shape.
set -o pipefail

HERE=$(cd -- "$(dirname -- "$0")" && pwd)
PMSEC="$HERE/../pmsec"
PASS=0
FAIL=0
LAST_FAIL=""

setup_home() {
  local d
  d=$(mktemp -d -t pmsec-bash.XXXXXX)
  printf '%s' "$d"
}

# run [extra envs...] -- pmsec args...
run_pmsec() {
  local home="$1"; shift
  local extra=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    extra[${#extra[@]}]="$1"; shift
  done
  shift
  if [ "${#extra[@]}" -eq 0 ]; then
    env -i PATH="$PATH" HOME="$home" XDG_CONFIG_HOME="$home/.config" \
      bash "$PMSEC" "$@"
  else
    env -i PATH="$PATH" HOME="$home" XDG_CONFIG_HOME="$home/.config" \
      "${extra[@]}" bash "$PMSEC" "$@"
  fi
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    return 0
  fi
  LAST_FAIL="$label
  expected: $(printf '%q' "$expected")
  actual:   $(printf '%q' "$actual")"
  return 1
}

assert_file_eq() {
  local label="$1" expected_content="$2" path="$3" tmp diff_out
  tmp=$(mktemp)
  printf '%s' "$expected_content" > "$tmp"
  if diff_out=$(diff -u "$tmp" "$path" 2>&1); then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  LAST_FAIL="$label
$diff_out"
  return 1
}

assert_match() {
  local label="$1" pattern="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -E -q -- "$pattern"; then
    return 0
  fi
  LAST_FAIL="$label
  pattern: $pattern
  body:    $(printf '%s' "$haystack" | head -c 400)"
  return 1
}

T() {
  local name="$1"; shift
  if "$@"; then
    PASS=$((PASS+1))
    printf 'PASS  %s\n' "$name"
  else
    FAIL=$((FAIL+1))
    printf 'FAIL  %s\n%s\n' "$name" "$LAST_FAIL"
  fi
}

# ---------- tests ----------

t_enable_writes_all() {
  local home; home=$(setup_home)
  run_pmsec "$home" -- enable >/dev/null
  local npmrc bunfig yarnrc uvtoml mise
  npmrc=$(cat "$home/.npmrc")
  bunfig=$(cat "$home/.bunfig.toml")
  yarnrc=$(cat "$home/.yarnrc.yml")
  uvtoml=$(cat "$home/.config/uv/uv.toml")
  mise=$(cat "$home/.config/mise/config.toml")
  assert_match "npm key" '^min-release-age=3$' "$npmrc" || return
  assert_match "pnpm key" '^minimum-release-age=4320$' "$npmrc" || return
  assert_match "bun section" '^\[install\]$' "$bunfig" || return
  assert_match "bun key" '^minimumReleaseAge = 259200$' "$bunfig" || return
  assert_match "yarn key" '^npmMinimalAgeGate: "3d"$' "$yarnrc" || return
  assert_match "uv key" '^exclude-newer = "3 days"$' "$uvtoml" || return
  assert_match "mise section" '^\[settings\]$' "$mise" || return
  assert_match "mise key" '^minimum_release_age = "3d"$' "$mise" || return
  assert_match "mise paranoid extra" '^paranoid = true$' "$mise" || return
  assert_match "npm audit-level extra" '^audit-level=high$' "$npmrc" || return
  assert_match "pnpm trust-policy extra" '^trust-policy=no-downgrade$' "$npmrc" || return
  assert_match "pnpm block-exotic-subdeps extra" '^block-exotic-subdeps=true$' "$npmrc" || return
  assert_match "yarn enableHardenedMode extra" '^enableHardenedMode: true$' "$yarnrc" || return
  rm -rf -- "$home"
}

t_check_passes_after_enable() {
  local home; home=$(setup_home)
  run_pmsec "$home" -- enable >/dev/null
  run_pmsec "$home" -- check >/dev/null
  local rc=$?
  rm -rf -- "$home"
  assert_eq "exit code" "0" "$rc"
}

t_check_fails_when_missing() {
  local home; home=$(setup_home)
  local out rc
  out=$(run_pmsec "$home" -- check 2>/dev/null)
  rc=$?
  rm -rf -- "$home"
  assert_eq "exit code" "1" "$rc" || return
  for t in npm pnpm yarn bun cargo mise uv; do
    assert_match "MISSING $t" "MISSING $t" "$out" || return
  done
}

t_disable_preserves_unrelated_keys() {
  local home; home=$(setup_home)
  printf 'registry=https://r/\nmin-release-age=3\nminimum-release-age=4320\n' > "$home/.npmrc"
  mkdir -p "$home/.config/uv"
  printf 'exclude-newer = "3 days"\nindex-strategy = "unsafe-best-match"\n' > "$home/.config/uv/uv.toml"
  printf '[install]\nminimumReleaseAge = 259200\nregistry = "https://x/"\n' > "$home/.bunfig.toml"
  printf 'npmMinimalAgeGate: "3d"\nnpmRegistryServer: "https://r/"\n' > "$home/.yarnrc.yml"
  run_pmsec "$home" -- disable >/dev/null
  assert_file_eq "npmrc" 'registry=https://r/
' "$home/.npmrc" || { rm -rf "$home"; return 1; }
  assert_file_eq "uv.toml" 'index-strategy = "unsafe-best-match"
' "$home/.config/uv/uv.toml" || { rm -rf "$home"; return 1; }
  assert_file_eq "bunfig" '[install]
registry = "https://x/"
' "$home/.bunfig.toml" || { rm -rf "$home"; return 1; }
  assert_file_eq "yarnrc" 'npmRegistryServer: "https://r/"
' "$home/.yarnrc.yml" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_enable_upgrades_weak_existing_value() {
  local home; home=$(setup_home)
  printf 'min-release-age=1\nregistry=https://r/\n' > "$home/.npmrc"
  run_pmsec "$home" -- enable --tool npm >/dev/null
  assert_file_eq "npmrc" 'min-release-age=3
registry=https://r/
audit-level=high
' "$home/.npmrc" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_enable_preserves_stricter_existing_cooldown() {
  local home; home=$(setup_home)
  printf 'min-release-age=99\nregistry=https://r/\n' > "$home/.npmrc"
  local out
  out=$(run_pmsec "$home" -- enable --tool npm)
  assert_match "keep line printed" '^keep ' "$out" || { rm -rf "$home"; return 1; }
  assert_file_eq "npmrc preserves 99" 'min-release-age=99
registry=https://r/
audit-level=high
' "$home/.npmrc" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_enable_force_overwrites_stricter_existing() {
  local home; home=$(setup_home)
  printf 'min-release-age=99\n' > "$home/.npmrc"
  run_pmsec "$home" -- enable --tool npm --days 1 --force >/dev/null
  assert_match "force downgraded to 1" '^min-release-age=1$' "$(cat "$home/.npmrc")" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_enable_days_upgrades_when_request_exceeds_existing() {
  local home; home=$(setup_home)
  printf 'min-release-age=3\n' > "$home/.npmrc"
  run_pmsec "$home" -- enable --tool npm --days 14 >/dev/null
  assert_match "upgraded to 14" '^min-release-age=14$' "$(cat "$home/.npmrc")" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_tool_filter_restricts() {
  local home; home=$(setup_home)
  run_pmsec "$home" -- enable --tool npm,bun >/dev/null
  [ -f "$home/.npmrc" ] || { LAST_FAIL=".npmrc not written"; rm -rf "$home"; return 1; }
  [ -f "$home/.bunfig.toml" ] || { LAST_FAIL=".bunfig.toml not written"; rm -rf "$home"; return 1; }
  [ ! -f "$home/.config/uv/uv.toml" ] || { LAST_FAIL="uv.toml unexpectedly written"; rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_windows_uv_path() {
  local home; home=$(setup_home)
  local appdata="$home/AppData/Roaming"
  env -i PATH="$PATH" HOME="$home" APPDATA="$appdata" PMSEC_PLATFORM=win32 \
    bash "$PMSEC" enable --tool uv >/dev/null
  assert_match "uv key" '^exclude-newer = "3 days"$' "$(cat "$appdata/uv/uv.toml")" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_json_check() {
  local home; home=$(setup_home)
  local out
  out=$(run_pmsec "$home" -- check --json)
  rm -rf -- "$home"
  assert_match "ok false" '"ok": false' "$out" || return
  assert_match "bundleDays 3" '"bundleDays": 3' "$out" || return
  assert_match "rows include uv" '"tool": "uv"' "$out" || return
  assert_match "rows include cargo" '"tool": "cargo"' "$out" || return
}

t_bun_inserts_into_existing_section() {
  local home; home=$(setup_home)
  printf '[install]\nregistry = "https://x/"\n' > "$home/.bunfig.toml"
  run_pmsec "$home" -- enable --tool bun >/dev/null
  assert_file_eq "bunfig" '[install]
minimumReleaseAge = 259200
registry = "https://x/"
' "$home/.bunfig.toml" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_bun_creates_section_if_missing() {
  local home; home=$(setup_home)
  printf 'telemetry = false\n' > "$home/.bunfig.toml"
  run_pmsec "$home" -- enable --tool bun >/dev/null
  assert_file_eq "bunfig" 'telemetry = false

[install]
minimumReleaseAge = 259200
' "$home/.bunfig.toml" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_yarn_check_parses_days() {
  local home; home=$(setup_home)
  printf 'npmMinimalAgeGate: "14d"\nenableHardenedMode: true\n' > "$home/.yarnrc.yml"
  local out
  out=$(run_pmsec "$home" -- check --json --tool yarn)
  rm -rf -- "$home"
  assert_match "yarn ok" '"ok": true' "$out" || return
  assert_match "yarn days" '"days": 14' "$out" || return
}

t_pnpm_normalizes_minutes() {
  local home; home=$(setup_home)
  printf 'minimum-release-age=20160\n' > "$home/.npmrc"
  local out
  out=$(run_pmsec "$home" -- check --json --tool pnpm)
  rm -rf -- "$home"
  assert_match "pnpm days" '"days": 14' "$out" || return
}

t_bak_created_once() {
  local home; home=$(setup_home)
  printf 'registry=https://original/\n' > "$home/.npmrc"
  run_pmsec "$home" -- enable --tool npm >/dev/null
  run_pmsec "$home" -- disable --tool npm >/dev/null
  run_pmsec "$home" -- enable --tool npm >/dev/null
  assert_file_eq "bak" 'registry=https://original/
' "$home/.npmrc.bak" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_days_overrides_bundle_cooldown() {
  local home; home=$(setup_home)
  run_pmsec "$home" -- enable --days 7 >/dev/null
  assert_match "npm cooldown 7" '^min-release-age=7$' "$(cat "$home/.npmrc")" || { rm -rf "$home"; return 1; }
  assert_match "pnpm cooldown 10080m" '^minimum-release-age=10080$' "$(cat "$home/.npmrc")" || { rm -rf "$home"; return 1; }
  assert_match "uv 7 days" 'exclude-newer = "7 days"' "$(cat "$home/.config/uv/uv.toml")" || { rm -rf "$home"; return 1; }
  assert_match "bun 7d secs" 'minimumReleaseAge = 604800' "$(cat "$home/.bunfig.toml")" || { rm -rf "$home"; return 1; }

  local out rc
  out=$(run_pmsec "$home" -- check --json --days 7); rc=$?
  assert_eq "check days=7 exit" "0" "$rc" || { rm -rf "$home"; return 1; }
  assert_match "json days=7" '"bundleDays": 7' "$out" || { rm -rf "$home"; return 1; }

  run_pmsec "$home" -- check >/dev/null; rc=$?
  assert_eq "default check still passes" "0" "$rc" || { rm -rf "$home"; return 1; }

  run_pmsec "$home" -- check --days 30 >/dev/null 2>&1; rc=$?
  assert_eq "stricter check fails" "1" "$rc" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_days_rejects_invalid() {
  local home; home=$(setup_home)
  local rc
  for bad in 0 -1 abc ""; do
    run_pmsec "$home" -- enable --days "$bad" >/dev/null 2>&1; rc=$?
    assert_eq "days=$bad exit 2" "2" "$rc" || { rm -rf "$home"; return 1; }
  done
  rm -rf -- "$home"
}

t_enable_rejects_positional_arg() {
  local home; home=$(setup_home)
  local err rc
  err=$(run_pmsec "$home" -- enable 7 2>&1 1>/dev/null)
  rc=$?
  rm -rf -- "$home"
  assert_eq "exit code" "2" "$rc" || return 1
  assert_match "msg" "unexpected argument: 7" "$err"
}

t_version_flag() {
  local expected
  expected=$(grep -E '^PMSEC_VERSION=' "$PMSEC" | head -1 | sed -E 's/^PMSEC_VERSION="([^"]+)".*/\1/')
  for flag in --version -V; do
    local home out rc
    home=$(setup_home)
    out=$(run_pmsec "$home" -- "$flag" 2>&1)
    rc=$?
    rm -rf -- "$home"
    assert_eq "$flag exit" "0" "$rc" || return 1
    assert_eq "$flag out" "pmsec $expected" "$out" || return 1
  done
}

t_hardening_extras_roundtrip() {
  local home; home=$(setup_home)
  printf 'minimum-release-age=20160\n' > "$home/.npmrc"
  local out rc
  out=$(run_pmsec "$home" -- check --json --tool pnpm 2>/dev/null); rc=$?
  assert_eq "extras-missing exit" "1" "$rc" || { rm -rf "$home"; return 1; }
  assert_match "extras-missing ok=false" '"ok": false' "$out" || { rm -rf "$home"; return 1; }
  run_pmsec "$home" -- enable --tool pnpm >/dev/null
  assert_match "trust-policy written" '^trust-policy=no-downgrade$' "$(cat "$home/.npmrc")" || { rm -rf "$home"; return 1; }
  assert_match "block-exotic-subdeps written" '^block-exotic-subdeps=true$' "$(cat "$home/.npmrc")" || { rm -rf "$home"; return 1; }
  out=$(run_pmsec "$home" -- check --json --tool pnpm); rc=$?
  assert_eq "after-enable exit" "0" "$rc" || { rm -rf "$home"; return 1; }
  assert_match "after-enable ok=true" '"ok": true' "$out" || { rm -rf "$home"; return 1; }
  run_pmsec "$home" -- disable --tool pnpm >/dev/null
  local after; after=$(cat "$home/.npmrc")
  ! printf '%s' "$after" | grep -q 'trust-policy' || { LAST_FAIL="trust-policy not removed"; rm -rf "$home"; return 1; }
  ! printf '%s' "$after" | grep -q 'block-exotic-subdeps' || { LAST_FAIL="block-exotic-subdeps not removed"; rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

T "enable writes the bundle for every tool" t_enable_writes_all
T "check passes after enable across all tools" t_check_passes_after_enable
T "check fails when bundle missing" t_check_fails_when_missing
T "disable preserves unrelated keys per file" t_disable_preserves_unrelated_keys
T "enable upgrades values that are weaker than the request" t_enable_upgrades_weak_existing_value
T "enable preserves stricter existing cooldowns" t_enable_preserves_stricter_existing_cooldown
T "enable --days upgrades when request exceeds existing" t_enable_days_upgrades_when_request_exceeds_existing
T "enable --force overwrites stricter existing values" t_enable_force_overwrites_stricter_existing
T "--tool restricts which tools get written" t_tool_filter_restricts
T "Windows uv path uses APPDATA" t_windows_uv_path
T "--json emits parseable JSON for check" t_json_check
T "bun enable inserts into existing [install] section" t_bun_inserts_into_existing_section
T "bun enable creates [install] section if missing" t_bun_creates_section_if_missing
T "yarn check parses npmMinimalAgeGate days correctly" t_yarn_check_parses_days
T "pnpm check normalizes minutes to days" t_pnpm_normalizes_minutes
T ".bak is created once and never overwritten" t_bak_created_once
T "--days N overrides bundle cooldown for enable and check" t_days_overrides_bundle_cooldown
T "--days rejects non-positive integers with exit 2" t_days_rejects_invalid
T "enable rejects positional argument with exit 2" t_enable_rejects_positional_arg
T "--version prints PMSEC_VERSION" t_version_flag
T "hardening extras roundtrip (check / enable / disable)" t_hardening_extras_roundtrip

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ]
