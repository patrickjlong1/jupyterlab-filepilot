import {
  Dialog,
  InputDialog,
  showDialog
} from '@jupyterlab/apputils';
import { URLExt } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { downloadUrl, requestAPI } from '../handler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IRoot {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  isContentsRoot: boolean;
}

interface IEntry {
  name: string;
  type: 'directory' | 'file';
  size: number;
  modified: number;
  mode: string;
  isHidden: boolean;
  isSymlink: boolean;
  mime: string | null;
}

interface IListing {
  root: string;
  path: string;
  parent: string | null;
  entries: IEntry[];
  readOnly: boolean;
  allowDelete: boolean;
}

type SortKey = 'name' | 'modified' | 'type' | 'size';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const joinPath = (p: string, name: string): string => (p ? `${p}/${name}` : name);

const parentOf = (p: string): string =>
  p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';

const extOf = (e: IEntry): string => {
  const i = e.name.lastIndexOf('.');
  return i > 0 ? e.name.slice(i + 1).toLowerCase() : '';
};

const typeLabel = (e: IEntry): string => {
  if (e.type === 'directory') {
    return 'File folder';
  }
  const ext = extOf(e);
  return ext ? `${ext.toUpperCase()} file` : 'File';
};

const fmtDate = (epoch: number): string => {
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }) +
    '  ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const fmtSize = (n: number): string => {
  if (n < 1024) {
    return `${n} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  let v = n;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

// Coloured corner for a handful of common file families, Windows-ish.
const extColor = (ext: string): string => {
  if (['py', 'ipynb'].includes(ext)) return '#3572A5';
  if (['csv', 'tsv', 'xlsx', 'xls', 'parquet'].includes(ext)) return '#1D6F42';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return '#B05CC6';
  if (['md', 'txt', 'rst', 'log'].includes(ext)) return '#6E7781';
  if (['zip', 'tar', 'gz', 'bz2', '7z'].includes(ext)) return '#C9881A';
  if (['json', 'yaml', 'yml', 'toml', 'cfg', 'ini'].includes(ext)) return '#CB6B2E';
  return '#5B6470';
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const FolderGlyph = (): JSX.Element => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 6.5C3 5.7 3.7 5 4.5 5H9l2 2h8.5c.8 0 1.5.7 1.5 1.5V10H3Z" fill="#E2A33B" />
    <path d="M3 9.5h18c.8 0 1.5.7 1.5 1.5l-1.1 6.6A1.5 1.5 0 0 1 18.9 19H5.1a1.5 1.5 0 0 1-1.5-1.26L2.5 11A1.5 1.5 0 0 1 3 9.5Z" fill="#F6C544" />
  </svg>
);

const FileGlyph = ({ ext }: { ext: string }): JSX.Element => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="#FBFCFE" stroke="#9AA4B1" strokeWidth="1.1" />
    <path d="M14 3v4h4" fill="none" stroke="#9AA4B1" strokeWidth="1.1" />
    {ext ? (
      <path d="M5 13h11v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z" fill={extColor(ext)} />
    ) : null}
  </svg>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileExplorerComponent({
  docManager
}: {
  docManager: IDocumentManager;
}): JSX.Element {
  const [roots, setRoots] = useState<IRoot[]>([]);
  const [root, setRoot] = useState('');
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<IEntry[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [allowDelete, setAllowDelete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: IEntry } | null>(
    null
  );
  const [editingAddr, setEditingAddr] = useState(false);
  const [addrValue, setAddrValue] = useState('');

  const back = useRef<Array<{ root: string; path: string }>>([]);
  const fwd = useRef<Array<{ root: string; path: string }>>([]);
  const lastIndex = useRef<number | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const activeRoot = useMemo(
    () => roots.find(r => r.key === root) ?? null,
    [roots, root]
  );

  const load = useCallback(
    async (r: string, p: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const q = URLExt.objectToQueryString({
          root: r,
          path: p,
          showHidden: String(showHidden)
        });
        const data = await requestAPI<IListing>('listing' + q);
        setRoot(data.root);
        setPath(data.path);
        setEntries(data.entries);
        setReadOnly(data.readOnly);
        setAllowDelete(data.allowDelete);
        setSelected(new Set());
        setMenu(null);
        lastIndex.current = null;
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    },
    [showHidden]
  );

  const navigate = useCallback(
    (r: string, p: string): void => {
      back.current.push({ root, path });
      fwd.current = [];
      void load(r, p);
    },
    [root, path, load]
  );

  // Initial roots + first listing.
  useEffect(() => {
    void (async () => {
      try {
        const data = await requestAPI<{ roots: IRoot[] }>('roots');
        setRoots(data.roots);
        if (data.roots.length) {
          await load(data.roots[0].key, '');
        } else {
          setLoading(false);
          setError('No accessible roots are configured.');
        }
      } catch (e: any) {
        setLoading(false);
        setError(e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-list when the hidden-files toggle changes.
  useEffect(() => {
    if (root) {
      void load(root, path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  // Dismiss the context menu on any outside click.
  useEffect(() => {
    const close = (): void => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const view = useMemo(() => {
    let list = entries;
    if (filter.trim()) {
      const f = filter.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(f));
    }
    const dirFirst = (e: IEntry): number => (e.type === 'directory' ? 0 : 1);
    const sorted = [...list].sort((a, b) => {
      const d = dirFirst(a) - dirFirst(b);
      if (d !== 0) {
        return d;
      }
      let r = 0;
      switch (sortKey) {
        case 'name':
          r = a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: 'base'
          });
          break;
        case 'modified':
          r = a.modified - b.modified;
          break;
        case 'size':
          r = a.size - b.size;
          break;
        case 'type':
          r = extOf(a).localeCompare(extOf(b));
          break;
      }
      return sortAsc ? r : -r;
    });
    return sorted;
  }, [entries, filter, sortKey, sortAsc]);

  const setSort = (key: SortKey): void => {
    if (key === sortKey) {
      setSortAsc(a => !a);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // ---- actions -----------------------------------------------------------

  const errorDialog = async (e: any): Promise<void> => {
    await showDialog({
      title: 'File Explorer',
      body: e?.message ?? String(e),
      buttons: [Dialog.okButton()]
    });
  };

  const downloadEntry = useCallback(
    (e: IEntry): void => {
      const a = document.createElement('a');
      a.href = downloadUrl(root, joinPath(path, e.name));
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [root, path]
  );

  const openEntry = useCallback(
    (e: IEntry): void => {
      if (e.type === 'directory') {
        navigate(root, joinPath(path, e.name));
        return;
      }
      if (activeRoot?.isContentsRoot) {
        // File lives under the JupyterLab contents root: open it in Lab.
        docManager.openOrReveal(joinPath(path, e.name));
      } else {
        downloadEntry(e);
      }
    },
    [root, path, activeRoot, navigate, docManager, downloadEntry]
  );

  const goUp = useCallback((): void => {
    if (path !== '') {
      navigate(root, parentOf(path));
    }
  }, [root, path, navigate]);

  const goBack = useCallback((): void => {
    const prev = back.current.pop();
    if (prev) {
      fwd.current.push({ root, path });
      void load(prev.root, prev.path);
    }
  }, [root, path, load]);

  const goForward = useCallback((): void => {
    const next = fwd.current.pop();
    if (next) {
      back.current.push({ root, path });
      void load(next.root, next.path);
    }
  }, [root, path, load]);

  const newFolder = async (): Promise<void> => {
    const res = await InputDialog.getText({
      title: 'New folder',
      text: 'New folder'
    });
    if (!res.button.accept || !res.value) {
      return;
    }
    try {
      await requestAPI('mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, path, name: res.value })
      });
      await load(root, path);
    } catch (e) {
      await errorDialog(e);
    }
  };

  const renameEntry = async (e: IEntry): Promise<void> => {
    const res = await InputDialog.getText({ title: 'Rename', text: e.name });
    if (!res.button.accept || !res.value || res.value === e.name) {
      return;
    }
    try {
      await requestAPI('rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, path, name: e.name, newName: res.value })
      });
      await load(root, path);
    } catch (err) {
      await errorDialog(err);
    }
  };

  const deleteNames = async (names: string[]): Promise<void> => {
    if (!names.length) {
      return;
    }
    const res = await showDialog({
      title: 'Delete',
      body: `Delete ${names.length} item${names.length > 1 ? 's' : ''}? This cannot be undone.`,
      buttons: [Dialog.cancelButton(), Dialog.warnButton({ label: 'Delete' })]
    });
    if (!res.button.accept) {
      return;
    }
    try {
      await requestAPI('delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, path, names })
      });
      await load(root, path);
    } catch (err) {
      await errorDialog(err);
    }
  };

  const doUpload = async (files: FileList | null): Promise<void> => {
    if (!files || !files.length) {
      return;
    }
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file, file.name);
        const q = URLExt.objectToQueryString({ root, path });
        await requestAPI('upload' + q, { method: 'POST', body: fd });
      }
      await load(root, path);
    } catch (err) {
      await errorDialog(err);
    }
  };

  // ---- selection ---------------------------------------------------------

  const onRowClick = (e: React.MouseEvent, entry: IEntry, idx: number): void => {
    if (e.ctrlKey || e.metaKey) {
      setSelected(prev => {
        const s = new Set(prev);
        s.has(entry.name) ? s.delete(entry.name) : s.add(entry.name);
        return s;
      });
    } else if (e.shiftKey && lastIndex.current !== null) {
      const [a, b] = [lastIndex.current, idx].sort((x, y) => x - y);
      const s = new Set<string>();
      for (let i = a; i <= b; i++) {
        s.add(view[i].name);
      }
      setSelected(s);
    } else {
      setSelected(new Set([entry.name]));
    }
    lastIndex.current = idx;
  };

  const onContextMenu = (e: React.MouseEvent, entry: IEntry): void => {
    e.preventDefault();
    if (!selected.has(entry.name)) {
      setSelected(new Set([entry.name]));
    }
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Delete' && allowDelete) {
      void deleteNames([...selected]);
    } else if (e.key === 'F2' && selected.size === 1) {
      const ent = view.find(v => selected.has(v.name));
      if (ent) {
        void renameEntry(ent);
      }
    } else if (e.key === 'Enter' && selected.size === 1) {
      const ent = view.find(v => selected.has(v.name));
      if (ent) {
        openEntry(ent);
      }
    } else if (e.key === 'Backspace') {
      goUp();
    }
  };

  // ---- address bar -------------------------------------------------------

  const beginEditAddr = (): void => {
    setAddrValue(path);
    setEditingAddr(true);
  };
  const commitAddr = (): void => {
    setEditingAddr(false);
    navigate(root, addrValue.replace(/^\/+|\/+$/g, ''));
  };

  const crumbs = path ? path.split('/') : [];
  const selectedSize = view
    .filter(v => selected.has(v.name))
    .reduce((s, v) => s + (v.type === 'file' ? v.size : 0), 0);

  // ---- render ------------------------------------------------------------

  const sortCaret = (key: SortKey): string =>
    key === sortKey ? (sortAsc ? ' ▲' : ' ▼') : '';

  return (
    <div className="fp-app" onKeyDown={onKeyDown} tabIndex={0}>
      <input
        ref={uploadInput}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={ev => {
          void doUpload(ev.target.files);
          ev.target.value = '';
        }}
      />

      {/* Command bar */}
      <div className="fp-toolbar">
        <button
          className="fp-btn"
          disabled={readOnly}
          onClick={() => void newFolder()}
          title="Create a new folder"
        >
          <span className="fp-btn-ico">📁</span>New folder
        </button>
        <button
          className="fp-btn"
          disabled={readOnly}
          onClick={() => uploadInput.current?.click()}
          title="Upload files into this folder"
        >
          <span className="fp-btn-ico">⬆</span>Upload
        </button>
        <div className="fp-sep" />
        <button
          className="fp-btn"
          disabled={selected.size !== 1}
          onClick={() => {
            const ent = view.find(v => selected.has(v.name));
            if (ent) {
              ent.type === 'file' ? downloadEntry(ent) : openEntry(ent);
            }
          }}
          title="Download / open the selected item"
        >
          <span className="fp-btn-ico">⤓</span>Download
        </button>
        <button
          className="fp-btn"
          disabled={selected.size !== 1 || readOnly}
          onClick={() => {
            const ent = view.find(v => selected.has(v.name));
            if (ent) {
              void renameEntry(ent);
            }
          }}
          title="Rename the selected item"
        >
          <span className="fp-btn-ico">✎</span>Rename
        </button>
        <button
          className="fp-btn fp-btn-danger"
          disabled={selected.size === 0 || !allowDelete}
          onClick={() => void deleteNames([...selected])}
          title="Delete the selected item(s)"
        >
          <span className="fp-btn-ico">🗑</span>Delete
        </button>
        <div className="fp-sep" />
        <button
          className="fp-btn"
          onClick={() => void load(root, path)}
          title="Refresh"
        >
          <span className="fp-btn-ico">⟳</span>Refresh
        </button>
        <label className="fp-check" title="Show hidden (dot) files">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={e => setShowHidden(e.target.checked)}
          />
          Hidden items
        </label>
        <div className="fp-spacer" />
        <input
          className="fp-search"
          placeholder="Filter this folder"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {/* Navigation / address bar */}
      <div className="fp-navbar">
        <button
          className="fp-navbtn"
          disabled={!back.current.length}
          onClick={goBack}
          title="Back"
        >
          ←
        </button>
        <button
          className="fp-navbtn"
          disabled={!fwd.current.length}
          onClick={goForward}
          title="Forward"
        >
          →
        </button>
        <button
          className="fp-navbtn"
          disabled={path === ''}
          onClick={goUp}
          title="Up one level"
        >
          ↑
        </button>
        {editingAddr ? (
          <input
            className="fp-address-edit"
            autoFocus
            value={addrValue}
            onChange={e => setAddrValue(e.target.value)}
            onBlur={() => setEditingAddr(false)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                commitAddr();
              } else if (e.key === 'Escape') {
                setEditingAddr(false);
              }
            }}
          />
        ) : (
          <div className="fp-address" onDoubleClick={beginEditAddr}>
            <span
              className="fp-crumb fp-crumb-root"
              onClick={() => navigate(root, '')}
            >
              {activeRoot?.label ?? root}
            </span>
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                <span className="fp-crumb-sep">›</span>
                <span
                  className="fp-crumb"
                  onClick={() =>
                    navigate(root, crumbs.slice(0, i + 1).join('/'))
                  }
                >
                  {c}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Body: nav pane + listing */}
      <div className="fp-body">
        <div className="fp-nav">
          <div className="fp-nav-section">This PC</div>
          {roots.map(r => (
            <div
              key={r.key}
              className={
                'fp-navitem' + (r.key === root ? ' fp-navitem-active' : '')
              }
              title={r.path}
              onClick={() => navigate(r.key, '')}
            >
              <span className="fp-navitem-ico">
                {r.isContentsRoot ? '🗄' : '🖳'}
              </span>
              {r.label}
            </div>
          ))}
        </div>

        <div className="fp-main">
          <div className="fp-table" role="grid">
            <div className="fp-head" role="row">
              <div
                className="fp-col fp-col-name"
                onClick={() => setSort('name')}
              >
                Name{sortCaret('name')}
              </div>
              <div
                className="fp-col fp-col-date"
                onClick={() => setSort('modified')}
              >
                Date modified{sortCaret('modified')}
              </div>
              <div
                className="fp-col fp-col-type"
                onClick={() => setSort('type')}
              >
                Type{sortCaret('type')}
              </div>
              <div
                className="fp-col fp-col-size"
                onClick={() => setSort('size')}
              >
                Size{sortCaret('size')}
              </div>
            </div>

            <div className="fp-rows">
              {loading && <div className="fp-empty">Loading…</div>}
              {!loading && error && (
                <div className="fp-empty fp-error">{error}</div>
              )}
              {!loading && !error && view.length === 0 && (
                <div className="fp-empty">This folder is empty.</div>
              )}
              {!loading &&
                !error &&
                view.map((e, idx) => (
                  <div
                    key={e.name}
                    role="row"
                    className={
                      'fp-row' +
                      (selected.has(e.name) ? ' fp-row-selected' : '') +
                      (e.isHidden ? ' fp-row-hidden' : '')
                    }
                    onClick={ev => onRowClick(ev, e, idx)}
                    onDoubleClick={() => openEntry(e)}
                    onContextMenu={ev => onContextMenu(ev, e)}
                  >
                    <div className="fp-col fp-col-name">
                      <span className="fp-glyph">
                        {e.type === 'directory' ? (
                          <FolderGlyph />
                        ) : (
                          <FileGlyph ext={extOf(e)} />
                        )}
                      </span>
                      <span className="fp-name">{e.name}</span>
                      {e.isSymlink && <span className="fp-link-badge">link</span>}
                    </div>
                    <div className="fp-col fp-col-date">
                      {fmtDate(e.modified)}
                    </div>
                    <div className="fp-col fp-col-type">{typeLabel(e)}</div>
                    <div className="fp-col fp-col-size">
                      {e.type === 'file' ? fmtSize(e.size) : ''}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="fp-status">
        <span>{view.length} items</span>
        {selected.size > 0 && (
          <span>
            {selected.size} selected
            {selectedSize > 0 ? `  ·  ${fmtSize(selectedSize)}` : ''}
          </span>
        )}
        {readOnly && <span className="fp-status-ro">Read-only</span>}
        <span className="fp-spacer" />
        {activeRoot && <span className="fp-status-path">{activeRoot.path}</span>}
      </div>

      {/* Context menu */}
      {menu && (
        <div
          className="fp-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={e => e.stopPropagation()}
        >
          <div
            className="fp-menu-item"
            onClick={() => {
              openEntry(menu.entry);
              setMenu(null);
            }}
          >
            {menu.entry.type === 'directory'
              ? 'Open'
              : activeRoot?.isContentsRoot
                ? 'Open in JupyterLab'
                : 'Open'}
          </div>
          {menu.entry.type === 'file' && (
            <div
              className="fp-menu-item"
              onClick={() => {
                downloadEntry(menu.entry);
                setMenu(null);
              }}
            >
              Download
            </div>
          )}
          <div className="fp-menu-sep" />
          <div
            className={'fp-menu-item' + (readOnly ? ' fp-menu-disabled' : '')}
            onClick={() => {
              if (!readOnly) {
                void renameEntry(menu.entry);
              }
              setMenu(null);
            }}
          >
            Rename
          </div>
          <div
            className={
              'fp-menu-item fp-menu-danger' +
              (!allowDelete ? ' fp-menu-disabled' : '')
            }
            onClick={() => {
              if (allowDelete) {
                void deleteNames([...(selected.size ? selected : [menu.entry.name])]);
              }
              setMenu(null);
            }}
          >
            Delete
          </div>
          <div className="fp-menu-sep" />
          <div
            className="fp-menu-item"
            onClick={() => {
              void navigator.clipboard?.writeText(
                joinPath(activeRoot?.path ?? '', joinPath(path, menu.entry.name))
              );
              setMenu(null);
            }}
          >
            Copy full path
          </div>
        </div>
      )}
    </div>
  );
}
