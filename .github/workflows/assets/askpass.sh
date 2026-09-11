#!/bin/sh
# @license MIT
# @copyright 2026 Mickaël Canouil
# @author Mickaël Canouil
#
# Answers the credential prompts of `git` for the release workflow.
#
# `git` reads the token from this script and not from the command line,
# because a command line is readable from `/proc` by every process of the
# same user. The jobs that push run the lifecycle scripts of every
# dependency first, and any of those can leave a process behind.
#
# The caller exports `GH_TOKEN` and points `GIT_ASKPASS` at this file.

case "$1" in
Username*) echo "x-access-token" ;;
*) echo "${GH_TOKEN}" ;;
esac
