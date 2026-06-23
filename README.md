# jupyterlab-filepilot

**FilePilot** is a secure, Windows-Explorer-style file explorer for JupyterLab 4
and JupyterHub. It adds a **File Explorer** tile to the Launcher (under
**Other**) that opens a familiar two-pane file manager — navigation pane on the
left, a sortable details list on the right (Name / Date modified / Type / Size),
breadcrumb address bar, back/forward/up navigation, and a right-click context
menu.

It is built for Linux servers (the common JupyterHub case) but works on any OS
the single-user server runs on.

```
┌────────────────────────────────────────────────────────────────────┐
│ 📁 New folder  ⬆ Upload │ ⤓ Download ✎ Rename 🗑 Delete │ ⟳ Refresh  │
├────────────────────────────────────────────────────────────────────┤
│ ← → ↑  │ Home › projects › jolts                                     │
├──────────────┬─────────────────────────────────────────────────────┤
│ THIS PC      │ Name              Date modified   Type      Size      │
│ 🗄 Workspace  │ 📁 estimation      06/12/2026 09:14  File folder       │
│ 🖳 Home       │ 📁 nraf            06/02/2026 16:41  File folder       │
│              │ 📄 pipeline.py     06/20/2026 11:02  PY file    8.4 KB │
│              │ 📄 config.toml     06/19/2026 08:55  TOML file  1.1 KB │
├──────────────┴─────────────────────────────────────────────────────┤
│ 4 items   1 selected · 8.4 KB                       /home/pat/jolts  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Why it's "secure"

On JupyterHub each user's single-user server runs as that user's own OS account,
so the **operating system is the primary access-control boundary**: FilePilot can
never see or touch anything the user couldn't already reach from a terminal in
their own server.

On top of that, FilePilot adds:

- **Authenticated, same-origin API.** Every endpoint requires the logged-in
  user (`@tornado.web.authenticated`); state-changing calls are XSRF-protected by
  Jupyter Server.
- **Configurable roots.** The explorer only surfaces the base directories you
  configure. Nothing else is reachable through the UI.
- **Strict path containment.** Every request is resolved with `realpath` and
  checked against its root, so crafted `../` paths *and* symlinks that escape a
  root are rejected.
- **Read-only / no-delete switches** and an **upload size cap**.

> FilePilot is not a sandbox. It does not grant access the user doesn't already
> have; it provides a convenient, bounded view of directories they can reach.

---

## Requirements

- JupyterLab **>= 4.0** and Jupyter Server **>= 2.0**
- Python **>= 3.8**
- For building from source: Node.js **>= 18** and `jlpm` (ships with JupyterLab)

---

## Installation

### From PyPI (recommended)

```bash
pip install jupyterlab-filepilot
```

That single wheel ships **both** the prebuilt frontend extension and the server
extension, and auto-enables the server extension. No `jupyter labextension
install` and no rebuild step are needed. Restart JupyterLab/JupyterHub and the
**File Explorer** tile appears in the Launcher.

Verify it loaded:

```bash
jupyter server extension list      # → jupyterlab_filepilot ... enabled OK
jupyter labextension list          # → jupyterlab-filepilot ... enabled OK
```

### Install for all users on a JupyterHub

Install into the same Python environment your single-user servers use (so it is
importable by every spawned server), e.g. in your image build or shared env:

```bash
/opt/conda/bin/pip install jupyterlab-filepilot
```

No per-user step is required — the Launcher tile shows up for everyone.

---

## Getting started

1. Open a new **Launcher** (File ▸ New Launcher, or the `+` button).
2. Scroll to the **Other** category and click **File Explorer**.
3. A File Explorer tab opens in the main work area.

Things you can do:

| Action | How |
| --- | --- |
| Enter a folder | Double-click it, or select and press **Enter** |
| Go up / back / forward | The **↑ ← →** buttons, or **Backspace** for up |
| Jump along the path | Click any segment in the breadcrumb address bar |
| Type a path | Double-click the address bar, type a path, press **Enter** |
| Sort | Click a column header (click again to reverse) |
| Filter the current folder | Type in the **Filter this folder** box |
| Multi-select | **Ctrl/⌘-click** to toggle, **Shift-click** for a range |
| New folder / Upload | Toolbar buttons |
| Rename | Select + **Rename**, or **F2**, or right-click |
| Delete | Select + **Delete** button, or the **Delete** key, or right-click |
| Open a file | Double-click. Files under the JupyterLab workspace open **in Lab**; files elsewhere **download** |
| Download a file | Toolbar **Download**, or right-click ▸ Download |
| Copy a file's full path | Right-click ▸ Copy full path |
| Show dotfiles | Tick **Hidden items** |

Switch between configured roots (e.g. **Home** and **Workspace**) from the
**This PC** list in the left pane.

---

## Configuration

All settings live on the `FilePilot` config object. Add them to your
`jupyter_server_config.py` (per user) or to the Hub-wide
`jupyter_server_config.py` baked into your single-user image.

```python
# jupyter_server_config.py

# Which base directories the explorer may surface (label -> path).
# '~' and environment variables are expanded.
c.FilePilot.roots = {
    "Home": "~",
    "Project data": "/srv/jolts/shared",
    "Scratch": "$SCRATCH",
}

# Turn off all writes (upload/mkdir/rename/delete).
c.FilePilot.read_only = False

# Allow writes but forbid deletion specifically.
c.FilePilot.allow_delete = True

# List dotfiles by default (the UI toggle still works either way).
c.FilePilot.allow_hidden = False

# Maximum size of a single uploaded file (bytes). Default: 500 MB.
c.FilePilot.max_upload_size = 500 * 1024 * 1024
```

**Defaults.** If you set no `roots`, FilePilot exposes the user's home directory
(`Home`) and, when it differs, the server's root directory (`Workspace`).

**Large uploads.** Tornado buffers request bodies in memory; for uploads beyond
~100 MB also raise the server limit, e.g. `c.ServerApp.max_buffer_size =
1024 * 1024 * 1024`.

---

## Building from source

```bash
git clone https://github.com/patlongcodes/jupyterlab-filepilot
cd jupyterlab-filepilot

# Dev install: editable Python package + a development build of the labextension
pip install -e .
jupyter labextension develop . --overwrite
jupyter server extension enable jupyterlab_filepilot

# Rebuild the frontend after editing TypeScript
jlpm install
jlpm build
```

Watch mode (rebuilds on save; refresh the browser to pick up changes):

```bash
jlpm watch
# in another terminal
jupyter lab
```

### Build distributables for PyPI

```bash
pip install build twine
python -m build          # produces dist/*.whl and dist/*.tar.gz
twine check dist/*
twine upload dist/*      # when you're ready to publish
```

---

## Uninstall

```bash
pip uninstall jupyterlab-filepilot
```

---

## REST API (for reference)

All endpoints are under `<base_url>/filepilot/` and require an authenticated
session.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `roots` | List configured roots |
| GET | `listing?root=&path=&showHidden=` | List a directory |
| GET | `download?root=&path=` | Stream a file as an attachment |
| POST | `mkdir` | Create a folder `{root, path, name}` |
| POST | `rename` | Rename `{root, path, name, newName}` |
| POST | `delete` | Delete `{root, path, names[]}` |
| POST | `upload?root=&path=` | Multipart upload (field `file`) |

---

## Project layout

```
jupyterlab-filepilot/
├── pyproject.toml                 # Python packaging + jupyter-builder hook
├── package.json                   # npm + @jupyterlab/builder config
├── tsconfig.json
├── install.json
├── jupyter-config/server-config/  # auto-enables the server extension
├── src/                           # frontend (TypeScript / React)
│   ├── index.tsx                  # plugin: Launcher tile + command
│   ├── handler.ts                 # authenticated API client
│   ├── icons.ts
│   └── components/FileExplorer.tsx
├── style/                         # Windows-Explorer skin
└── jupyterlab_filepilot/          # server extension (Python)
    ├── __init__.py
    └── handlers.py                # roots / listing / download / mkdir / …
```

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
