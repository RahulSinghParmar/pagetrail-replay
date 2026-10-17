#!/bin/zsh -l
set -e
cd -- "${0:A:h}"
exec node ./serve-reader.mjs
