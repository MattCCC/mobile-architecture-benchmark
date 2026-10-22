#!/bin/sh
# Prints `export` lines for an Android build (sourced by the RN-family candidate.mk recipes):
#   JAVA_HOME: $MB_JAVA_HOME, else $JAVA_HOME if it is JDK 17, else /usr/libexec/java_home -v 17,
#              else Homebrew openjdk@17, else /usr/lib/jvm/*17*
#   ANDROID_HOME: $ANDROID_HOME, else $ANDROID_SDK_ROOT, else ~/Library/Android/sdk (macOS) or ~/Android/Sdk (Linux)
# Resolved paths are printed for the local shell only and never written to committed files or manifests.
# Usage: eval "$(sh candidates/_rn-shared/tools/android-env.sh)"
set -u

is_jdk17() {
  [ -x "$1/bin/java" ] && "$1/bin/java" -version 2>&1 | head -n 1 | grep -Eq 'version "17(\.|")'
}

jdk=""
for candidate in "${MB_JAVA_HOME:-}" "${JAVA_HOME:-}"; do
  if [ -n "$candidate" ] && is_jdk17 "$candidate"; then
    jdk="$candidate"
    break
  fi
done
if [ -z "$jdk" ] && [ -x /usr/libexec/java_home ]; then
  c=$(/usr/libexec/java_home -v 17 2>/dev/null || true)
  if [ -n "$c" ] && is_jdk17 "$c"; then
    jdk="$c"
  fi
fi
if [ -z "$jdk" ] && command -v brew >/dev/null 2>&1; then
  prefix=$(brew --prefix openjdk@17 2>/dev/null || true)
  if [ -n "$prefix" ] && is_jdk17 "$prefix/libexec/openjdk.jdk/Contents/Home"; then
    jdk="$prefix/libexec/openjdk.jdk/Contents/Home"
  fi
fi
if [ -z "$jdk" ]; then
  for c in /usr/lib/jvm/*17*; do
    if [ -d "$c" ] && is_jdk17 "$c"; then
      jdk="$c"
      break
    fi
  done
fi

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$sdk" ]; then
  if [ -d "$HOME/Library/Android/sdk" ]; then
    sdk="$HOME/Library/Android/sdk"
  elif [ -d "$HOME/Android/Sdk" ]; then
    sdk="$HOME/Android/Sdk"
  fi
fi

if [ -z "$jdk" ]; then
  echo "echo 'not-verified: toolchain-missing:jdk17 (set MB_JAVA_HOME to a JDK 17)' >&2; exit 3"
  exit 0
fi
if [ -z "$sdk" ] || [ ! -d "$sdk/platform-tools" ]; then
  echo "echo 'not-verified: toolchain-missing:android-sdk (set ANDROID_HOME)' >&2; exit 3"
  exit 0
fi
printf 'export JAVA_HOME="%s"\n' "$jdk"
printf 'export ANDROID_HOME="%s"\n' "$sdk"
printf 'export PATH="%s/bin:%s/platform-tools:%s/emulator:$PATH"\n' "$jdk" "$sdk" "$sdk"
