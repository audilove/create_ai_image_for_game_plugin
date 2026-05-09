'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

/** Имя файла в корне URL: домен/`12345_deadbeef.webp` (без префикса /file/). */
const SAFE_NAME = /^[0-9]+_[a-f0-9]+\.webp$/i;

/**
 * Persist WebP bytes for CDN/proxy pickup and return Telegram-HTML anchor (or '' if disabled/error).
 *
 * @param {object} o
 * @param {string} o.serveDir      - Каталог с файлами `<userId>_<id>.webp`.
 * @param {string} o.publicBaseUrl - e.g. https://cdn.codesnippet.ru (без слэша в конце).
 * @param {string|number} o.userId
 * @param {string} o.filename      - `<userId>_<resultId>.webp`
 * @param {Buffer} o.webpBuffer
 * @param {function(string): string} o.escapeHtml
 */
function persistWebpAndLinkHtml(o) {
  const base = String(o.publicBaseUrl || '').trim().replace(/\/$/, '');
  const serveDir = o.serveDir ? path.resolve(o.serveDir) : '';
  if (!base || !serveDir || !o.webpBuffer?.length || !SAFE_NAME.test(o.filename)) {
    return '';
  }
  const filePath = path.join(serveDir, o.filename);
  try {
    fs.mkdirSync(serveDir, { recursive: true });
    fs.writeFileSync(filePath, o.webpBuffer);
  } catch {
    return '';
  }
  const href = `${base}/${o.filename}`;
  return `\n<a href="${o.escapeHtml(href)}">Ссылка на WebP</a>`;
}

/**
 * GET `/<userId>_<hex>.webp` в корне — только совпадение SAFE_NAME (остальное 404).
 */
function startCdnWebpServer(opts = {}) {
  const serveDir = path.resolve(opts.serveDir || './data/cdn-webp');
  const port = Math.max(1, Number(opts.port ?? process.env.CDN_SERVE_PORT ?? 5000));
  const logger = opts.logger || console;

  fs.mkdirSync(serveDir, { recursive: true });

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405);
      return res.end();
    }

    try {
      let pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
      pathname = pathname.replace(/\/+$/, '') || '/';
      if (pathname === '/' || pathname === '') {
        res.writeHead(404);
        return res.end('Not found');
      }
      const name = pathname.startsWith('/') ? pathname.slice(1) : pathname;
      if (name.includes('/') || !SAFE_NAME.test(name)) {
        res.writeHead(404);
        return res.end('Not found');
      }
      const resolvedServeDir = path.resolve(serveDir);
      const filePath = path.resolve(path.join(resolvedServeDir, name));
      if (!filePath.startsWith(resolvedServeDir + path.sep)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });

  server.listen(port, '0.0.0.0', () => {
    logger.log?.(`[cdn-webp] http://0.0.0.0:${port}/<userId>_<id>.webp → ${serveDir}`);
  });
  server.on('error', (err) => {
    logger.error?.('[cdn-webp] failed to bind port', err);
  });
  return server;
}

module.exports = {
  startCdnWebpServer,
  persistWebpAndLinkHtml,
};
