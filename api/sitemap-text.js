export default function handler(_request, response) {
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  return response.status(200).send([
    'https://spine-link.vercel.app/',
    'https://spine-link.vercel.app/spine-preview.html',
    'https://spine-link.vercel.app/spine-link-video.html',
    'https://spine-link.vercel.app/sitemap.xml',
    'https://spine-link.vercel.app/sitemap-video.xml',
    'https://spine-link.vercel.app/robots.txt',
    'https://spine-link.vercel.app/googlec2ff3a8991d80229.html',
    'https://spine-link.vercel.app/googlef7147f9e5c822059.html',
    '',
  ].join('\n'));
}
