import { cacheProfiles, setCacheHeaders } from '../lib/cache-headers.js';

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  const id = String(request.query?.id || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,180}$/i.test(id)) return response.status(400).send('Invalid preview id');

  setCacheHeaders(response, cacheProfiles.mediaBrowser, cacheProfiles.mediaCdn);
  response.redirect(307, '/spine-link.webm');
}
