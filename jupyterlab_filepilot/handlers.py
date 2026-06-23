"""REST handlers for the FilePilot file explorer.

Security model
--------------
On JupyterHub every user's single-user server runs as that user's own OS
account, so the *primary* access-control boundary is the operating system:
FilePilot can never read or write anything the user could not already touch
from a terminal in their own server.

On top of that OS boundary this module adds:

* ``@tornado.web.authenticated`` on every endpoint, so only the logged-in
  owner of the server may call the API (Jupyter Server also enforces XSRF
  on the state-changing POST endpoints);
* a set of configurable *roots* -- the only base directories the explorer
  will surface -- and strict containment checks so a crafted ``..`` path or
  an escaping symlink can never resolve outside its root;
* optional ``read_only`` / ``allow_delete`` switches and an upload size cap.
"""
import json
import mimetypes
import os
import shutil
import stat as stat_module

from jupyter_server.base.handlers import APIHandler, JupyterHandler
from jupyter_server.utils import url_path_join
from tornado import web
from traitlets import Bool, Dict, Int
from traitlets.config import Configurable


class FilePilot(Configurable):
    """Server-side configuration for the FilePilot explorer.

    Configure in ``jupyter_server_config.py``, e.g.::

        c.FilePilot.roots = {
            "Home": "~",
            "Project data": "/srv/jolts/shared",
        }
        c.FilePilot.read_only = False
        c.FilePilot.allow_delete = True
    """

    roots = Dict(
        help=(
            "Mapping of display label -> base directory the explorer may "
            "access. '~' and environment variables are expanded. When empty, "
            "FilePilot defaults to the user's home directory (and the server "
            "root directory when that differs)."
        ),
    ).tag(config=True)

    read_only = Bool(
        False,
        help="When True, all write operations (upload, mkdir, rename, delete) are refused.",
    ).tag(config=True)

    allow_delete = Bool(
        True,
        help="When False, delete is refused even if read_only is False.",
    ).tag(config=True)

    allow_hidden = Bool(
        False,
        help="When True, dotfiles are listed by default (the UI can still toggle this).",
    ).tag(config=True)

    max_upload_size = Int(
        500 * 1024 * 1024,
        help="Maximum size, in bytes, of a single uploaded file.",
    ).tag(config=True)


def _safe_name(name):
    """A single path component with no separators or traversal."""
    return bool(name) and "/" not in name and "\\" not in name and name not in (".", "..")


def _posix_join(parent, name):
    return f"{parent}/{name}" if parent else name


class _FilePilotMixin:
    """Shared config access + path resolution for all FilePilot handlers."""

    @property
    def fp_config(self) -> FilePilot:
        return self.settings["filepilot_config"]

    @property
    def fp_serverapp(self):
        return self.settings["filepilot_serverapp"]

    def effective_roots(self):
        roots = dict(self.fp_config.roots)
        if not roots:
            home = os.path.realpath(os.path.expanduser("~"))
            root_dir = os.path.realpath(self.fp_serverapp.root_dir)
            roots = {"Home": home}
            if root_dir != home:
                roots["Workspace"] = root_dir
        return roots

    def contents_root(self):
        return os.path.realpath(self.fp_serverapp.root_dir)

    def root_abs(self, key):
        roots = self.effective_roots()
        if key not in roots:
            raise web.HTTPError(404, reason=f"Unknown root '{key}'")
        return os.path.realpath(os.path.expanduser(os.path.expandvars(roots[key])))

    def resolve(self, key, rel):
        """Resolve a (root, relative-path) pair to an absolute path, or 403.

        Uses ``realpath`` so that ``..`` segments *and* symlinks are followed
        before the containment check -- a link pointing outside its root is
        rejected just like a literal ``../`` escape.
        """
        base = self.root_abs(key)
        rel = (rel or "").replace("\\", "/").strip("/")
        target = os.path.realpath(os.path.join(base, rel))
        try:
            inside = os.path.commonpath([base, target]) == base
        except ValueError:  # e.g. different drives on Windows
            inside = False
        if not inside:
            raise web.HTTPError(403, reason="Path is outside the permitted root")
        return base, target

    def check_writable(self):
        if self.fp_config.read_only:
            raise web.HTTPError(403, reason="FilePilot is running in read-only mode")

    def describe(self, directory, name):
        full = os.path.join(directory, name)
        try:
            st = os.lstat(full)
        except OSError:
            return None
        is_link = stat_module.S_ISLNK(st.st_mode)
        try:
            tst = os.stat(full)  # follow link to classify
            is_dir = stat_module.S_ISDIR(tst.st_mode)
        except OSError:
            is_dir = False
        mime, _ = mimetypes.guess_type(name)
        return {
            "name": name,
            "type": "directory" if is_dir else "file",
            "size": 0 if is_dir else st.st_size,
            "modified": st.st_mtime,
            "mode": stat_module.filemode(st.st_mode),
            "isHidden": name.startswith("."),
            "isSymlink": is_link,
            "mime": mime,
        }


class RootsHandler(_FilePilotMixin, APIHandler):
    @web.authenticated
    def get(self):
        croot = self.contents_root()
        out = []
        for key, raw in self.effective_roots().items():
            ap = os.path.realpath(os.path.expanduser(os.path.expandvars(raw)))
            out.append(
                {
                    "key": key,
                    "label": key,
                    "path": ap,
                    "exists": os.path.isdir(ap),
                    "isContentsRoot": ap == croot,
                }
            )
        self.finish(json.dumps({"roots": out, "readOnly": self.fp_config.read_only}))


class ListingHandler(_FilePilotMixin, APIHandler):
    @web.authenticated
    def get(self):
        key = self.get_query_argument("root")
        rel = self.get_query_argument("path", "")
        show_hidden = self.get_query_argument("showHidden", "false") == "true"
        base, target = self.resolve(key, rel)
        if not os.path.isdir(target):
            raise web.HTTPError(404, reason="Not a directory")

        allow_hidden = self.fp_config.allow_hidden or show_hidden
        entries = []
        try:
            with os.scandir(target) as it:
                for de in it:
                    if not allow_hidden and de.name.startswith("."):
                        continue
                    d = self.describe(target, de.name)
                    if d:
                        entries.append(d)
        except PermissionError:
            raise web.HTTPError(403, reason="Permission denied")

        norm = os.path.relpath(target, base)
        if norm == ".":
            norm, parent = "", None
        else:
            parent = os.path.dirname(norm)
        self.finish(
            json.dumps(
                {
                    "root": key,
                    "path": norm.replace(os.sep, "/"),
                    "parent": (parent.replace(os.sep, "/") if parent is not None else None),
                    "entries": entries,
                    "readOnly": self.fp_config.read_only,
                    "allowDelete": self.fp_config.allow_delete and not self.fp_config.read_only,
                }
            )
        )


class DownloadHandler(_FilePilotMixin, JupyterHandler):
    """Streams a file as an attachment (browser session cookie authenticates)."""

    @web.authenticated
    async def get(self):
        key = self.get_query_argument("root")
        rel = self.get_query_argument("path")
        _, target = self.resolve(key, rel)
        if not os.path.isfile(target):
            raise web.HTTPError(404)
        mime, _ = mimetypes.guess_type(target)
        name = os.path.basename(target).replace('"', "")
        self.set_header("Content-Type", mime or "application/octet-stream")
        self.set_header("Content-Disposition", f'attachment; filename="{name}"')
        self.set_header("X-Content-Type-Options", "nosniff")
        chunk = 1024 * 1024
        with open(target, "rb") as fh:
            while True:
                data = fh.read(chunk)
                if not data:
                    break
                self.write(data)
                await self.flush()
        await self.finish()


class MkdirHandler(_FilePilotMixin, APIHandler):
    @web.authenticated
    def post(self):
        self.check_writable()
        body = self.get_json_body() or {}
        key, rel, name = body.get("root"), body.get("path", ""), body.get("name")
        if not _safe_name(name):
            raise web.HTTPError(400, reason="Invalid folder name")
        _, target = self.resolve(key, _posix_join(rel, name))
        try:
            os.makedirs(target, exist_ok=False)
        except FileExistsError:
            raise web.HTTPError(409, reason="A file or folder with that name already exists")
        self.set_status(201)
        self.finish(json.dumps({"ok": True}))


class RenameHandler(_FilePilotMixin, APIHandler):
    @web.authenticated
    def post(self):
        self.check_writable()
        body = self.get_json_body() or {}
        key, rel = body.get("root"), body.get("path", "")
        name, new_name = body.get("name"), body.get("newName")
        if not _safe_name(name) or not _safe_name(new_name):
            raise web.HTTPError(400, reason="Invalid name")
        _, src = self.resolve(key, _posix_join(rel, name))
        _, dst = self.resolve(key, _posix_join(rel, new_name))
        if not os.path.lexists(src):
            raise web.HTTPError(404)
        if os.path.lexists(dst):
            raise web.HTTPError(409, reason="A file or folder with that name already exists")
        os.rename(src, dst)
        self.finish(json.dumps({"ok": True}))


class DeleteHandler(_FilePilotMixin, APIHandler):
    @web.authenticated
    def post(self):
        self.check_writable()
        if not self.fp_config.allow_delete:
            raise web.HTTPError(403, reason="Deletion is disabled")
        body = self.get_json_body() or {}
        key, rel = body.get("root"), body.get("path", "")
        names = body.get("names") or []
        _, parent = self.resolve(key, rel)
        for name in names:
            if not _safe_name(name):
                raise web.HTTPError(400, reason="Invalid name")
            link_path = os.path.join(parent, name)  # do NOT follow link for the delete itself
            if os.path.islink(link_path):
                os.unlink(link_path)
            elif os.path.isdir(link_path):
                shutil.rmtree(link_path)
            elif os.path.lexists(link_path):
                os.remove(link_path)
        self.finish(json.dumps({"ok": True, "deleted": names}))


class UploadHandler(_FilePilotMixin, APIHandler):
    @web.authenticated
    def post(self):
        self.check_writable()
        key = self.get_query_argument("root")
        rel = self.get_query_argument("path", "")
        _, target_dir = self.resolve(key, rel)
        if not os.path.isdir(target_dir):
            raise web.HTTPError(400, reason="Upload target is not a directory")
        files = self.request.files.get("file")
        if not files:
            raise web.HTTPError(400, reason="No file provided")
        saved = []
        for finfo in files:
            fname = os.path.basename(finfo["filename"])
            if not _safe_name(fname):
                continue
            if len(finfo["body"]) > self.fp_config.max_upload_size:
                raise web.HTTPError(413, reason="File exceeds the maximum upload size")
            _, dst = self.resolve(key, _posix_join(rel, fname))
            with open(dst, "wb") as fh:
                fh.write(finfo["body"])
            saved.append(fname)
        self.set_status(201)
        self.finish(json.dumps({"saved": saved}))


def setup_handlers(web_app, server_app):
    web_app.settings["filepilot_config"] = FilePilot(parent=server_app)
    web_app.settings["filepilot_serverapp"] = server_app

    base_url = web_app.settings["base_url"]
    routes = [
        ("roots", RootsHandler),
        ("listing", ListingHandler),
        ("download", DownloadHandler),
        ("mkdir", MkdirHandler),
        ("rename", RenameHandler),
        ("delete", DeleteHandler),
        ("upload", UploadHandler),
    ]
    handlers = [
        (url_path_join(base_url, "filepilot", endpoint), handler) for endpoint, handler in routes
    ]
    web_app.add_handlers(".*$", handlers)
