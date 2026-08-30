#!/usr/bin/env bash
# One-shot claude-seo runtime setup for Claude Code remote (cloud) sessions.
#
# Cloud containers are ephemeral: the Python venv and browser links under
# .claude/skills/seo/ are lost when the container is reclaimed. Run this once
# per fresh session before using /seo commands that need bundled Python tools:
#
#   bash .claude/skills/seo/bin/setup-remote.sh
#
# The remote network policy blocks cdn.playwright.dev, so instead of
# downloading Chromium this links the container's pre-installed browsers
# (/opt/pw-browsers) into the revision layout the venv's Playwright expects.
set -euo pipefail

SEO_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
PW_SRC="${PW_SRC:-/opt/pw-browsers}"
MSPW="${SEO_DIR}/ms-playwright"

"${SEO_DIR}/bin/claude-seo" setup || true

if [ -d "${PW_SRC}" ]; then
    export SEO_DIR
    revisions=$("${SEO_DIR}/.venv/bin/python" - << 'PYEOF'
import glob, json, os
base = os.environ["SEO_DIR"]
path = glob.glob(f"{base}/.venv/lib/python*/site-packages/playwright/driver/package/browsers.json")
data = json.load(open(path[0]))
rev = {b["name"]: b["revision"] for b in data["browsers"]}
print(rev.get("chromium", ""), rev.get("chromium-headless-shell", ""))
PYEOF
    )
    chromium_rev=$(echo "${revisions}" | awk '{print $1}')
    shell_rev=$(echo "${revisions}" | awk '{print $2}')

    src_chromium=$(ls -d "${PW_SRC}"/chromium-*/ 2>/dev/null | head -1)
    src_shell=$(ls -d "${PW_SRC}"/chromium_headless_shell-*/ 2>/dev/null | head -1)

    if [ -n "${chromium_rev}" ] && [ -n "${src_chromium}" ]; then
        d="${MSPW}/chromium-${chromium_rev}/chrome-linux64"
        mkdir -p "${d}"
        ln -sfn "${src_chromium}chrome-linux/chrome" "${d}/chrome"
        touch "${MSPW}/chromium-${chromium_rev}/INSTALLATION_COMPLETE" \
              "${MSPW}/chromium-${chromium_rev}/DEPENDENCIES_VALIDATED"
    fi
    if [ -n "${shell_rev}" ] && [ -n "${src_shell}" ]; then
        d="${MSPW}/chromium_headless_shell-${shell_rev}/chrome-headless-shell-linux64"
        mkdir -p "${d}"
        ln -sfn "${src_shell}chrome-linux/headless_shell" "${d}/chrome-headless-shell"
        touch "${MSPW}/chromium_headless_shell-${shell_rev}/INSTALLATION_COMPLETE" \
              "${MSPW}/chromium_headless_shell-${shell_rev}/DEPENDENCIES_VALIDATED"
    fi
    src_ffmpeg=$(ls -d "${PW_SRC}"/ffmpeg-* 2>/dev/null | head -1)
    [ -n "${src_ffmpeg}" ] && ln -sfn "${src_ffmpeg}" "${MSPW}/$(basename "${src_ffmpeg}")"
fi

# Re-run so the runtime state records Chromium as available.
"${SEO_DIR}/bin/claude-seo" setup
"${SEO_DIR}/bin/claude-seo" doctor
