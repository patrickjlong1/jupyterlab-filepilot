"""jupyterlab_filepilot

A secure, Windows-Explorer-style file explorer for JupyterLab / JupyterHub.

This package ships two pieces:

* a prebuilt JupyterLab (frontend) extension, registered via
  ``_jupyter_labextension_paths``;
* a Jupyter Server (backend) extension that exposes the REST API the
  frontend talks to, registered via ``_jupyter_server_extension_points``.
"""
from ._version import __version__
from .handlers import setup_handlers

__all__ = ["__version__"]


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyterlab-filepilot"}]


def _jupyter_server_extension_points():
    return [{"module": "jupyterlab_filepilot"}]


def _load_jupyter_server_extension(server_app):
    """Register the FilePilot REST handlers with the Jupyter Server web app."""
    setup_handlers(server_app.web_app, server_app)
    server_app.log.info("jupyterlab_filepilot | server extension loaded")


# Backwards-compatible alias for the (deprecated) classic notebook server.
load_jupyter_server_extension = _load_jupyter_server_extension
