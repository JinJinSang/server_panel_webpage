#!/bin/bash
# Run before committing a change to app.js: updates the version tag so browsers fetch the new script on a normal reload.
cd "$(dirname "$0")" && sed -i "s#<script src=\"app.js[^\"]*\"></script>#<script src=\"app.js?v=$(date +%Y%m%d%H%M)\"></script>#" index.html
