export const cacheProfiles = {
  immutable: 'public, max-age=31536000, immutable',
  immutableCdn: 'public, s-maxage=31536000, immutable',
  dynamicHtmlBrowser: 'public, max-age=60, stale-while-revalidate=300',
  dynamicHtmlCdn: 'public, s-maxage=600, stale-while-revalidate=86400',
  listBrowser: 'public, max-age=120, stale-while-revalidate=600',
  listCdn: 'public, s-maxage=900, stale-while-revalidate=86400',
  sitemapBrowser: 'public, max-age=0',
  sitemapCdn: 'public, s-maxage=3600, stale-while-revalidate=86400',
  mediaBrowser: 'public, max-age=3600, stale-while-revalidate=86400',
  mediaCdn: 'public, s-maxage=604800, stale-while-revalidate=2592000',
  assetBrowser: 'public, max-age=300, stale-while-revalidate=3600',
  assetCdn: 'public, s-maxage=3600, stale-while-revalidate=86400',
  noStore: 'no-store',
};

export function setCacheHeaders(response, browserCacheControl, cdnCacheControl = browserCacheControl) {
  response.setHeader('Cache-Control', browserCacheControl);
  if (cdnCacheControl && cdnCacheControl !== cacheProfiles.noStore) {
    response.setHeader('CDN-Cache-Control', cdnCacheControl);
    response.setHeader('Vercel-CDN-Cache-Control', cdnCacheControl);
  }
}

export function setNoStoreHeaders(response) {
  response.setHeader('Cache-Control', cacheProfiles.noStore);
  response.setHeader('CDN-Cache-Control', cacheProfiles.noStore);
  response.setHeader('Vercel-CDN-Cache-Control', cacheProfiles.noStore);
}
