/**
 * HTTP helper — zero-dependency HTTPS requests using Node.js built-ins.
 */

import https from 'node:https';

export interface HttpRequestOptions {
  hostname: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: options.hostname,
        path: options.path,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({
            statusCode: res.statusCode ?? 0,
            body,
            headers: res.headers as Record<string, string | string[] | undefined>,
          });
        });
      }
    );

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Parse a URL into hostname and path components.
 */
export function parseUrl(url: string): { hostname: string; path: string; protocol: string } {
  const parsed = new URL(url);
  return {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    protocol: parsed.protocol,
  };
}
