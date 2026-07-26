import { cacheProfiles, setCacheHeaders } from '../lib/cache-headers.js';

export default function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap-portfolios.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap-archive.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap-video.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap-images.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
</sitemapindex>
`;
  response.setHeader('Content-Type', 'application/xml; charset=utf-8');
  setCacheHeaders(response, cacheProfiles.sitemapBrowser, cacheProfiles.sitemapCdn);
  if (request.method === 'HEAD') return response.status(200).send('');
  return response.status(200).send(xml);
}
