export default function handler(_request, response) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap.xml</loc>
  </sitemap>
</sitemapindex>
`;
  response.setHeader('Content-Type', 'application/xml; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  return response.status(200).send(xml);
}
