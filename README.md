# ARC GPU Queue — page

Static front end of the ARC GPU dashboard (Oxford ARC HTC cluster). This repository holds only the page;
the collector and the data live in the private repository `server_panel` (branch `data`), which the page reads
through the GitHub API with a fine-grained read-only token entered once in the browser (⚙ on the page).

Served by GitHub Pages: https://jinjinsang.github.io/server_panel_webpage/
