import { cacheProfiles, setCacheHeaders } from '../lib/cache-headers.js';

export default function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  setCacheHeaders(response, cacheProfiles.sitemapBrowser, cacheProfiles.sitemapCdn);
  const text = [
    'https://spine-link.vercel.app/',
    'https://spine-link.vercel.app/spine-link.html',
    'https://spine-link.vercel.app/amp.html',
    'https://spine-link.vercel.app/spine-preview.html',
    'https://spine-link.vercel.app/spine-preview-online.html',
    'https://spine-link.vercel.app/spine-web-viewer.html',
    'https://spine-link.vercel.app/spine-animation-preview.html',
    'https://spine-link.vercel.app/spine-animation-dataset.html',
    'https://spine-link.vercel.app/spine-link-manifesto.html',
    'https://spine-link.vercel.app/spine-library.html',
    'https://spine-link.vercel.app/spine-portfolio.html',
    'https://spine-link.vercel.app/share-spine-animation-link.html',
    'https://spine-link.vercel.app/spine-portfolio-link.html',
    'https://spine-link.vercel.app/spine-animator.html',
    'https://spine-link.vercel.app/spine-animations.html',
    'https://spine-link.vercel.app/spine-work.html',
    'https://spine-link.vercel.app/spne-lib.html',
    'https://spine-link.vercel.app/spine-link-video.html',
    'https://spine-link.vercel.app/spine-online-video.html',
    'https://spine-link.vercel.app/site-map.html',
    'https://spine-link.vercel.app/world-spine-archive',
    'https://spine-link.vercel.app/sitemap.xml',
    'https://spine-link.vercel.app/sitemap-portfolios.xml',
    'https://spine-link.vercel.app/sitemap-archive.xml',
    'https://spine-link.vercel.app/sitemap-video.xml',
    'https://spine-link.vercel.app/sitemap-images.xml',
    'https://spine-link.vercel.app/sitemap-index.xml',
    'https://spine-link.vercel.app/robots.txt',
    'https://spine-link.vercel.app/llms.txt',
    'https://spine-link.vercel.app/googlec2ff3a8991d80229.html',
    'https://spine-link.vercel.app/googlef7147f9e5c822059.html',
    '',
  ].join('\n');
  if (request.method === 'HEAD') return response.status(200).send('');
  return response.status(200).send(text);
}
