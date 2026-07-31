const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';
import { createHash } from 'node:crypto';
import { dataScienceSchema, inferDataScienceMetadata } from '../lib/spine-data-science.js';
import { metricCountsForIds, parseMetricsJson, sanitizeMetricId, sanitizeMetricIds } from '../lib/spine-metrics.js';
import { appendAssetVersion, assetVersionForEntry, assetVersionForWebm } from '../lib/asset-version.js';

// ═══════════════ SECURITY: Rate Limiter ═══════════════
const rateLimitMap = new Map();
function checkRateLimit(key, maxRequests = 30, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.start > windowMs) {
    rateLimitMap.set(key, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  if (entry.count > maxRequests) return false;
  return true;
}

// ═══════════════ SECURITY: Audit Log ═══════════════
const auditLog = [];
function auditLogAction(action, email, details = {}) {
  const entry = { ts: new Date().toISOString(), action, email, ...details };
  auditLog.push(entry);
  if (auditLog.length > 500) auditLog.shift();
  console.log(`[AUDIT] ${entry.ts} ${action} by ${email} ${JSON.stringify(details)}`);
}

// ═══════════════ SECURITY: Input Sanitization ═══════════════
const SAFE_ID_REGEX = /^[a-zA-Z0-9._-]{1,220}$/;
const SAFE_FILTER_REGEX = /^[a-zA-Z0-9_-]{0,100}$/;
function sanitizeId(value) { return String(value || '').trim().slice(0, 220); }
function sanitizeFilterId(value) { return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100); }
function sanitizeText(value, maxLen = 400) { return String(value || '').trim().slice(0, maxLen); }

// ═══════════════ SECURITY: Session Token (httpOnly cookie) ═══════════════
const sessionTokenMap = new Map();
function createSessionToken(email, googlePayload) {
  const token = createHash('sha256').update(`${email}:${Date.now()}:${Math.random()}`).digest('hex');
  const expiresAt = Date.now() + 3600 * 1000;
  sessionTokenMap.set(token, { email, expiresAt, googlePayload });
  if (sessionTokenMap.size > 100) {
    const oldest = sessionTokenMap.keys().next().value;
    sessionTokenMap.delete(oldest);
  }
  return { token, expiresAt };
}
function validateSessionToken(token) {
  const session = sessionTokenMap.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { sessionTokenMap.delete(token); return null; }
  return session;
}
function parseCookies(cookieHeader) {
  const cookies = {};
  String(cookieHeader || '').split(';').forEach(pair => {
    const [k, v] = pair.trim().split('=');
    if (k) cookies[k] = decodeURIComponent(v || '');
  });
  return cookies;
}
function setCookieHeader(token, maxAge = 3600) {
  return `spine-admin-session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function joinRepoPath(...parts) {
  return parts.map(cleanRepoPath).filter(Boolean).join('/');
}

function textToBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function base64ToText(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64').toString('utf8');
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256HexFromBase64(base64 = '') {
  return createHash('sha256').update(Buffer.from(String(base64).replace(/\s/g, ''), 'base64')).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sanitizeSha256(value = '') {
  const hash = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
}

function publicGitHubWrite(result) {
  return {
    contentSha: String(result?.content?.sha || ''),
    commitSha: String(result?.commit?.sha || ''),
    commitUrl: String(result?.commit?.html_url || ''),
    downloadUrl: String(result?.content?.download_url || ''),
  };
}

function encodeRepoPath(path) {
  return cleanRepoPath(path)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function isExternalAsset(value) {
  return /^https?:\/\//i.test(String(value)) || /^data:/i.test(String(value));
}

function assetUrlForRepoPath(origin, path, version = '') {
  return appendAssetVersion(`${origin}/assets/${encodeRepoPath(path)}`, version);
}

function assetFileName(value = '') {
  return cleanRepoPath(value).split('/').filter(Boolean).pop() || '';
}

function safeHttpAsset(value = '') {
  const url = String(value).trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function sourceProofHashFor(sourceProof) {
  if (!sourceProof || typeof sourceProof !== 'object') return '';
  const provided = sanitizeSha256(sourceProof.proofHash);
  const payload = JSON.parse(JSON.stringify(sourceProof));
  delete payload.proofHash;
  if (payload.blockchain && typeof payload.blockchain === 'object') {
    payload.blockchain.recommendedAnchorPayload = '';
  }
  const calculated = sha256Hex(canonicalJson(payload));
  if (provided && calculated !== provided) throw new Error('Source proof hash mismatch');
  return provided || calculated;
}

function normalizeUploadedProofFiles(value = []) {
  const files = Array.isArray(value) ? value : [];
  return files
    .map((file) => ({
      name: String(file?.name || '').trim().slice(0, 260),
      path: cleanRepoPath(file?.path || ''),
      bytes: Math.max(0, Math.round(Number(file?.bytes || 0) || 0)),
      sha256: sanitizeSha256(file?.sha256),
      github: {
        contentSha: String(file?.github?.contentSha || '').trim().slice(0, 80),
        commitSha: String(file?.github?.commitSha || '').trim().slice(0, 80),
        commitUrl: safeHttpAsset(file?.github?.commitUrl || ''),
        downloadUrl: safeHttpAsset(file?.github?.downloadUrl || ''),
      },
    }))
    .filter((file) => file.name && file.path && file.sha256)
    .slice(0, 250);
}

function cleanProofString(value = '', maxLength = 260) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeProofNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBrowserEnvironment(value) {
  if (!value || typeof value !== 'object') return null;
  const languages = Array.isArray(value.languages)
    ? value.languages.map((language) => cleanProofString(language, 32)).filter(Boolean).slice(0, 8)
    : [];
  const screen = value.screen && typeof value.screen === 'object' ? value.screen : {};
  return {
    userAgent: cleanProofString(value.userAgent, 360),
    platform: cleanProofString(value.platform, 120),
    language: cleanProofString(value.language, 32),
    languages,
    hardwareConcurrency: normalizeProofNumber(value.hardwareConcurrency),
    ...(Number.isFinite(Number(value.deviceMemory)) ? { deviceMemory: normalizeProofNumber(value.deviceMemory) } : {}),
    screen: {
      width: normalizeProofNumber(screen.width),
      height: normalizeProofNumber(screen.height),
      colorDepth: normalizeProofNumber(screen.colorDepth),
      pixelRatio: normalizeProofNumber(screen.pixelRatio, 1),
    },
    timezone: cleanProofString(value.timezone, 80),
    timezoneOffset: normalizeProofNumber(value.timezoneOffset),
    maxTouchPoints: normalizeProofNumber(value.maxTouchPoints),
    cookieEnabled: Boolean(value.cookieEnabled),
  };
}

async function maybeAnchorOnEvm(anchorHash) {
  const rpcUrl = String(process.env.BLOCKCHAIN_RPC_URL || '').trim();
  const privateKey = String(process.env.BLOCKCHAIN_PRIVATE_KEY || '').trim();
  const providedTo = String(process.env.BLOCKCHAIN_ANCHOR_TO || '').trim();
  const explorerBaseUrl = String(process.env.BLOCKCHAIN_EXPLORER_TX_URL || '').trim().replace(/\/+$/g, '');
  const transactionData = `0x${anchorHash}`;

  if (!rpcUrl || !privateKey) {
    return {
      status: 'ready-to-anchor',
      chain: 'evm',
      transactionData,
      message: 'Set BLOCKCHAIN_RPC_URL and BLOCKCHAIN_PRIVATE_KEY in the server environment to write this proof hash to an EVM blockchain transaction.',
    };
  }

  try {
    const { JsonRpcProvider, Wallet } = await import('ethers');
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    const network = await provider.getNetwork();
    const to = /^0x[a-f0-9]{40}$/i.test(providedTo) ? providedTo : wallet.address;
    const tx = await wallet.sendTransaction({ to, value: 0n, data: transactionData });
    return {
      status: 'submitted',
      chain: 'evm',
      chainId: Number(network.chainId),
      network: network.name,
      from: wallet.address,
      to,
      transactionHash: tx.hash,
      transactionData,
      ...(explorerBaseUrl ? { explorerUrl: `${explorerBaseUrl}/${tx.hash}` } : {}),
    };
  } catch (error) {
    return {
      status: 'failed',
      chain: 'evm',
      transactionData,
      message: error instanceof Error ? error.message : 'Blockchain transaction failed',
    };
  }
}

async function createBlockchainAnchor({ sourceProof, uploadedFiles, body, settings, googlePayload, anonymousAccount, origin }) {
  const sourceProofHash = sourceProofHashFor(sourceProof);
  if (!sourceProofHash) throw new Error('Invalid source proof hash');

  const uploadedAt = String(sourceProof?.uploadedAt || body?.uploadedAt || new Date().toISOString());
  const uploadPath = cleanRepoPath(body?.uploadPath || sourceProof?.github?.previewPath || '');
  const proofPath = cleanRepoPath(sourceProof?.proofPath || body?.proofPath || '');
  const proofUrl = safeHttpAsset(sourceProof?.proofUrl || body?.proofUrl || (proofPath ? assetUrlForRepoPath(origin, proofPath) : ''));
  const userEmail = String(googlePayload?.email || '').trim().toLowerCase();
  const browserEnvironment = normalizeBrowserEnvironment(sourceProof?.uploader?.browserEnvironment);
  const anchorBase = {
    type: 'SpineLinkGitHubBlockchainAnchor',
    version: 1,
    createdAt: new Date().toISOString(),
    entryId: String(body?.entryId || sourceProof?.entryId || '').trim().slice(0, 220),
    title: cleanPublicProfileText(body?.title || sourceProof?.title || '', 180),
    uploadedAt,
    sourceProofHash,
    sourceProofPath: proofPath,
    sourceProofUrl: proofUrl,
    uploader: {
      mode: userEmail ? 'google-account' : 'anonymous-browser',
      ...(sourceProof?.uploader?.googleEmailSha256 ? { googleEmailSha256: sanitizeSha256(sourceProof.uploader.googleEmailSha256) } : {}),
      ...(anonymousAccount?.id ? { anonymousAccountId: anonymousAccount.id } : {}),
      ...(anonymousAccount?.fingerprint ? { anonymousFingerprint: anonymousAccount.fingerprint } : {}),
      ...(sourceProof?.uploader?.browserFingerprintSha256 ? { browserFingerprintSha256: sanitizeSha256(sourceProof.uploader.browserFingerprintSha256) } : {}),
      ...(sourceProof?.uploader?.browserEnvironmentHashSha256 ? { browserEnvironmentHashSha256: sanitizeSha256(sourceProof.uploader.browserEnvironmentHashSha256) } : {}),
      ...(browserEnvironment ? { browserEnvironment } : {}),
    },
    github: {
      owner: settings.owner,
      repo: settings.repo,
      branch: settings.branch,
      repositoryUrl: `https://github.com/${settings.owner}/${settings.repo}`,
      uploadPath,
      files: normalizeUploadedProofFiles(uploadedFiles),
    },
    legalEvidence: {
      statement:
        'This record links file SHA-256 hashes, browser/account identity hashes, browser environment evidence, GitHub repository writes, and an optional EVM transaction payload for source-origin evidence.',
      privacy:
        'Email is stored only as SHA-256 in the proof. Anonymous browser/account identifiers are pseudonymous and should be treated as evidence metadata, not personal identity by themselves.',
    },
  };
  const anchorHash = sha256Hex(canonicalJson(anchorBase));
  const blockchain = await maybeAnchorOnEvm(anchorHash);
  return {
    ...anchorBase,
    anchorHash,
    recommendedAnchorPayload: `sha256:${anchorHash}`,
    blockchain,
  };
}

function derivedMediaFromFiles(origin, entry, extensions) {
  const previewPath = cleanRepoPath(entry?.previewPath || '');
  const files = Array.isArray(entry?.files) ? entry.files : [];
  const file = files.find((item) => extensions.some((extension) => String(item || '').toLowerCase().endsWith(extension)));
  return previewPath && file ? assetUrlForRepoPath(origin, joinRepoPath(previewPath, String(file)), assetVersionForEntry(entry, file)) : '';
}

function generatedThumbnailUrl(origin, entry) {
  const id = String(entry?.id || '').trim();
  const poster = String(entry?.thumbnailPoster || '');
  return id && /^data:image\/webp;base64,/i.test(poster)
    ? assetUrlForRepoPath(origin, `library/${id}/generated-preview.webp`, assetVersionForEntry(entry, 'generated-preview'))
    : '';
}

function generatedPreviewWebmUrl(origin, entry) {
  const id = String(entry?.id || '').trim();
  return id ? `${origin}/v_holder.webm` : '';
}

async function dispatchSpineExportWebm(settings, entry, origin) {
  const id = String(entry?.id || '').trim();
  if (!id) return null;
  const defaultAnimation = String(entry?.defaultAnimation || (Array.isArray(entry?.animations) ? entry.animations[0] : '') || '').trim();
  const animations = Array.isArray(entry?.animations) ? entry.animations : [];
  try {
    const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/dispatches`, {
      method: 'POST',
      headers: githubHeaders(settings.token),
      body: JSON.stringify({
        event_type: 'spine-export-webm',
        client_payload: {
          uploadId: id,
          animation: defaultAnimation,
          animations,
          origin: String(origin || '').replace(/\/+$/, ''),
          owner: settings.owner,
          repo: settings.repo,
          branch: settings.branch,
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[UPLOAD] dispatch workflow error: ${response.status} ${text}`);
      return { status: 'failed', error: text };
    }
    return { status: 'dispatched' };
  } catch (error) {
    console.error('[UPLOAD] dispatch workflow exception:', error instanceof Error ? error.message : String(error));
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

function publicLibraryEntry(origin, entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const next = { ...entry };
  const version = assetVersionForEntry(entry);
  next.thumbnail = appendAssetVersion(safeHttpAsset(next.thumbnail), version);
  next.thumbnailPoster =
    appendAssetVersion(safeHttpAsset(next.thumbnailPoster), version) ||
    generatedThumbnailUrl(origin, entry) ||
    derivedMediaFromFiles(origin, entry, ['.webp', '.png', '.jpg', '.jpeg']);
  // Use webmGeneratedAt as cache-buster for webm so CDN serves the latest generated preview
  const webmVersion = assetVersionForWebm(entry);
  next.webmPreview = /\.webm(?:[?#].*)?$/i.test(String(next.webmPreview || ''))
    ? appendAssetVersion(safeHttpAsset(next.webmPreview), webmVersion)
    : '';
  next.webmPreview = next.webmPreview || derivedMediaFromFiles(origin, entry, ['.webm']) || generatedPreviewWebmUrl(origin, entry);
  return next;
}

function publicLibraryEntries(origin, entries) {
  return Array.isArray(entries) ? entries.map((entry) => publicLibraryEntry(origin, entry)) : [];
}

function normalizePreviewHtml(settings, path, contentBase64, origin) {
  if (!path.endsWith('/preview.html')) return contentBase64;

  try {
    const html = base64ToText(contentBase64);
    const match = html.match(/(<script type="application\/json" id="spine-preview-config">)([\s\S]*?)(<\/script>)/);
    if (!match) return contentBase64;

    const uploadPath = cleanRepoPath(path).replace(/\/preview\.html$/, '');
    const assetUrl = (repoPath) => `${origin}/assets/${encodeRepoPath(repoPath)}`;
    const config = JSON.parse(match[2].replace(/\\u003c/g, '<'));

    for (const set of Array.isArray(config.sets) ? config.sets : []) {
      const setLabel = String(set.label || '');
      const setAssetUrl = (name) => assetUrl(joinRepoPath(uploadPath, setLabel, String(name || '')));

      if (set.skeleton && (!isExternalAsset(set.skeleton) || String(set.skeleton).includes('raw.githubusercontent.com'))) set.skeleton = setAssetUrl(set.skeleton.split('/').pop());
      if (set.atlas && (!isExternalAsset(set.atlas) || String(set.atlas).includes('raw.githubusercontent.com'))) set.atlas = setAssetUrl(set.atlas.split('/').pop());

      if (set.rawDataURIs && typeof set.rawDataURIs === 'object') {
        for (const key of Object.keys(set.rawDataURIs)) {
          const canonicalKey = assetFileName(key);
          if (!isExternalAsset(set.rawDataURIs[key]) || String(set.rawDataURIs[key]).startsWith('data:') || String(set.rawDataURIs[key]).includes('raw.githubusercontent.com')) {
            set.rawDataURIs[key] = setAssetUrl(canonicalKey || key);
          }
          if (canonicalKey && canonicalKey !== key) delete set.rawDataURIs[key];
          if (canonicalKey) set.rawDataURIs[canonicalKey] = setAssetUrl(canonicalKey);
        }
      }
    }

    const nextJson = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return textToBase64(html.replace(match[0], `${match[1]}${nextJson}${match[3]}`));
  } catch {
    return contentBase64;
  }
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function unauthorized(message, statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function forbidden(message = 'Forbidden') { return unauthorized(message, 403); }
function badRequest(message = 'Bad request') { return unauthorized(message, 400); }
function notFound(message = 'Not found') { return unauthorized(message, 404); }
function tooManyRequests(message = 'Too many requests') { return unauthorized(message, 429); }

async function verifyGoogleTokenRaw(accessToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!response.ok) throw unauthorized('Invalid Google token');
  const payload = await response.json();
  if (String(payload.aud || '') !== String(clientId)) throw unauthorized('Token audience mismatch');
  if (payload.email_verified !== 'true' && payload.email_verified !== true) throw unauthorized('Email not verified');
  return { email: String(payload.email || ''), name: String(payload.name || ''), picture: String(payload.picture || '') };
}

async function verifyGoogleToken(request, body) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
  const authHeader = request.headers.authorization || request.headers.Authorization || '';
  const bearerToken = String(authHeader).match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const googleToken = bearerToken || String(body?.googleIdToken || '');

  if (!clientId) throw unauthorized('GOOGLE_CLIENT_ID is not configured', 500);
  if (!googleToken) throw unauthorized('Sign in with Google before uploading files');

  const idTokenResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(googleToken)}`);
  const idPayload = await idTokenResponse.json().catch(() => ({}));

  if (idTokenResponse.ok) {
    if (idPayload.aud !== clientId) throw unauthorized('Google token audience does not match this app');
    if (idPayload.email_verified !== true && idPayload.email_verified !== 'true') throw unauthorized('Google email is not verified');
    return idPayload;
  }

  const accessTokenResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(googleToken)}`);
  const accessPayload = await accessTokenResponse.json().catch(() => ({}));
  if (accessTokenResponse.ok && accessPayload.aud && accessPayload.aud !== clientId) {
    throw unauthorized('Google token audience does not match this app');
  }

  const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${googleToken}` },
  });
  const userPayload = await userResponse.json().catch(() => ({}));

  if (!userResponse.ok) {
    throw unauthorized(typeof idPayload?.error_description === 'string' ? idPayload.error_description : 'Invalid Google token');
  }

  if (userPayload.email_verified !== true && userPayload.email_verified !== 'true') throw unauthorized('Google email is not verified');

  return userPayload;
}

async function optionalGooglePayload(request, body) {
  const authHeader = request.headers.authorization || request.headers.Authorization || '';
  const bearerToken = String(authHeader).match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const googleToken = bearerToken || String(body?.googleIdToken || '');
  if (!googleToken) return null;
  return verifyGoogleToken(request, body);
}

function normalizeAnonymousAccount(body) {
  const account = body?.anonymousAccount && typeof body.anonymousAccount === 'object' ? body.anonymousAccount : {};
  const id = String(account.id || body?.anonymousAccountId || '').trim();
  const fingerprint = String(account.fingerprint || body?.anonymousFingerprint || '').trim();
  if (!id || !/^anon_[a-z0-9_-]{3,96}$/i.test(id)) return null;
  return { id, fingerprint };
}


function normalizeNote(value = '') {
  const words = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 20);
  return words.join(' ');
}

function cleanPublicProfileText(value = '', maxLength = 120) {
  return String(value).trim().slice(0, maxLength);
}

function cleanPublicProfileImage(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function hashString(value = '') {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function publicOwnerIdFor(googlePayload, anonymousAccount, fallback = '') {
  const provided = String(fallback || '').trim();
  if (/^u_[a-z0-9]{3,32}$/i.test(provided)) return provided;
  const source = String(googlePayload?.email || anonymousAccount?.id || '').toLowerCase();
  return source ? `u_${hashString(source)}` : '';
}

function canEditEntry(entry, googlePayload, anonymousAccount) {
  const userEmail = String(googlePayload?.email || '').toLowerCase();
  const ownerEmail = String(entry?.ownerEmail || '').toLowerCase();
  const anonymousId = String(anonymousAccount?.id || '').toLowerCase();
  const ownerAnonId = String(entry?.ownerAnonId || '').toLowerCase();
  return Boolean((userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId));
}

const archiveAdminEmails = new Set([
  'vladyslavchaplygin@gmail.com',
  'vladyslavchaplyрin@gmail.com',
  'leopolds2010@gmail.com',
]);

function isArchiveAdmin(googlePayload) {
  return archiveAdminEmails.has(String(googlePayload?.email || '').trim().toLowerCase());
}

function normalizeArchiveExclusionRules(value) {
  const rules = Array.isArray(value) ? value : [];
  return rules
    .map((rule) => ({
      enabled: rule?.enabled !== false,
      type: rule?.type === 'regex' ? 'regex' : 'contains',
      field: ['all', 'id', 'title', 'ownerEmail', 'ownerName', 'note', 'files', 'animations', 'path'].includes(String(rule?.field || ''))
        ? String(rule.field)
        : 'all',
      pattern: String(rule?.pattern || '').trim().slice(0, 400),
      flags: String(rule?.flags || 'i').replace(/[^dgimsuvy]/g, '').slice(0, 8) || 'i',
    }))
    .filter((rule) => rule.pattern)
    .slice(0, 3000);
}

function normalizeArchiveEntryIds(value) {
  const ids = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const id of ids) {
    const entryId = String(id || '').trim();
    if (!entryId || entryId.length > 220 || /[<>"'\\/\0]/.test(entryId) || seen.has(entryId)) continue;
    seen.add(entryId);
    normalized.push(entryId);
    if (normalized.length >= 1000) break;
  }
  return normalized;
}

function metricsVisitorHash(request, body = {}) {
  const provided = String(body?.visitorId || '').trim();
  const fallback = [
    request.headers['x-forwarded-for'] || request.socket?.remoteAddress || '',
    request.headers['user-agent'] || '',
  ].join('|');
  return createHash('sha256').update(provided || fallback || 'anonymous').digest('hex').slice(0, 32);
}

function normalizeMetrics(metrics) {
  const next = metrics && typeof metrics === 'object' ? metrics : {};
  if (!next.entries || typeof next.entries !== 'object' || Array.isArray(next.entries)) next.entries = {};
  return next;
}

function normalizeEntryMetric(metrics, id) {
  const metricId = sanitizeMetricId(id);
  if (!metricId) return null;
  const current = metrics.entries[metricId] && typeof metrics.entries[metricId] === 'object' ? metrics.entries[metricId] : {};
  current.likes = Math.max(0, Number(current.likes || 0) || 0);
  current.views = Math.max(0, Number(current.views || 0) || 0);
  if (!current.likedBy || typeof current.likedBy !== 'object' || Array.isArray(current.likedBy)) current.likedBy = {};
  if (!current.recentViews || typeof current.recentViews !== 'object' || Array.isArray(current.recentViews)) current.recentViews = {};
  metrics.entries[metricId] = current;
  return current;
}

function pruneRecentViews(entry, now) {
  const cutoff = now - 32 * 24 * 60 * 60 * 1000;
  const pairs = Object.entries(entry.recentViews || {})
    .map(([key, value]) => [key, Date.parse(String(value || '')) || 0])
    .filter(([, time]) => time >= cutoff)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2000);
  entry.recentViews = Object.fromEntries(pairs.map(([key, time]) => [key, new Date(time).toISOString()]));
}

async function readMetrics(settings, metricsPath) {
  const current = await getGitHubContent(settings, metricsPath);
  const text = current?.content && current.encoding === 'base64' ? base64ToText(current.content) : '';
  return { current, metrics: normalizeMetrics(parseMetricsJson(text)) };
}

async function mutateMetrics(settings, metricsPath, message, mutate, origin = '') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { current, metrics } = await readMetrics(settings, metricsPath);
    const changed = mutate(metrics);
    if (!changed) return { metrics, changed: false };
    metrics.updatedAt = new Date().toISOString();
    try {
      await putGitHubContent(settings, metricsPath, textToBase64(JSON.stringify(metrics, null, 2)), message, current?.sha, origin);
      return { metrics, changed: true };
    } catch (error) {
      if (String(error?.message || '').includes('sha') && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('Could not update metrics after retries');
}

function compareLibraryEntries(a, b) {
  const aOrder = Number(a?.libraryOrder);
  const bOrder = Number(b?.libraryOrder);
  const hasAOrder = Number.isFinite(aOrder);
  const hasBOrder = Number.isFinite(bOrder);
  if (hasAOrder && hasBOrder && aOrder !== bOrder) return aOrder - bOrder;
  if (hasAOrder !== hasBOrder) return hasAOrder ? -1 : 1;
  return String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || ''));
}

function isSameLibraryOwner(entry, targetEntry) {
  const publicOwnerId = String(targetEntry?.publicOwnerId || '');
  const ownerEmail = String(targetEntry?.ownerEmail || '').toLowerCase();
  const ownerAnonId = String(targetEntry?.ownerAnonId || '').toLowerCase();
  const samePublicOwner = publicOwnerId && String(entry?.publicOwnerId || '') === publicOwnerId;
  const sameEmail = ownerEmail && String(entry?.ownerEmail || '').toLowerCase() === ownerEmail;
  const sameAnon = ownerAnonId && String(entry?.ownerAnonId || '').toLowerCase() === ownerAnonId;
  return Boolean(samePublicOwner || sameEmail || sameAnon);
}

function dataScienceBasePathFor(body) {
  return cleanRepoPath(process.env.DATA_SCIENCE_BASE_PATH || body?.dataScience?.basePath || 'data-science');
}

async function updateDataScienceCatalog(settings, body, entry, commitPrefix, origin) {
  if (body?.dataScience?.enabled === false) return null;
  const basePath = dataScienceBasePathFor(body);
  if (!basePath) return null;

  const metadata = inferDataScienceMetadata(entry, settings);
  const animationAsset = metadata.animation_asset || {};
  const itemId = String(animationAsset.id || entry?.id || '');
  const itemPath = joinRepoPath(basePath, 'items', `${itemId}.json`);
  const indexPath = joinRepoPath(basePath, 'index.json');
  const schemaPath = joinRepoPath(basePath, 'schema.json');
  const currentItem = await getGitHubContent(settings, itemPath);
  const currentIndex = await getGitHubContent(settings, indexPath);
  const currentSchema = await getGitHubContent(settings, schemaPath);
  const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
  const indexRecord = {
    id: itemId,
    name: animationAsset.name || itemId,
    updatedAt: metadata.updatedAt,
    animation_asset: animationAsset,
    source: metadata.source,
    spine_spec: metadata.spine_spec,
    inference: metadata.inference,
    privacy: metadata.privacy,
  };
  const nextEntries = [indexRecord, ...currentEntries.filter((currentEntry) => String(currentEntry?.id || '') !== itemId)];

  await putGitHubContent(settings, itemPath, textToBase64(JSON.stringify(metadata, null, 2)), `${commitPrefix}: data-science item`, currentItem?.sha, origin);
  await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: data-science index`, currentIndex?.sha, origin);
  await putGitHubContent(settings, schemaPath, textToBase64(JSON.stringify(dataScienceSchema(), null, 2)), `${commitPrefix}: data-science schema`, currentSchema?.sha, origin);
  return { basePath, itemPath, indexPath, schemaPath, animation_asset: animationAsset, inference: metadata.inference };
}

async function getGitHubContent(settings, path) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: githubHeaders(settings.token),
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Storage did not return ${path}: ${response.status}`);

  return response.json();
}

async function putGitHubContent(settings, path, contentBase64, message, sha, origin = '') {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const normalizedContentBase64 = normalizePreviewHtml(settings, path, contentBase64, origin);
  let currentSha = sha;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}`, {
      method: 'PUT',
      headers: {
        ...githubHeaders(settings.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        content: normalizedContentBase64,
        branch: settings.branch,
        ...(currentSha ? { sha: currentSha } : {}),
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      return result;
    }

    const errMsg = typeof result?.message === 'string' ? result.message : `Upload API ${response.status}`;
    const isShaConflict = response.status === 422 && /expected.*but/.test(errMsg);
    if (!isShaConflict || attempt >= 2) {
      throw new Error(errMsg);
    }
    // SHA conflict: re-read the file to get the current SHA and retry
    try {
      const fresh = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}?ref=${settings.branch}`, {
        headers: githubHeaders(settings.token),
      });
      const freshData = await fresh.json();
      if (freshData?.sha) {
        currentSha = freshData.sha;
      }
    } catch {
      throw new Error(errMsg);
    }
  }
  throw new Error(`putGitHubContent failed after 3 attempts for ${path}`);
}

async function deleteGitHubContent(settings, path, message, sha) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}`, {
    method: 'DELETE',
    headers: {
      ...githubHeaders(settings.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      sha,
      branch: settings.branch,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 404) {
    throw new Error(typeof result?.message === 'string' ? result.message : `Delete API ${response.status}`);
  }
  return result;
}

async function deleteGitHubPath(settings, path, commitPrefix) {
  const item = await getGitHubContent(settings, path);
  if (!item) return;
  if (Array.isArray(item)) {
    for (const child of item) {
      await deleteGitHubPath(settings, child.path, commitPrefix);
    }
    return;
  }
  if (item.type === 'file' && item.sha) {
    await deleteGitHubContent(settings, item.path || path, `${commitPrefix}: ${item.name || path}`, item.sha);
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return response.status(500).json({ error: 'GITHUB_TOKEN is not configured' });

  try {
    const origin = `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers['x-forwarded-host'] || request.headers.host}`;
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    const googlePayload = await optionalGooglePayload(request, body);
    const anonymousAccount = normalizeAnonymousAccount(body);

    const settings = {
      owner: process.env.GITHUB_OWNER || body?.settings?.owner || defaultOwner,
      repo: process.env.GITHUB_REPO || body?.settings?.repo || defaultRepo,
      branch: process.env.GITHUB_BRANCH || body?.settings?.branch || defaultBranch,
      basePath: cleanRepoPath(process.env.GITHUB_BASE_PATH || body?.settings?.basePath || defaultBasePath),
      token,
    };

    const files = Array.isArray(body?.files) ? body.files : [];
    const file = body?.file;
    const entry = body?.entry;
    const previewHtml = String(body?.previewHtml || '');
    const uploadPath = cleanRepoPath(body?.uploadPath || '');
    const commitPrefix = String(body?.commitPrefix || 'Add Spine preview');
    const action = String(body?.action || '');

    if (action === 'get-metrics') {
      const ids = sanitizeMetricIds(body?.ids);
      const hash = metricsVisitorHash(request, body);
      const metricsPath = joinRepoPath(settings.basePath, 'metrics.json');
      const { metrics } = await readMetrics(settings, metricsPath);
      response.setHeader('Cache-Control', 'no-store');
      return response.status(200).json({ ok: true, metrics: metricCountsForIds(metrics, ids, hash) });
    }

    if (action === 'track-metric') {
      const metricAction = String(body?.metricAction || '').trim();
      const entryId = sanitizeMetricId(body?.entryId);
      if (!entryId) return response.status(400).json({ error: 'Invalid metrics entry id' });
      const hash = metricsVisitorHash(request, body);
      const metricsPath = joinRepoPath(settings.basePath, 'metrics.json');
      response.setHeader('Cache-Control', 'no-store');

      if (metricAction === 'view') {
        const now = Date.now();
        const day = new Date(now).toISOString().slice(0, 10);
        const viewKey = `${hash}:${day}`;
        const { metrics } = await mutateMetrics(settings, metricsPath, `Track Spine preview view ${entryId}`, (draft) => {
          const metricEntry = normalizeEntryMetric(draft, entryId);
          if (!metricEntry) return false;
          pruneRecentViews(metricEntry, now);
          if (metricEntry.recentViews[viewKey]) return false;
          metricEntry.recentViews[viewKey] = new Date(now).toISOString();
          metricEntry.views += 1;
          return true;
        }, origin);
        return response.status(200).json({ ok: true, entryId, metric: metricCountsForIds(metrics, [entryId], hash)[entryId] });
      }

      if (metricAction === 'like') {
        const liked = Boolean(body?.liked);
        const { metrics } = await mutateMetrics(settings, metricsPath, `${liked ? 'Like' : 'Unlike'} Spine preview ${entryId}`, (draft) => {
          const metricEntry = normalizeEntryMetric(draft, entryId);
          if (!metricEntry) return false;
          const currentlyLiked = Boolean(metricEntry.likedBy[hash]);
          if (liked && !currentlyLiked) {
            metricEntry.likedBy[hash] = new Date().toISOString();
            metricEntry.likes += 1;
            return true;
          }
          if (!liked && currentlyLiked) {
            delete metricEntry.likedBy[hash];
            metricEntry.likes = Math.max(0, metricEntry.likes - 1);
            return true;
          }
          return false;
        }, origin);
        return response.status(200).json({ ok: true, entryId, metric: metricCountsForIds(metrics, [entryId], hash)[entryId] });
      }

      return response.status(400).json({ error: 'Invalid metrics action' });
    }

    if (action === 'update-archive-exclusions') {
      if (!googlePayload?.email) throw unauthorized('Sign in with Google before editing archive rules');
      if (!isArchiveAdmin(googlePayload)) throw unauthorized('Only archive administrators can edit these rules', 403);
      const rulesPath = joinRepoPath(settings.basePath, 'archive-exclusions.json');
      const currentRules = await getGitHubContent(settings, rulesPath);
      const nextRules = {
        updatedAt: new Date().toISOString(),
        updatedBy: String(googlePayload.email || ''),
        rules: normalizeArchiveExclusionRules(body?.rules),
      };
      await putGitHubContent(
        settings,
        rulesPath,
        textToBase64(JSON.stringify(nextRules, null, 2)),
        `${commitPrefix}: update archive exclusions`,
        currentRules?.sha,
        origin,
      );
      return response.status(200).json({ ok: true, rules: nextRules.rules, updatedAt: nextRules.updatedAt });
    }

    if (action === 'delete-archive-entries') {
      if (!googlePayload?.email) throw unauthorized('Sign in with Google before deleting archive entries');
      if (!isArchiveAdmin(googlePayload)) throw unauthorized('Only archive administrators can delete archive entries', 403);
      const entryIds = normalizeArchiveEntryIds(body?.entryIds);
      if (!entryIds.length) return response.status(400).json({ error: 'Select at least one archive entry' });
      const entryIdSet = new Set(entryIds);
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const deletedEntries = [];
      const nextEntries = currentEntries.filter((currentEntry) => {
        const id = String(currentEntry?.id || '');
        if (!entryIdSet.has(id)) return true;
        deletedEntries.push(id);
        return false;
      });
      if (!deletedEntries.length) return response.status(404).json({ error: 'Selected archive entries were not found' });
      await putGitHubContent(
        settings,
        indexPath,
        textToBase64(JSON.stringify(nextEntries, null, 2)),
        `${commitPrefix}: delete archive entries`,
        currentIndex?.sha,
        origin,
      );
      return response.status(200).json({ ok: true, deleted: deletedEntries, indexed: nextEntries.length });
    }

    if (action === 'anchor-source-proof') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const sourceProof = body?.sourceProof && typeof body.sourceProof === 'object' ? body.sourceProof : null;
      if (!sourceProof) return response.status(400).json({ error: 'Invalid source proof payload' });
      const anchorPath = cleanRepoPath(body?.anchorPath || joinRepoPath(body?.uploadPath || sourceProof?.github?.previewPath || '', 'blockchain-anchor.json'));
      if (!anchorPath) return response.status(400).json({ error: 'Invalid blockchain anchor path' });

      const anchor = await createBlockchainAnchor({
        sourceProof,
        uploadedFiles: body?.uploadedFiles,
        body,
        settings,
        googlePayload,
        anonymousAccount,
        origin,
      });
      const currentAnchor = await getGitHubContent(settings, anchorPath);
      const writeResult = await putGitHubContent(
        settings,
        anchorPath,
        textToBase64(JSON.stringify(anchor, null, 2)),
        `${commitPrefix}: blockchain source proof anchor`,
        currentAnchor?.sha,
        origin,
      );
      return response.status(200).json({
        ok: true,
        anchor: {
          ...anchor,
          anchorPath,
          anchorUrl: assetUrlForRepoPath(origin, anchorPath),
          github: {
            ...anchor.github,
            anchorPath,
            anchorUrl: assetUrlForRepoPath(origin, anchorPath),
            anchorCommitSha: String(writeResult?.commit?.sha || ''),
            anchorCommitUrl: String(writeResult?.commit?.html_url || ''),
          },
        },
      });
    }

    if (action === 'put-file') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const path = cleanRepoPath(file?.path || body?.path || '');
      const contentBase64 = String(file?.contentBase64 || body?.contentBase64 || '');
      const message = String(body?.message || `${commitPrefix}: ${path.split('/').pop() || 'file'}`);
      if (!path || !contentBase64) return response.status(400).json({ error: 'Invalid file payload' });
      const existingFile = await getGitHubContent(settings, path);
      const writeResult = await putGitHubContent(settings, path, contentBase64, message, existingFile?.sha, origin);
      return response.status(200).json({
        ok: true,
        path,
        bytes: Buffer.from(contentBase64.replace(/\s/g, ''), 'base64').byteLength,
        sha256: sha256HexFromBase64(contentBase64),
        github: publicGitHubWrite(writeResult),
      });
    }

    if (action === 'multipart-upload-chunk') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const filePath = cleanRepoPath(body?.path || '');
      const chunkIndex = Number(body?.chunkIndex);
      const contentBase64 = String(body?.contentBase64 || '');
      const message = `${commitPrefix}: chunk ${chunkIndex} of ${filePath.split('/').pop() || 'file'}`;
      if (!filePath || !contentBase64 || !Number.isFinite(chunkIndex)) {
        return response.status(400).json({ error: 'Invalid chunk payload' });
      }
      const chunkPath = `${filePath}.__chunks/${String(chunkIndex).padStart(5, '0')}`;
      const existingChunk = await getGitHubContent(settings, chunkPath);
      const writeResult = await putGitHubContent(settings, chunkPath, contentBase64, message, existingChunk?.sha, origin);
      return response.status(200).json({
        ok: true,
        chunkIndex,
        chunkPath,
        bytes: Buffer.from(contentBase64.replace(/\s/g, ''), 'base64').byteLength,
        github: publicGitHubWrite(writeResult),
      });
    }

    if (action === 'reassemble-file') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const filePath = cleanRepoPath(body?.path || '');
      const chunkCount = Number(body?.chunkCount);
      if (!filePath || !Number.isFinite(chunkCount) || chunkCount < 1) {
        return response.status(400).json({ error: 'Invalid reassembly payload' });
      }
      let fullBase64 = '';
      const chunkShas = [];
      for (let i = 0; i < chunkCount; i++) {
        const chunkPath = `${filePath}.__chunks/${String(i).padStart(5, '0')}`;
        const chunk = await getGitHubContent(settings, chunkPath);
        if (!chunk || chunk.encoding !== 'base64') {
          return response.status(404).json({ error: `Chunk ${i} not found at ${chunkPath}` });
        }
        fullBase64 += String(chunk.content).replace(/\s/g, '');
        chunkShas.push(chunk.sha);
      }
      const existingFile = await getGitHubContent(settings, filePath);
      const writeResult = await putGitHubContent(settings, filePath, fullBase64, `${commitPrefix}: reassembled ${filePath}`, existingFile?.sha, origin);
      for (let i = 0; i < chunkCount; i++) {
        const chunkPath = `${filePath}.__chunks/${String(i).padStart(5, '0')}`;
        try {
          await deleteGitHubContent(settings, chunkPath, `${commitPrefix}: cleanup chunk ${i} of ${filePath}`, chunkShas[i]);
        } catch { /* ignore cleanup failures */ }
      }
      return response.status(200).json({
        ok: true,
        path: filePath,
        bytes: Buffer.from(fullBase64, 'base64').length,
        sha256: sha256HexFromBase64(fullBase64),
        github: publicGitHubWrite(writeResult),
      });
    }

    if (action === 'update-index') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      if (!entry) return response.status(400).json({ error: 'Invalid index payload' });

      const files = Array.isArray(entry.files) ? [...entry.files] : [];
      const skelName = basename(entry.skeleton || '');
      const skelStem = skelName.replace(/\.(json|skel)$/i, '');
      const fixedFiles = files.filter((f) => f !== skelStem && f !== `${skelStem}/`);
      for (const ext of ['json', 'skel']) {
        const ref = `${skelStem}/${skelStem}.${ext}`;
        if (!fixedFiles.some((f) => f === ref) && fixedFiles.some((f) => f.endsWith(`.${ext}`))) {
          const idx = fixedFiles.findIndex((f) => f.endsWith(`.${ext}`));
          if (idx >= 0) fixedFiles[idx] = ref;
        }
      }
      entry.files = fixedFiles;

      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const existingEntry = currentEntries.find((c) => c.id === entry.id);
      const nextEntry = {
        ...entry,
        ...(googlePayload?.email ? { ownerEmail: googlePayload.email } : {}),
        ...(entry?.ownerName || googlePayload?.name ? { ownerName: cleanPublicProfileText(entry?.ownerName || googlePayload?.name) } : {}),
        ...(entry?.ownerPicture || googlePayload?.picture ? { ownerPicture: cleanPublicProfileImage(entry?.ownerPicture || googlePayload?.picture) } : {}),
        ...(anonymousAccount?.id ? { ownerAnonId: anonymousAccount.id, ownerAnonFingerprint: anonymousAccount.fingerprint } : {}),
        publicOwnerId: publicOwnerIdFor(googlePayload, anonymousAccount, entry?.publicOwnerId),
        showOwnerLibrary: Boolean(entry?.showOwnerLibrary),
        portfolioMode: Boolean(entry?.portfolioMode),
        ...(existingEntry?.webmStatus === 'ready' ? { webmStatus: 'ready' } : { webmStatus: 'pending' }),
      };
      const nextEntries = [nextEntry, ...currentEntries.filter((currentEntry) => currentEntry.id !== nextEntry.id)];
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update library index`, currentIndex?.sha, origin);
      const dataScience = await updateDataScienceCatalog(settings, body, nextEntry, commitPrefix, origin);
      const isNewUpload = !existingEntry || existingEntry.webmStatus !== 'ready';
      const dispatch = isNewUpload ? await dispatchSpineExportWebm(settings, nextEntry, origin) : null;
      return response.status(200).json({ ok: true, indexed: nextEntries.length, dataScience, dispatch });
    }


    if (action === 'update-note') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const entryId = String(body?.entryId || '').trim();
      if (!entryId) return response.status(400).json({ error: 'Invalid note payload' });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const entryIndex = currentEntries.findIndex((currentEntry) => String(currentEntry?.id || '') === entryId);
      if (entryIndex < 0) return response.status(404).json({ error: 'Library entry not found' });
      if (!canEditEntry(currentEntries[entryIndex], googlePayload, anonymousAccount)) throw unauthorized('Only the owner can edit this text', 403);
      const note = normalizeNote(body?.note || '');
      const nextEntry = { ...currentEntries[entryIndex] };
      if (note) nextEntry.note = note;
      else delete nextEntry.note;
      const nextEntries = [...currentEntries];
      nextEntries[entryIndex] = nextEntry;
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update preview text`, currentIndex?.sha, origin);
      return response.status(200).json({ ok: true, entry: publicLibraryEntry(origin, nextEntry) });
    }

    if (action === 'update-entry-visibility') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const entryId = String(body?.entryId || '').trim();
      if (!entryId) return response.status(400).json({ error: 'Invalid visibility payload' });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const entryIndex = currentEntries.findIndex((currentEntry) => String(currentEntry?.id || '') === entryId);
      if (entryIndex < 0) return response.status(404).json({ error: 'Library entry not found' });
      if (!canEditEntry(currentEntries[entryIndex], googlePayload, anonymousAccount)) throw unauthorized('Only the owner can hide this entry', 403);
      const hiddenFromPublicLibrary = Boolean(body?.hiddenFromPublicLibrary);
      const nextEntry = { ...currentEntries[entryIndex] };
      if (hiddenFromPublicLibrary) nextEntry.hiddenFromPublicLibrary = true;
      else delete nextEntry.hiddenFromPublicLibrary;
      const nextEntries = [...currentEntries];
      nextEntries[entryIndex] = nextEntry;
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update entry visibility`, currentIndex?.sha, origin);
      return response.status(200).json({ ok: true, entry: publicLibraryEntry(origin, nextEntry) });
    }

    if (action === 'update-library-order') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const entryId = String(body?.entryId || '').trim();
      const direction = String(body?.direction || '').trim().toLowerCase();
      if (!entryId || !['up', 'down'].includes(direction)) return response.status(400).json({ error: 'Invalid order payload' });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const targetEntry = currentEntries.find((currentEntry) => String(currentEntry?.id || '') === entryId);
      if (!targetEntry) return response.status(404).json({ error: 'Library entry not found' });
      if (!canEditEntry(targetEntry, googlePayload, anonymousAccount)) throw unauthorized('Only the owner can reorder this library', 403);
      const ownerEntries = currentEntries
        .filter((currentEntry) => isSameLibraryOwner(currentEntry, targetEntry))
        .sort(compareLibraryEntries);
      const currentPosition = ownerEntries.findIndex((currentEntry) => String(currentEntry?.id || '') === entryId);
      const nextPosition = direction === 'up' ? currentPosition - 1 : currentPosition + 1;
      if (currentPosition < 0 || nextPosition < 0 || nextPosition >= ownerEntries.length) {
        return response.status(200).json({ ok: true, entries: publicLibraryEntries(origin, ownerEntries), changed: false });
      }
      const nextOwnerEntries = [...ownerEntries];
      const [movedEntry] = nextOwnerEntries.splice(currentPosition, 1);
      nextOwnerEntries.splice(nextPosition, 0, movedEntry);
      const orderById = new Map(nextOwnerEntries.map((entry, index) => [String(entry.id || ''), index + 1]));
      const nextEntries = currentEntries.map((currentEntry) => {
        const nextOrder = orderById.get(String(currentEntry?.id || ''));
        return nextOrder ? { ...currentEntry, libraryOrder: nextOrder } : currentEntry;
      });
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update public library order`, currentIndex?.sha, origin);
      return response.status(200).json({
        ok: true,
        entries: publicLibraryEntries(origin, nextOwnerEntries.map((entry, index) => ({ ...entry, libraryOrder: index + 1 }))),
        changed: true,
      });
    }

    if (action === 'update-profile-name') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const userEmail = String(googlePayload?.email || '').toLowerCase();
      const anonymousId = String(anonymousAccount?.id || '').toLowerCase();
      const ownerName = cleanPublicProfileText(body?.ownerName || googlePayload?.name || '', 80);
      const ownerPicture = cleanPublicProfileImage(body?.ownerPicture || googlePayload?.picture || '');
      const publicOwnerId = publicOwnerIdFor(googlePayload, anonymousAccount, body?.publicOwnerId);
      if (!ownerName) return response.status(400).json({ error: 'Account name is required' });

      let changed = false;
      const nextEntries = currentEntries.map((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        const isOwner = (userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId);
        if (!isOwner) return currentEntry;
        const nextEntry = { ...currentEntry, ownerName, publicOwnerId };
        if (googlePayload?.email) nextEntry.ownerEmail = googlePayload.email;
        if (ownerPicture) nextEntry.ownerPicture = ownerPicture;
        changed =
          changed ||
          currentEntry.ownerName !== nextEntry.ownerName ||
          currentEntry.publicOwnerId !== nextEntry.publicOwnerId ||
          currentEntry.ownerEmail !== nextEntry.ownerEmail ||
          currentEntry.ownerPicture !== nextEntry.ownerPicture;
        return nextEntry;
      });

      if (changed && currentIndex?.sha) {
        await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update account name`, currentIndex?.sha, origin);
      }

      const entries = nextEntries.filter((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        return (userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId);
      }).sort(compareLibraryEntries);
      return response.status(200).json({ ok: true, entries: publicLibraryEntries(origin, entries), changed });
    }

    if (action === 'update-profile-visibility') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const showOwnerLibrary = Boolean(body?.showOwnerLibrary);
      const userEmail = String(googlePayload?.email || '').toLowerCase();
      const anonymousId = String(anonymousAccount?.id || '').toLowerCase();
      const ownerName = cleanPublicProfileText(body?.ownerName || googlePayload?.name || '');
      const ownerPicture = cleanPublicProfileImage(body?.ownerPicture || googlePayload?.picture || '');
      const publicOwnerId = publicOwnerIdFor(googlePayload, anonymousAccount, body?.publicOwnerId);
      let changed = false;
      const nextEntries = currentEntries.map((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        const isOwner = (userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId);
        if (!isOwner) return currentEntry;
        changed = true;
        const nextEntry = { ...currentEntry, publicOwnerId, showOwnerLibrary };
        if (googlePayload?.email) nextEntry.ownerEmail = googlePayload.email;
        if (ownerName) nextEntry.ownerName = ownerName;
        if (ownerPicture) nextEntry.ownerPicture = ownerPicture;
        return nextEntry;
      });
      if (changed || currentIndex?.sha) {
        await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update public profile setting`, currentIndex?.sha, origin);
      }
      const entries = nextEntries.filter((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        return (userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId);
      }).sort(compareLibraryEntries);
      return response.status(200).json({ ok: true, entries: publicLibraryEntries(origin, entries), changed });
    }

    if (action === 'update-owner-portfolio-mode') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const portfolioMode = Boolean(body?.portfolioMode);
      const userEmail = String(googlePayload?.email || '').toLowerCase();
      const anonymousId = String(anonymousAccount?.id || '').toLowerCase();
      const ownerName = cleanPublicProfileText(body?.ownerName || googlePayload?.name || '');
      const ownerPicture = cleanPublicProfileImage(body?.ownerPicture || googlePayload?.picture || '');
      const publicOwnerId = publicOwnerIdFor(googlePayload, anonymousAccount, body?.publicOwnerId);
      let changed = false;
      const nextEntries = currentEntries.map((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        const isOwner = (userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId);
        if (!isOwner) return currentEntry;
        changed = changed || Boolean(currentEntry?.portfolioMode) !== portfolioMode;
        const nextEntry = { ...currentEntry, publicOwnerId, portfolioMode };
        if (googlePayload?.email) nextEntry.ownerEmail = googlePayload.email;
        if (ownerName) nextEntry.ownerName = ownerName;
        if (ownerPicture) nextEntry.ownerPicture = ownerPicture;
        return nextEntry;
      });
      if (changed || currentIndex?.sha) {
        await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update public page mode`, currentIndex?.sha, origin);
      }
      const entries = nextEntries.filter((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        return (userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId);
      }).sort(compareLibraryEntries);
      return response.status(200).json({ ok: true, entries: publicLibraryEntries(origin, entries), changed });
    }

    if (action === 'delete-entry') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const entryId = String(body?.entryId || '').trim();
      if (!entryId) return response.status(400).json({ error: 'Invalid delete payload' });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const entry = currentEntries.find((currentEntry) => String(currentEntry?.id || '') === entryId);
      if (!entry) return response.status(404).json({ error: 'Library entry not found' });
      if (!canEditEntry(entry, googlePayload, anonymousAccount)) throw unauthorized('Only the owner can delete this entry', 403);
      const previewPath = cleanRepoPath(entry.previewPath || joinRepoPath(settings.basePath, entryId));
      if (previewPath) await deleteGitHubPath(settings, previewPath, commitPrefix);
      const nextEntries = currentEntries.filter((currentEntry) => String(currentEntry?.id || '') !== entryId);
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update library index`, currentIndex?.sha, origin);
      return response.status(200).json({ ok: true, deleted: entryId });
    }

    if (action === 'get-index') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const userEmail = String(googlePayload?.email || '').toLowerCase();
      const anonymousId = String(anonymousAccount?.id || '').toLowerCase();
      const entries = currentEntries.filter((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        return (userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId);
      }).sort(compareLibraryEntries);
      return response.status(200).json({ ok: true, entries: publicLibraryEntries(origin, entries) });
    }

    if (action === 'get-entry') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const entryId = String(body?.entryId || '').trim();
      if (!entryId) return response.status(400).json({ error: 'Invalid entry payload' });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const entry = currentEntries.find((currentEntry) => String(currentEntry?.id || '') === entryId);
      if (!entry) return response.status(404).json({ error: 'Library entry not found' });
      return response.status(200).json({ ok: true, entry: publicLibraryEntry(origin, entry), canEdit: canEditEntry(entry, googlePayload, anonymousAccount) });
    }

    if (action === 'merge-anonymous-account') {
      if (!googlePayload?.email) throw unauthorized('Sign in with Google before merging library');
      if (!anonymousAccount) throw unauthorized('Anonymous account is required');
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const anonymousId = anonymousAccount.id.toLowerCase();
      const userEmail = String(googlePayload.email || '').toLowerCase();
      let changed = false;
      const nextEntries = currentEntries.map((currentEntry) => {
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        if (ownerAnonId !== anonymousId) return currentEntry;
        changed = changed || String(currentEntry?.ownerEmail || '').toLowerCase() !== userEmail;
        return {
          ...currentEntry,
          ownerEmail: googlePayload.email,
          publicOwnerId: publicOwnerIdFor(googlePayload, anonymousAccount, currentEntry?.publicOwnerId),
          ...(body?.ownerName || currentEntry?.ownerName || googlePayload.name
            ? { ownerName: cleanPublicProfileText(body?.ownerName || currentEntry?.ownerName || googlePayload.name) }
            : {}),
          ...(body?.ownerPicture || currentEntry?.ownerPicture || googlePayload.picture
            ? { ownerPicture: cleanPublicProfileImage(body?.ownerPicture || currentEntry?.ownerPicture || googlePayload.picture) }
            : {}),
        };
      });
      if (changed) {
        await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: merge library account`, currentIndex?.sha, origin);
      }
      const entries = nextEntries.filter((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        return ownerEmail === userEmail || ownerAnonId === anonymousId;
      }).sort(compareLibraryEntries);
      return response.status(200).json({ ok: true, entries: publicLibraryEntries(origin, entries), merged: changed });
    }

    // ═══════════════ ADMIN ACTIONS ═══════════════

    if (action === 'admin-login') {
      const { googleAccessToken } = body || {};
      if (!googleAccessToken) throw badRequest('Missing googleAccessToken');
      let googlePayload;
      try { googlePayload = await verifyGoogleTokenRaw(googleAccessToken); } catch { throw unauthorized('Invalid Google token'); }
      if (!googlePayload?.email) throw unauthorized('No email in token');
      if (!isArchiveAdmin(googlePayload)) throw forbidden('Not an administrator');
      const { token, expiresAt } = createSessionToken(googlePayload.email, googlePayload);
      auditLogAction('admin-login', googlePayload.email);
      const maxAge = Math.floor((expiresAt - Date.now()) / 1000);
      response.setHeader('Set-Cookie', setCookieHeader(token, maxAge));
      return response.status(200).json({ ok: true, email: googlePayload.email, expiresAt });
    }

    if (action === 'admin-session-check') {
      const cookies = parseCookies(request.headers.cookie);
      const session = validateSessionToken(cookies['spine-admin-session']);
      if (!session) throw unauthorized('Session expired');
      return response.status(200).json({ ok: true, email: session.email });
    }

    if (action === 'admin-logout') {
      const cookies = parseCookies(request.headers.cookie);
      const token = cookies['spine-admin-session'];
      if (token) sessionTokenMap.delete(token);
      response.setHeader('Set-Cookie', 'spine-admin-session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
      return response.status(200).json({ ok: true });
    }

    // All admin actions below require session cookie
    const cookies = parseCookies(request.headers.cookie);
    const session = validateSessionToken(cookies['spine-admin-session']);
    if (!session) throw unauthorized('Session expired — sign in again');
    const adminEmail = session.email;
    const clientIp = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

    if (action === 'admin-get-settings') {
      if (!checkRateLimit(`admin:${adminEmail}:get-settings`, 10)) throw tooManyRequests();
      auditLogAction('admin-get-settings', adminEmail, { ip: clientIp });
      const settingsPath = joinRepoPath(settings.basePath, 'site-settings.json');
      const current = await getGitHubContent(settings, settingsPath);
      const data = current?.content && current.encoding === 'base64' ? JSON.parse(base64ToText(current.content)) : {};
      return response.status(200).json({ ok: true, settings: data });
    }

    if (action === 'admin-save-settings') {
      if (!checkRateLimit(`admin:${adminEmail}:save-settings`, 5)) throw tooManyRequests();
      const newSettings = body?.settings;
      if (!newSettings || typeof newSettings !== 'object') throw badRequest('Invalid settings');
      auditLogAction('admin-save-settings', adminEmail, { ip: clientIp });
      const settingsPath = joinRepoPath(settings.basePath, 'site-settings.json');
      const current = await getGitHubContent(settings, settingsPath);
      await putGitHubContent(settings, settingsPath, textToBase64(JSON.stringify(newSettings, null, 2)), 'Admin: update site settings', current?.sha, origin);
      return response.status(200).json({ ok: true });
    }

    if (action === 'admin-get-index') {
      if (!checkRateLimit(`admin:${adminEmail}:get-index`, 10)) throw tooManyRequests();
      auditLogAction('admin-get-index', adminEmail, { ip: clientIp });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const current = await getGitHubContent(settings, indexPath);
      const data = current?.content && current.encoding === 'base64' ? JSON.parse(base64ToText(current.content)) : [];
      const entries = Array.isArray(data) ? data.map(e => ({
        id: e.id, title: e.title, ownerEmail: e.ownerEmail, ownerName: e.ownerName,
        hiddenFromPublicLibrary: e.hiddenFromPublicLibrary, uploadedAt: e.uploadedAt,
        animations: Array.isArray(e.animations) ? e.animations.length : 0, pageMode: e.pageMode,
      })) : [];
      return response.status(200).json({ ok: true, entries, total: entries.length });
    }

    if (action === 'admin-get-users') {
      if (!checkRateLimit(`admin:${adminEmail}:get-users`, 10)) throw tooManyRequests();
      auditLogAction('admin-get-users', adminEmail, { ip: clientIp });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const current = await getGitHubContent(settings, indexPath);
      const data = current?.content && current.encoding === 'base64' ? JSON.parse(base64ToText(current.content)) : [];
      const userMap = new Map();
      for (const e of (Array.isArray(data) ? data : [])) {
        const key = e.ownerEmail || e.ownerAnonId || 'unknown';
        if (!userMap.has(key)) userMap.set(key, { email: e.ownerEmail || '', name: e.ownerName || '', anonId: e.ownerAnonId || '', entries: 0 });
        userMap.get(key).entries++;
      }
      return response.status(200).json({ ok: true, users: Array.from(userMap.values()), total: userMap.size });
    }

    if (action === 'admin-delete-entry') {
      if (!checkRateLimit(`admin:${adminEmail}:delete-entry`, 10, 60000)) throw tooManyRequests();
      const entryId = sanitizeId(body?.entryId);
      if (!entryId) throw badRequest('Missing entryId');
      auditLogAction('admin-delete-entry', adminEmail, { ip: clientIp, entryId });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const current = await getGitHubContent(settings, indexPath);
      const data = current?.content && current.encoding === 'base64' ? JSON.parse(base64ToText(current.content)) : [];
      const filtered = (Array.isArray(data) ? data : []).filter(e => e.id !== entryId);
      if (filtered.length === data.length) throw notFound('Entry not found');
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(filtered, null, 2)), `Admin: delete entry ${entryId}`, current?.sha, origin);
      return response.status(200).json({ ok: true, remaining: filtered.length });
    }

    if (action === 'admin-toggle-visibility') {
      if (!checkRateLimit(`admin:${adminEmail}:toggle-vis`, 20)) throw tooManyRequests();
      const entryId = sanitizeId(body?.entryId);
      if (!entryId) throw badRequest('Missing entryId');
      auditLogAction('admin-toggle-visibility', adminEmail, { ip: clientIp, entryId });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const current = await getGitHubContent(settings, indexPath);
      const data = current?.content && current.encoding === 'base64' ? JSON.parse(base64ToText(current.content)) : [];
      let found = false;
      const updated = (Array.isArray(data) ? data : []).map(e => {
        if (e.id === entryId) { found = true; return { ...e, hiddenFromPublicLibrary: !e.hiddenFromPublicLibrary }; }
        return e;
      });
      if (!found) throw notFound('Entry not found');
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(updated, null, 2)), `Admin: toggle visibility ${entryId}`, current?.sha, origin);
      return response.status(200).json({ ok: true });
    }

    if (action === 'admin-trigger-workflow') {
      if (!checkRateLimit(`admin:${adminEmail}:trigger-wf`, 5, 300000)) throw tooManyRequests();
      const workflow = sanitizeText(body?.workflow, 50);
      const filter_id = sanitizeFilterId(body?.filter_id || '');
      if (!workflow) throw badRequest('Missing workflow');
      const allowed = ['spine-export-all.yml', 'spine-export-webm.yml'];
      if (!allowed.includes(workflow)) throw badRequest('Workflow not allowed');
      auditLogAction('admin-trigger-workflow', adminEmail, { ip: clientIp, workflow, filter_id });
      const dispatchRes = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/dispatches`, {
        method: 'POST',
        headers: { ...githubHeaders(settings.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: 'admin-dispatch', client_payload: { workflow, filter_id } }),
      });
      return response.status(200).json({ ok: dispatchRes.ok });
    }

    if (action === 'admin-get-exclusions') {
      if (!checkRateLimit(`admin:${adminEmail}:get-excl`, 10)) throw tooManyRequests();
      auditLogAction('admin-get-exclusions', adminEmail, { ip: clientIp });
      const exclPath = joinRepoPath(settings.basePath, 'archive-exclusions.json');
      const current = await getGitHubContent(settings, exclPath);
      const data = current?.content && current.encoding === 'base64' ? JSON.parse(base64ToText(current.content)) : { rules: [] };
      return response.status(200).json({ ok: true, exclusions: data });
    }

    if (action === 'admin-save-exclusions') {
      if (!checkRateLimit(`admin:${adminEmail}:save-excl`, 5)) throw tooManyRequests();
      const exclusions = body?.exclusions;
      if (!exclusions || typeof exclusions !== 'object') throw badRequest('Invalid exclusions');
      auditLogAction('admin-save-exclusions', adminEmail, { ip: clientIp });
      const exclPath = joinRepoPath(settings.basePath, 'archive-exclusions.json');
      const current = await getGitHubContent(settings, exclPath);
      await putGitHubContent(settings, exclPath, textToBase64(JSON.stringify(exclusions, null, 2)), 'Admin: update archive exclusions', current?.sha, origin);
      return response.status(200).json({ ok: true });
    }

    if (action === 'admin-rebuild-cache') {
      if (!checkRateLimit(`admin:${adminEmail}:rebuild`, 5)) throw tooManyRequests();
      auditLogAction('admin-rebuild-cache', adminEmail, { ip: clientIp });
      return response.status(200).json({ ok: true, message: 'Cache rebuild triggered' });
    }

    if (action === 'admin-get-audit-log') {
      if (!checkRateLimit(`admin:${adminEmail}:audit`, 10)) throw tooManyRequests();
      return response.status(200).json({ ok: true, log: auditLog.slice(-100) });
    }

    // ═══════════════ END ADMIN ACTIONS ═══════════════

    if (!settings.owner || !settings.repo || !uploadPath || !entry || !previewHtml || files.length < 3) {
      return response.status(400).json({ error: 'Invalid upload payload' });
    }

    if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');

    for (const file of files) {
      const filePath = joinRepoPath(uploadPath, file.name);
      const currentFile = await getGitHubContent(settings, filePath);
      await putGitHubContent(settings, filePath, file.contentBase64, `${commitPrefix}: ${file.name}`, currentFile?.sha, origin);
    }

    const previewPath = joinRepoPath(uploadPath, 'preview.html');
    const manifestPath = joinRepoPath(uploadPath, 'manifest.json');
    const currentPreview = await getGitHubContent(settings, previewPath);
    const currentManifest = await getGitHubContent(settings, manifestPath);
    await putGitHubContent(settings, previewPath, textToBase64(previewHtml), `${commitPrefix}: preview.html`, currentPreview?.sha, origin);
    await putGitHubContent(settings, manifestPath, textToBase64(JSON.stringify(entry, null, 2)), `${commitPrefix}: manifest.json`, currentManifest?.sha, origin);

    const indexPath = joinRepoPath(settings.basePath, 'index.json');
    const currentIndex = await getGitHubContent(settings, indexPath);
    const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
    const existingEntry = currentEntries.find((c) => c.id === entry.id);
    const nextEntry = {
      ...entry,
      ...(googlePayload?.email ? { ownerEmail: googlePayload.email } : {}),
      ...(entry?.ownerName || googlePayload?.name ? { ownerName: cleanPublicProfileText(entry?.ownerName || googlePayload?.name) } : {}),
      ...(entry?.ownerPicture || googlePayload?.picture ? { ownerPicture: cleanPublicProfileImage(entry?.ownerPicture || googlePayload?.picture) } : {}),
      ...(anonymousAccount?.id ? { ownerAnonId: anonymousAccount.id, ownerAnonFingerprint: anonymousAccount.fingerprint } : {}),
      publicOwnerId: publicOwnerIdFor(googlePayload, anonymousAccount, entry?.publicOwnerId),
      showOwnerLibrary: Boolean(entry?.showOwnerLibrary),
      portfolioMode: Boolean(entry?.portfolioMode),
      ...(existingEntry?.webmStatus === 'ready' ? { webmStatus: 'ready' } : { webmStatus: 'pending' }),
    };
    const nextEntries = [nextEntry, ...currentEntries.filter((currentEntry) => currentEntry.id !== nextEntry.id)];

    await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update library index`, currentIndex?.sha, origin);
    const dataScience = await updateDataScienceCatalog(settings, body, nextEntry, commitPrefix, origin);
    const dispatch = existingEntry?.webmStatus === 'ready' ? null : await dispatchSpineExportWebm(settings, nextEntry, origin);

    return response.status(200).json({
      ok: true,
      repositoryUrl: entry.repositoryUrl,
      previewUrl: `/api/github-preview?path=${encodeURIComponent(entry.previewPath)}`,
      uploaded: files.length + 3,
      dataScience,
      dispatch,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    const message = error instanceof Error ? error.message : 'Upload failed';
    console.error('[UPLOAD] error:', message);
    if (error instanceof Error && error.stack) console.error('[UPLOAD] stack:', error.stack);
    return response.status(statusCode).json({ error: message });
  }
}
