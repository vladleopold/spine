export default function handler(_request, response) {
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  return response.status(200).send('https://spine-link.vercel.app/\nhttps://spine-link.vercel.app/spine-preview.html\n');
}
