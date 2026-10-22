#!/bin/sh
# Creates the local non-distribution Android release key once (never committed; the directory is gitignored):
#   <dir>/mobilebench-local.jks and <dir>/keystore.properties (storeFile, storePassword, keyAlias, keyPassword)
# with a random password. Stand-in for the repository-level `make keystore` (out/keys/), which the integration step
# provides; candidates read the properties file through MB_KEYSTORE_PROPERTIES.
# Usage: sh candidates/_rn-shared/tools/ensure-keystore.sh <dir>   (needs keytool from JDK 17 on PATH)
set -eu
dir="$1"
props="$dir/keystore.properties"
if [ -f "$props" ] && [ -f "$dir/mobilebench-local.jks" ]; then
  exit 0
fi
mkdir -p "$dir"
umask 077
pass=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
keytool -genkeypair -noprompt -v \
  -keystore "$dir/mobilebench-local.jks" -storetype PKCS12 \
  -alias mobilebench -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$pass" -keypass "$pass" \
  -dname "CN=mobilebench local non-distribution key, O=example.org" >/dev/null 2>&1
{
  printf 'storeFile=%s\n' "$(cd "$dir" && pwd)/mobilebench-local.jks"
  printf 'storePassword=%s\n' "$pass"
  printf 'keyAlias=mobilebench\n'
  printf 'keyPassword=%s\n' "$pass"
} > "$props"
echo "created local non-distribution key in $dir"
