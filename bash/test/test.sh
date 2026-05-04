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
# example: run XDG_CONFIG_HOME=$home/.config -- set 7
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

t_set_writes_all() {
  local home; home=$(setup_home)
  run_pmsec "$home" -- set 7 >/dev/null
  local npmrc bunfig yarnrc uvtoml mise
  npmrc=$(cat "$home/.npmrc")
  bunfig=$(cat "$home/.bunfig.toml")
  yarnrc=$(cat "$home/.yarnrc.yml")
  uvtoml=$(cat "$home/.config/uv/uv.toml")
  mise=$(cat "$home/.config/mise/config.toml")
  assert_match "npm key" '^min-release-age=7$' "$npmrc" || return
  assert_match "pnpm key" '^minimum-release-age=10080$' "$npmrc" || return
  assert_match "bun section" '^\[install\]$' "$bunfig" || return
  assert_match "bun key" '^minimumReleaseAge = 604800$' "$bunfig" || return
  assert_match "yarn key" '^npmMinimalAgeGate: "7d"$' "$yarnrc" || return
  assert_match "uv key" '^exclude-newer = "7 days"$' "$uvtoml" || return
  assert_match "mise section" '^\[settings\]$' "$mise" || return
  assert_match "mise key" '^minimum_release_age = "7d"$' "$mise" || return
  assert_match "mise paranoid extra" '^paranoid = true$' "$mise" || return
  assert_match "npm audit-level extra" '^audit-level=high$' "$npmrc" || return
  assert_match "pnpm trust-policy extra" '^trust-policy=no-downgrade$' "$npmrc" || return
  assert_match "pnpm block-exotic-subdeps extra" '^block-exotic-subdeps=true$' "$npmrc" || return
  assert_match "yarn enableHardenedMode extra" '^enableHardenedMode: true$' "$yarnrc" || return
  rm -rf -- "$home"
}

t_check_passes_after_set() {
  local home; home=$(setup_home)
  run_pmsec "$home" -- set 7 >/dev/null
  run_pmsec "$home" -- check --min 7 >/dev/null
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

t_unset_preserves_unrelated_keys() {
  local home; home=$(setup_home)
  printf 'registry=https://r/\nmin-release-age=7\nminimum-release-age=10080\n' > "$home/.npmrc"
  mkdir -p "$home/.config/uv"
  printf 'exclude-newer = "7 days"\nindex-strategy = "unsafe-best-match"\n' > "$home/.config/uv/uv.toml"
  printf '[install]\nminimumReleaseAge = 604800\nregistry = "https://x/"\n' > "$home/.bunfig.toml"
  printf 'npmMinimalAgeGate: "7d"\nnpmRegistryServer: "https://r/"\n' > "$home/.yarnrc.yml"
  run_pmsec "$home" -- unset >/dev/null
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

t_set_replaces_existing_value() {
  local home; home=$(setup_home)
  printf 'min-release-age=3\nregistry=https://r/\n' > "$home/.npmrc"
  run_pmsec "$home" -- set 10 --tool npm >/dev/null
  assert_file_eq "npmrc" 'min-release-age=10
registry=https://r/
audit-level=high
' "$home/.npmrc" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_tool_filter_restricts() {
  local home; home=$(setup_home)
  run_pmsec "$home" -- set 7 --tool npm,bun >/dev/null
  [ -f "$home/.npmrc" ] || { LAST_FAIL=".npmrc not written"; rm -rf "$home"; return 1; }
  [ -f "$home/.bunfig.toml" ] || { LAST_FAIL=".bunfig.toml not written"; rm -rf "$home"; return 1; }
  [ ! -f "$home/.config/uv/uv.toml" ] || { LAST_FAIL="uv.toml unexpectedly written"; rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_windows_uv_path() {
  local home; home=$(setup_home)
  local appdata="$home/AppData/Roaming"
  env -i PATH="$PATH" HOME="$home" APPDATA="$appdata" PMSEC_PLATFORM=win32 \
    bash "$PMSEC" set 7 --tool uv >/dev/null
  assert_match "uv key" '^exclude-newer = "7 days"$' "$(cat "$appdata/uv/uv.toml")" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_json_check() {
  local home; home=$(setup_home)
  local out
  out=$(run_pmsec "$home" -- check --json)
  rm -rf -- "$home"
  assert_match "ok false" '"ok": false' "$out" || return
  assert_match "rows length" '"tool": "uv"' "$out" || return
  assert_match "rows include cargo" '"tool": "cargo"' "$out" || return
}

t_bun_inserts_into_existing_section() {
  local home; home=$(setup_home)
  printf '[install]\nregistry = "https://x/"\n' > "$home/.bunfig.toml"
  run_pmsec "$home" -- set 7 --tool bun >/dev/null
  assert_file_eq "bunfig" '[install]
minimumReleaseAge = 604800
registry = "https://x/"
' "$home/.bunfig.toml" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_bun_creates_section_if_missing() {
  local home; home=$(setup_home)
  printf 'telemetry = false\n' > "$home/.bunfig.toml"
  run_pmsec "$home" -- set 7 --tool bun >/dev/null
  assert_file_eq "bunfig" 'telemetry = false

[install]
minimumReleaseAge = 604800
' "$home/.bunfig.toml" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_yarn_check_parses_days() {
  local home; home=$(setup_home)
  printf 'npmMinimalAgeGate: "14d"\nenableHardenedMode: true\n' > "$home/.yarnrc.yml"
  local out
  out=$(run_pmsec "$home" -- check --json --tool yarn --min 7)
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
  run_pmsec "$home" -- set 7 --tool npm >/dev/null
  run_pmsec "$home" -- set 10 --tool npm >/dev/null
  assert_file_eq "bak" 'registry=https://original/
' "$home/.npmrc.bak" || { rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

t_set_zero_days_exits_2() {
  local home; home=$(setup_home)
  local err rc
  err=$(run_pmsec "$home" -- set 0 2>&1 1>/dev/null)
  rc=$?
  rm -rf -- "$home"
  assert_eq "exit code" "2" "$rc" || return 1
  assert_match "msg" "set requires integer DAYS > 0" "$err"
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
  out=$(run_pmsec "$home" -- check --json --tool pnpm --min 7 2>/dev/null); rc=$?
  assert_eq "extras-missing exit" "1" "$rc" || { rm -rf "$home"; return 1; }
  assert_match "extras-missing ok=false" '"ok": false' "$out" || { rm -rf "$home"; return 1; }
  run_pmsec "$home" -- set 14 --tool pnpm >/dev/null
  assert_match "trust-policy written" '^trust-policy=no-downgrade$' "$(cat "$home/.npmrc")" || { rm -rf "$home"; return 1; }
  assert_match "block-exotic-subdeps written" '^block-exotic-subdeps=true$' "$(cat "$home/.npmrc")" || { rm -rf "$home"; return 1; }
  out=$(run_pmsec "$home" -- check --json --tool pnpm --min 7); rc=$?
  assert_eq "after-set exit" "0" "$rc" || { rm -rf "$home"; return 1; }
  assert_match "after-set ok=true" '"ok": true' "$out" || { rm -rf "$home"; return 1; }
  run_pmsec "$home" -- unset --tool pnpm >/dev/null
  local after; after=$(cat "$home/.npmrc")
  ! printf '%s' "$after" | grep -q 'trust-policy' || { LAST_FAIL="trust-policy not removed"; rm -rf "$home"; return 1; }
  ! printf '%s' "$after" | grep -q 'block-exotic-subdeps' || { LAST_FAIL="block-exotic-subdeps not removed"; rm -rf "$home"; return 1; }
  rm -rf -- "$home"
}

T "set writes every supported tool config" t_set_writes_all
T "check passes after set across all tools" t_check_passes_after_set
T "check fails when missing or stale" t_check_fails_when_missing
T "unset preserves unrelated keys per file" t_unset_preserves_unrelated_keys
T "set replaces existing values in place" t_set_replaces_existing_value
T "--tool restricts which tools get written" t_tool_filter_restricts
T "Windows uv path uses APPDATA" t_windows_uv_path
T "--json emits parseable JSON for check" t_json_check
T "bun set inserts into existing [install] section" t_bun_inserts_into_existing_section
T "bun set creates [install] section if missing" t_bun_creates_section_if_missing
T "yarn check parses npmMinimalAgeGate days correctly" t_yarn_check_parses_days
T "pnpm check normalizes minutes to days" t_pnpm_normalizes_minutes
T ".bak is created once and never overwritten" t_bak_created_once
T "set 0 exits 2 with usage error" t_set_zero_days_exits_2
T "--version prints PMSEC_VERSION" t_version_flag
T "hardening extras roundtrip (check / set / unset)" t_hardening_extras_roundtrip

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ]
