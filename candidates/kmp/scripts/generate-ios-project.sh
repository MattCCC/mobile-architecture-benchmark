#!/bin/sh
set -eu
# Reuse CocoaPods' Ruby environment when available; no Pods are linked into this app.
if command -v pod >/dev/null 2>&1; then
  mb_gem_home=$(sed -n 's/^GEM_HOME="\([^"]*\)".*/\1/p' "$(command -v pod)")
  if [ -n "$mb_gem_home" ]; then export GEM_HOME="$mb_gem_home"; fi
fi
ruby "$(dirname "$0")/generate-ios-project.rb"
