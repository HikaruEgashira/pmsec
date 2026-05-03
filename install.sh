#!/usr/bin/env sh
# pmsec installer (POSIX sh)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/install.sh | sh -s 0.2.4
#
# Env overrides:
#   PMSEC_HOME       install root         (default: $HOME/.pmsec)
#   PMSEC_BIN_DIR    shim directory       (default: $HOME/.local/bin)
#   PMSEC_REGISTRY   npm registry base    (default: https://registry.npmjs.org)

set -eu

NPM_PKG="@hikae/pmsec"
REGISTRY="${PMSEC_REGISTRY:-https://registry.npmjs.org}"
INSTALL_DIR="${PMSEC_HOME:-$HOME/.pmsec}"
BIN_DIR="${PMSEC_BIN_DIR:-$HOME/.local/bin}"
VERSION="${1:-latest}"

die() { printf 'pmsec: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required"; }

need curl
need tar
need node

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$node_major" -ge 20 ] || die "node >= 20 required (have $(node -v 2>/dev/null || echo none))"

# Resolve tarball URL + SHA-512 integrity from the registry metadata.
meta_url="$REGISTRY/$NPM_PKG/$VERSION"
meta=$(curl -fsSL "$meta_url") || die "failed to fetch $meta_url"

tarball_url=$(printf '%s' "$meta" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { process.stdout.write(JSON.parse(s).dist.tarball); }
    catch(e){ process.exit(1); }
  })') || die "failed to parse tarball URL"

integrity=$(printf '%s' "$meta" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { process.stdout.write(JSON.parse(s).dist.integrity || ""); }
    catch(e){ process.exit(1); }
  })') || true

resolved_version=$(printf '%s' "$meta" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { process.stdout.write(JSON.parse(s).version); }
    catch(e){ process.exit(1); }
  })') || die "failed to parse version"

tmp=$(mktemp -d 2>/dev/null || mktemp -d -t pmsec)
trap 'rm -rf "$tmp"' EXIT INT TERM
tgz="$tmp/pmsec.tgz"

curl -fsSL "$tarball_url" -o "$tgz" || die "failed to download $tarball_url"

# Verify SHA-512 integrity ("sha512-<base64>").
case "$integrity" in
  sha512-*)
    expected=${integrity#sha512-}
    if command -v openssl >/dev/null 2>&1; then
      got=$(openssl dgst -sha512 -binary "$tgz" | openssl base64 -A)
    elif command -v shasum >/dev/null 2>&1; then
      got=$(shasum -a 512 -b "$tgz" | awk '{print $1}' | xxd -r -p | base64 | tr -d '\n')
    else
      die "openssl or shasum required for integrity verification"
    fi
    [ "$expected" = "$got" ] || die "integrity mismatch (expected $expected got $got)"
    ;;
  *)
    printf 'pmsec: warning: registry returned no integrity hash, skipping verification\n' >&2
    ;;
esac

mkdir -p "$INSTALL_DIR" "$BIN_DIR"

# Replace contents atomically: stage a fresh dir, then swap.
stage="$tmp/stage"
mkdir -p "$stage"
tar -xzf "$tgz" -C "$stage" --strip-components=1 || die "extraction failed"

old="$INSTALL_DIR.old.$$"
if [ -e "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
  mv "$INSTALL_DIR" "$old"
fi
mkdir -p "$INSTALL_DIR"
# Move staged contents (including dotfiles) into the install dir.
( cd "$stage" && tar -cf - . ) | ( cd "$INSTALL_DIR" && tar -xf - )
[ -d "$old" ] && rm -rf "$old"

shim="$BIN_DIR/pmsec"
cat > "$shim" <<SHIM
#!/usr/bin/env sh
exec node "$INSTALL_DIR/bin/cli.mjs" "\$@"
SHIM
chmod +x "$shim"

printf 'pmsec %s installed\n' "$resolved_version"
printf '  files: %s\n' "$INSTALL_DIR"
printf '  shim:  %s\n' "$shim"

case ":${PATH:-}:" in
  *":$BIN_DIR:"*) ;;
  *)
    printf '\npmsec: %s is not on PATH. Add this line to your shell rc:\n' "$BIN_DIR"
    printf '  export PATH="%s:$PATH"\n' "$BIN_DIR"
    ;;
esac
