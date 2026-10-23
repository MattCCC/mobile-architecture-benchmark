#!/bin/sh
# Creates a local, non-distribution Android signing key for this candidate's release builds:
#   candidates/native/android/.keys/mobilebench-local.jks + keystore.properties (both gitignored).
# The repository-wide key from `make keystore` (out/keys/keystore.properties) takes precedence when present.
# Needs keytool from a JDK (JAVA_HOME). Does nothing if the key already exists.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
dir="$here/../android/.keys"
props="$dir/keystore.properties"
if [ -f "$props" ]; then
  echo "exists: $props"
  exit 0
fi
keytool_bin="${JAVA_HOME:+$JAVA_HOME/bin/}keytool"
mkdir -p "$dir"
pass=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
"$keytool_bin" -genkeypair -noprompt \
  -keystore "$dir/mobilebench-local.jks" -storetype PKCS12 \
  -storepass "$pass" -keypass "$pass" \
  -alias mobilebench -keyalg RSA -keysize 2048 -validity 3650 \
  -dname "CN=mobilebench local, O=example" >/dev/null 2>&1
umask 077
{
  echo "storeFile=mobilebench-local.jks"
  echo "storePassword=$pass"
  echo "keyAlias=mobilebench"
  echo "keyPassword=$pass"
} > "$props"
echo "created: $dir/mobilebench-local.jks (local, non-distribution key; never commit it)"
