#!/usr/bin/env bash

# Source this helper from a shell running with set -euo pipefail. A confirmed
# supersession exits the caller before activation; all other mismatches fail.
assert_web_release_is_current() {
    local repo_root="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        return 0
    fi
    if [[ "${PAWS_WEB_SKIP_SUPERSEDED:-}" == '1' && -n "${GITHUB_OUTPUT:-}" ]] \
        && git -C "$repo_root" merge-base --is-ancestor "$expected" "$actual"; then
        printf 'superseded=true\nsuperseded_by=%s\n' "$actual" >> "$GITHUB_OUTPUT"
        echo "::notice::Web deployment skipped: $expected was superseded by origin/main $actual."
        exit 0
    fi
    echo "错误：当前发布提交 $expected 与 origin/main $actual 不一致。" >&2
    exit 1
}
