import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

/**
 * Call a FilePilot server endpoint. Authentication and the XSRF token are
 * handled by ServerConnection, which derives them from the active session.
 */
export async function requestAPI<T>(
  endPoint = '',
  init: RequestInit = {}
): Promise<T> {
  const settings = ServerConnection.makeSettings();
  const requestUrl = URLExt.join(settings.baseUrl, 'filepilot', endPoint);

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(requestUrl, init, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as TypeError);
  }

  const text = await response.text();
  let data: any = text;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      console.warn('FilePilot: response was not JSON.', error);
    }
  }

  if (!response.ok) {
    const message =
      (data && (data.reason || data.message)) || response.statusText;
    throw new ServerConnection.ResponseError(response, message);
  }
  return data as T;
}

/** A same-origin URL the browser can fetch directly to download a file. */
export function downloadUrl(root: string, path: string): string {
  const settings = ServerConnection.makeSettings();
  const base = URLExt.join(settings.baseUrl, 'filepilot', 'download');
  return base + URLExt.objectToQueryString({ root, path });
}
