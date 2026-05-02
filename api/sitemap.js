const urls = [
  'https://spine-link.vercel.app/',
  'https://spine-link.vercel.app/amp.html',
  'https://spine-link.vercel.app/spine-preview.html',
  'https://spine-link.vercel.app/spine-link-video.html',
  'https://spine-link.vercel.app/spine-online-video.html',
];

export default function handler(_request, response) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url, index) => `  <url>
    <loc>${url}</loc>
    <lastmod>2026-05-01</lastmod>
    <changefreq>${index === 0 ? 'weekly' : 'monthly'}</changefreq>
    <priority>${index === 0 ? '1.0' : index >= 2 ? '0.9' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>
`;

  response.setHeader('Content-Type', 'application/xml; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  return response.status(200).send(xml);
}
