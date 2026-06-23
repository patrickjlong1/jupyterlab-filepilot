import { LabIcon } from '@jupyterlab/ui-components';

const explorerSvg = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="jp-icon-contrast0">
  <path d="M3 6.5C3 5.67 3.67 5 4.5 5H9l2 2h8.5c.83 0 1.5.67 1.5 1.5V10H3V6.5Z" fill="#F6C544"/>
  <path d="M3 9.5h18c.83 0 1.5.67 1.5 1.5l-1.1 6.6A1.5 1.5 0 0 1 18.9 19H5.1a1.5 1.5 0 0 1-1.48-1.26L2.5 11A1.5 1.5 0 0 1 3 9.5Z" fill="#FFD86B"/>
  <rect x="8.5" y="12" width="9" height="6.5" rx="1" fill="#fff" stroke="#1A73B7" stroke-width="1.1"/>
  <rect x="8.5" y="12" width="9" height="2" rx="1" fill="#1A73B7"/>
</svg>`;

export const explorerIcon = new LabIcon({
  name: 'filepilot:explorer',
  svgstr: explorerSvg
});
