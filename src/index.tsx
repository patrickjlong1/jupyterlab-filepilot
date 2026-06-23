import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  ICommandPalette,
  MainAreaWidget,
  ReactWidget,
  WidgetTracker
} from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { ILauncher } from '@jupyterlab/launcher';
import React from 'react';
import { FileExplorerComponent } from './components/FileExplorer';
import { explorerIcon } from './icons';

namespace CommandIDs {
  export const open = 'filepilot:open-explorer';
}

class FileExplorerWidget extends ReactWidget {
  constructor(private _docManager: IDocumentManager) {
    super();
    this.addClass('fp-widget');
  }

  render(): JSX.Element {
    return <FileExplorerComponent docManager={this._docManager} />;
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-filepilot:plugin',
  description:
    'A secure, Windows-Explorer-style file explorer for JupyterLab / JupyterHub.',
  autoStart: true,
  requires: [IDocumentManager],
  optional: [ILauncher, ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    docManager: IDocumentManager,
    launcher: ILauncher | null,
    palette: ICommandPalette | null
  ) => {
    const { commands, shell } = app;
    const tracker = new WidgetTracker<MainAreaWidget<FileExplorerWidget>>({
      namespace: 'filepilot'
    });

    commands.addCommand(CommandIDs.open, {
      label: 'File Explorer',
      caption: 'Open a secure file explorer session',
      icon: explorerIcon,
      execute: () => {
        const content = new FileExplorerWidget(docManager);
        const widget = new MainAreaWidget({ content });
        widget.id = `filepilot-${Date.now()}`;
        widget.title.label = 'File Explorer';
        widget.title.icon = explorerIcon;
        widget.title.closable = true;
        void tracker.add(widget);
        if (!widget.isAttached) {
          shell.add(widget, 'main');
        }
        shell.activateById(widget.id);
        return widget;
      }
    });

    if (launcher) {
      launcher.add({
        command: CommandIDs.open,
        category: 'Other',
        rank: 1
      });
    }

    if (palette) {
      palette.addItem({
        command: CommandIDs.open,
        category: 'File Explorer'
      });
    }
  }
};

export default plugin;
