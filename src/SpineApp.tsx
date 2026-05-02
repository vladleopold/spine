import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileArchive,
  Layers,
  Link as LinkIcon,
  LogOut,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { SpinePlayer as SpinePlayerInstance, SpinePlayerConfig } from "@esotericsoftware/spine-player";

type AppProps = {
  initialFiles?: File[];
};

type LoadedAsset = {
  file: File;
  dataUri: string;
  transparentizedDataUri?: string;
  premultipliedTransparentizedDataUri?: string;
  hasBlackMatte?: boolean;
  text?: string;
};

type PreparedSpine = {
  label: string;
  skeletonName: string;
  atlasName: string;
  atlasPages: string[];
  animations: string[];
  defaultAnimation?: string;
  defaultSkin?: string;
  premultipliedAlpha?: boolean;
  viewport?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  rawDataURIs: Record<string, string>;
};

type PlayerViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
};

type PlayerWithViewport = {
  currentViewport?: PlayerViewport;
  previousViewport?: PlayerViewport;
  viewportTransitionStart?: number;
};

type PlayerWithLoopControls = SpinePlayerInstance & {
  dom?: HTMLElement;
  paused?: boolean;
  animationState?: {
    data?: {
      defaultMix?: number;
      setMix?: (fromName: string, toName: string, duration: number) => void;
    };
    getCurrent?: (trackIndex: number) => { loop?: boolean } | null;
  } | null;
};

type Particle = {
  x: number;
  y: number;
  radius: number;
  speedX: number;
  speedY: number;
  alpha: number;
  pulse: number;
  color: string;
};

type BlendOverride = "original" | "normal" | "screen" | "additive";

type SkeletonRenderSettings = {
  pma: boolean;
  blend: BlendOverride;
};

type GitHubSettings = {
  owner: string;
  repo: string;
  branch: string;
  basePath: string;
  title: string;
};

type LibraryEntry = {
  id: string;
  title: string;
  ownerEmail?: string;
  ownerAnonId?: string;
  ownerAnonFingerprint?: string;
  ownerName?: string;
  ownerPicture?: string;
  publicOwnerId?: string;
  showOwnerLibrary?: boolean;
  hiddenFromPublicLibrary?: boolean;
  libraryOrder?: number;
  uploadedAt: string;
  skeleton: string;
  atlas: string;
  textures: string[];
  animations: string[];
  defaultAnimation: string;
  files: string[];
  previewPath: string;
  repositoryUrl: string;
  note?: string;
  thumbnail?: string;
  thumbnailType?: "gif" | "image";
};

type UploadResponse = {
  previewUrl?: string;
  repositoryUrl?: string;
  error?: string;
};

type GoogleUser = {
  email: string;
  name?: string;
  picture?: string;
};

type AnonymousAccount = {
  id: string;
  fingerprint: string;
};

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (settings?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          disableAutoSelect: () => void;
        };
        oauth2: {
          initTokenClient: (settings: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;
const base62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const googleClientId =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "452954491878-ebeqoeg5h7pr968uev0qbmtpsadg5mj3.apps.googleusercontent.com";
const githubPublishSettings: GitHubSettings = {
  owner: import.meta.env.VITE_GITHUB_OWNER ?? "vladleopold",
  repo: import.meta.env.VITE_GITHUB_REPO ?? "spine",
  branch: import.meta.env.VITE_GITHUB_BRANCH ?? "main",
  basePath: import.meta.env.VITE_GITHUB_BASE_PATH ?? "library",
  title: "",
};

type SpinePlayerModule = typeof import("@esotericsoftware/spine-player");

let spinePlayerModulePromise: Promise<SpinePlayerModule> | null = null;
let googleScriptPromise: Promise<void> | null = null;

function loadSpinePlayerModule() {
  if (!spinePlayerModulePromise) {
    spinePlayerModulePromise = Promise.all([
      import("@esotericsoftware/spine-player"),
      import("@esotericsoftware/spine-player/dist/spine-player.css"),
    ]).then(([module]) => {
      module.GLTexture.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = true;
      return module;
    });
  }

  return spinePlayerModulePromise;
}

function loadGoogleIdentityScript() {
  if (window.google) return Promise.resolve();
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Could not load Google sign-in.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Google sign-in."));
      document.head.appendChild(script);
    });
  }

  return googleScriptPromise;
}

const anonymousAccountStorageKey = "spine-link-anonymous-account";
const googleSessionStorageKey = "spine-link-google-session";
const profileVisibilityStorageKey = "spine-link-profile-visible-on-shares";

type StoredGoogleSession = {
  user: GoogleUser;
  accessToken: string;
  expiresAt: number;
};

function browserFingerprint() {
  if (typeof window === "undefined") return "server";
  return [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`,
  ].join("|");
}

function hashString(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function createAnonymousAccount(): AnonymousAccount {
  const fingerprint = hashString(browserFingerprint());
  const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return {
    id: `anon_${fingerprint}_${hashString(randomPart)}`,
    fingerprint,
  };
}

function getStoredAnonymousAccount(): AnonymousAccount {
  if (typeof window === "undefined") return createAnonymousAccount();

  try {
    const storedAccount = JSON.parse(window.localStorage.getItem(anonymousAccountStorageKey) || "null") as AnonymousAccount | null;
    if (storedAccount?.id?.startsWith("anon_") && storedAccount.fingerprint) return storedAccount;
  } catch {
    // Fall through and create a fresh account.
  }

  const nextAccount = createAnonymousAccount();
  window.localStorage.setItem(anonymousAccountStorageKey, JSON.stringify(nextAccount));
  return nextAccount;
}

function readStoredGoogleSession(): StoredGoogleSession | null {
  if (typeof window === "undefined") return null;
  try {
    const storedSession = JSON.parse(window.localStorage.getItem(googleSessionStorageKey) || "null") as StoredGoogleSession | null;
    if (!storedSession?.user?.email) return null;
    return storedSession;
  } catch {
    return null;
  }
}

function getValidStoredGoogleToken() {
  const storedSession = readStoredGoogleSession();
  if (!storedSession?.accessToken || storedSession.expiresAt <= Date.now() + 60_000) return "";
  return storedSession.accessToken;
}

function storeGoogleSession(user: GoogleUser, accessToken: string, expiresIn = 3300) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    googleSessionStorageKey,
    JSON.stringify({
      user,
      accessToken,
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    } satisfies StoredGoogleSession),
  );
}

function clearStoredGoogleSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(googleSessionStorageKey);
}

function readStoredProfileVisibility() {
  if (typeof window === "undefined") return true;
  const storedValue = window.localStorage.getItem(profileVisibilityStorageKey);
  return storedValue === null ? true : storedValue === "true";
}

function storeProfileVisibility(value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(profileVisibilityStorageKey, String(value));
}

function publicOwnerIdFor(user: GoogleUser | null, anonymousAccount: AnonymousAccount) {
  const source = (user?.email || anonymousAccount.id).toLowerCase();
  return `u_${hashString(source)}`;
}

function decodeJwtPayload<T = Record<string, unknown>>(token: string): T {
  const [, payload = ""] = token.split(".");
  const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
  const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
  const decodedPayload = window
    .atob(paddedPayload)
    .split("")
    .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .join("");
  return JSON.parse(decodeURIComponent(decodedPayload)) as T;
}

function isSkeletonFile(file: File) {
  const ext = extensionOf(file.name);
  return ext === "json" || ext === "skel";
}

function isAtlasFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".atlas") || lowerName.endsWith(".atlas.txt") || lowerName.endsWith(".atlas.docx");
}

function isImageFile(file: File) {
  return ["png", "jpg", "jpeg", "webp"].includes(extensionOf(file.name));
}

function assetStem(name: string) {
  return basename(name)
    .replace(/\.(atlas\.docx|atlas\.txt|atlas|json|skel|png|jpe?g|webp)$/i, "")
    .toLowerCase();
}

function readAsDataUri(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUri(dataUri: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode texture image."));
    image.src = dataUri;
  });
}

async function readAsTransparentizedImageDataUri(file: File) {
  const sourceDataUri = await readAsDataUri(file);
  const image = await loadImageFromDataUri(sourceDataUri);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width === 0 || canvas.height === 0) return { dataUri: sourceDataUri, hasBlackMatte: false };

  context.drawImage(image, 0, 0);
  const straightImageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pmaImageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = straightImageData.data;
  const pmaData = pmaImageData.data;
  let changedPixels = 0;
  let visiblePixels = 0;
  let nearBlackPixels = 0;
  const hardCutoff = 8;
  const softCutoff = 34;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) continue;
    visiblePixels += 1;

    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const brightness = Math.max(red, green, blue);
    if (brightness <= softCutoff) nearBlackPixels += 1;
  }

  const hasBlackMatte = visiblePixels > 0 && nearBlackPixels / visiblePixels > 0.18;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) continue;

    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const brightness = Math.max(red, green, blue);

    if (hasBlackMatte) {
      if (brightness <= hardCutoff) {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
        pmaData[index] = 0;
        pmaData[index + 1] = 0;
        pmaData[index + 2] = 0;
        pmaData[index + 3] = 0;
        changedPixels += 1;
        continue;
      }
    }

    if (brightness <= hardCutoff) {
      data[index + 3] = 0;
      changedPixels += 1;
    } else if (brightness <= softCutoff) {
      const nextAlpha = Math.round(alpha * ((brightness - hardCutoff) / (softCutoff - hardCutoff)));
      if (nextAlpha < alpha) {
        data[index + 3] = nextAlpha;
        changedPixels += 1;
      }
    }
  }

  if (changedPixels === 0) return { dataUri: sourceDataUri, hasBlackMatte: false };

  context.putImageData(straightImageData, 0, 0);
  const straightDataUri = canvas.toDataURL("image/png");
  context.putImageData(pmaImageData, 0, 0);
  const premultipliedDataUri = canvas.toDataURL("image/png");

  return {
    dataUri: straightDataUri,
    premultipliedDataUri,
    hasBlackMatte,
  };
}

function readAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}

function readAsArrayBuffer(file: File) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

async function readAtlasText(file: File) {
  const buffer = await readAsArrayBuffer(file);
  const bytes = new Uint8Array(buffer);
  const isZipDocument = bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (!file.name.toLowerCase().endsWith(".docx") && !isZipDocument) {
    return new TextDecoder().decode(buffer);
  }

  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) throw new Error(`Could not find word/document.xml inside ${file.name}`);

  const document = new DOMParser().parseFromString(documentXml, "application/xml");
  const paragraphs = Array.from(document.getElementsByTagName("w:p"));
  const lines = paragraphs
    .map((paragraph) => {
      return Array.from(paragraph.getElementsByTagName("w:t"))
        .map((node) => node.textContent ?? "")
        .join("");
    })
    .filter(Boolean);

  return lines.join("\n");
}

function extractAtlasPages(atlasText = "") {
  return atlasText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\.(png|jpe?g|webp)$/i.test(line));
}

type AtlasRegion = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function extractAtlasRegions(atlasText = "", pageName: string) {
  const regions: AtlasRegion[] = [];
  const lines = atlasText.split(/\r?\n/);
  let activePage = "";
  let activeRegion = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      activeRegion = "";
      continue;
    }

    if (/^[^\s].*\.(png|jpe?g|webp)$/i.test(rawLine)) {
      activePage = basename(line);
      activeRegion = "";
      continue;
    }

    if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t") && activePage === basename(pageName)) {
      activeRegion = line;
      continue;
    }

    if (activeRegion && activePage === basename(pageName)) {
      const boundsMatch = line.match(/^bounds:\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (boundsMatch) {
        regions.push({
          name: activeRegion,
          x: Number(boundsMatch[1]),
          y: Number(boundsMatch[2]),
          width: Number(boundsMatch[3]),
          height: Number(boundsMatch[4]),
        });
      }
    }
  }

  return regions;
}

async function transparentizeAtlasEffectRegions(sourceDataUri: string, atlasText = "", pageName: string) {
  const effectRegions = extractAtlasRegions(atlasText, pageName).filter((region) => /(^|_)(sw|glow)|(_g$)/i.test(region.name));
  if (effectRegions.length === 0) return sourceDataUri;

  const image = await loadImageFromDataUri(sourceDataUri);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width === 0 || canvas.height === 0) return sourceDataUri;

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let changedPixels = 0;

  for (const region of effectRegions) {
    const startX = Math.max(0, region.x);
    const startY = Math.max(0, region.y);
    const endX = Math.min(canvas.width, region.x + region.width);
    const endY = Math.min(canvas.height, region.y + region.height);

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const index = (y * canvas.width + x) * 4;
        const brightness = Math.max(data[index], data[index + 1], data[index + 2]);
        if (brightness > 48) continue;
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
        changedPixels += 1;
      }
    }
  }

  if (changedPixels === 0) return sourceDataUri;
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function hasPremultipliedAlpha(atlasText = "") {
  return /^\s*pma\s*:\s*true\s*$/im.test(atlasText);
}

function atlasTextWithPremultipliedAlpha(atlasText = "", premultipliedAlpha: boolean) {
  const nextLine = `pma:${premultipliedAlpha ? "true" : "false"}`;
  return /^\s*pma\s*:\s*(true|false)\s*$/im.test(atlasText)
    ? atlasText.replace(/^\s*pma\s*:\s*(true|false)\s*$/im, nextLine)
    : atlasText;
}

function decodeBase62(value: string) {
  return [...value].reduce((total, char) => total * 62 + base62Alphabet.indexOf(char), 0);
}

function decodePackedNumber(value: string) {
  const sign = value.startsWith("-") ? -1 : 1;
  const unsignedValue = sign < 0 ? value.slice(1) : value;
  const [integerPart, fractionPart = ""] = unsignedValue.split(".");
  const integer = integerPart ? decodeBase62(integerPart) : 0;
  const fraction =
    fractionPart && /^\d+$/.test(fractionPart)
      ? Number(`0.${fractionPart}`)
      : [...fractionPart].reduce((total, char, index) => {
          return total + base62Alphabet.indexOf(char) / 62 ** (index + 1);
        }, 0);

  return sign * (integer + fraction);
}

function decodePackedSkeletonJson(text?: string) {
  if (!text) return null;

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || !Array.isArray(parsed[0]) || typeof parsed[1] !== "string") {
    return parsed;
  }

  const table = parsed[0] as string[];
  const memo = new Map<number, unknown>();

  const decodeRef = (ref: string): unknown => {
    const index = decodeBase62(ref);
    if (memo.has(index)) return memo.get(index);

    const token = table[index];
    if (token === "~") return null;
    if (token.startsWith("n|")) return decodePackedNumber(token.slice(2));
    if (token.startsWith("b|")) return token.slice(2) === "T";

    if (token.startsWith("a|")) {
      const arrayValue: unknown[] = [];
      memo.set(index, arrayValue);
      const refs = token.slice(2).split("|").filter(Boolean);
      arrayValue.push(...refs.map(decodeRef));
      return arrayValue;
    }

    if (token.startsWith("o|")) {
      const objectValue: Record<string, unknown> = {};
      memo.set(index, objectValue);
      const refs = token.slice(2).split("|").filter(Boolean);
      if (refs.length === 0) return objectValue;
      const keys = decodeRef(refs[0]);

      if (Array.isArray(keys)) {
        keys.forEach((key, keyIndex) => {
          const valueRef = refs[keyIndex + 1];
          if (valueRef !== undefined) objectValue[String(key)] = decodeRef(valueRef);
        });
      } else {
        for (let refIndex = 0; refIndex < refs.length; refIndex += 2) {
          const valueRef = refs[refIndex + 1];
          if (valueRef !== undefined) objectValue[String(decodeRef(refs[refIndex]))] = decodeRef(valueRef);
        }
      }

      return objectValue;
    }

    return token;
  };

  return decodeRef(parsed[1]);
}

function textDataUri(mime: string, text: string) {
  return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
}

function textFromDataUri(dataUri = "") {
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex < 0) return "";

  const metadata = dataUri.slice(0, commaIndex);
  const payload = dataUri.slice(commaIndex + 1);
  if (metadata.includes(";base64")) return decodeURIComponent(escape(window.atob(payload)));
  return decodeURIComponent(payload);
}

function escapedJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function safePathSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "spine"
  );
}

function cleanRepoPath(value: string) {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

function joinRepoPath(...parts: string[]) {
  return parts.map(cleanRepoPath).filter(Boolean).join("/");
}

function encodeRepoPath(path: string) {
  return cleanRepoPath(path)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function dataUriToBase64(dataUri: string) {
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex < 0) return dataUri;

  const metadata = dataUri.slice(0, commaIndex);
  const payload = dataUri.slice(commaIndex + 1);
  return metadata.includes(";base64") ? payload : textToBase64(decodeURIComponent(payload));
}

function textToBase64(text: string) {
  return btoa(unescape(encodeURIComponent(text)));
}

function editEntryIdFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("edit") || "";
}

async function fileFromLibraryPath(entry: LibraryEntry, fileName: string) {
  const assetPath = joinRepoPath(entry.previewPath, fileName);
  const response = await fetch(`/assets/${encodeRepoPath(assetPath)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${fileName}`);
  return new File([await response.blob()], basename(fileName), { type: response.headers.get("Content-Type") || "" });
}

function zoomedViewport(viewport: PreparedSpine["viewport"], zoomValue: number) {
  if (!viewport) return undefined;

  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;
  const width = viewport.width / zoomValue;
  const height = viewport.height / zoomValue;

  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

type TouchCollection = {
  item(index: number): { clientX: number; clientY: number } | null;
};

function distanceBetweenTouches(touches: TouchCollection) {
  const firstTouch = touches.item(0);
  const secondTouch = touches.item(1);
  if (!firstTouch || !secondTouch) return 0;

  return Math.hypot(firstTouch.clientX - secondTouch.clientX, firstTouch.clientY - secondTouch.clientY);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function limitWords(value: string, maxWords = 20) {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}

function createImageThumbnail(dataUri: string, width = 360, height = 220) {
  return new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve("");
        return;
      }
      context.clearRect(0, 0, width, height);
      const scale = Math.min(width / image.width, height / image.height);
      const nextWidth = image.width * scale;
      const nextHeight = image.height * scale;
      context.drawImage(image, (width - nextWidth) / 2, (height - nextHeight) / 2, nextWidth, nextHeight);
      resolve(canvas.toDataURL("image/webp", 0.72));
    };
    image.onerror = () => resolve("");
    image.src = dataUri;
  });
}

function blobToDataUri(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve("");
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(blob);
  });
}

async function createAnimatedCanvasThumbnail(sourceCanvas?: HTMLCanvasElement | null, width = 220, height = 136) {
  if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return "";

  try {
    const { GIFEncoder, applyPalette, quantize } = await import("gifenc");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "";

    const gif = GIFEncoder({ initialCapacity: 256 * 1024 });
    const frameCount = 8;
    const frameDelay = 110;
    const scale = Math.min(width / sourceCanvas.width, height / sourceCanvas.height);
    const nextWidth = Math.max(1, Math.round(sourceCanvas.width * scale));
    const nextHeight = Math.max(1, Math.round(sourceCanvas.height * scale));
    const offsetX = Math.round((width - nextWidth) / 2);
    const offsetY = Math.round((height - nextHeight) / 2);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      await wait(frameIndex === 0 ? 80 : frameDelay);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#050607";
      context.fillRect(0, 0, width, height);
      context.drawImage(sourceCanvas, offsetX, offsetY, nextWidth, nextHeight);
      const rgba = context.getImageData(0, 0, width, height).data;
      const palette = quantize(rgba, 96, { format: "rgb444" });
      const index = applyPalette(rgba, palette, "rgb444");
      gif.writeFrame(index, width, height, { palette, delay: frameDelay, repeat: 0 });
    }

    gif.finish();
    const bytes = gif.bytes();
    const gifBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(gifBuffer).set(bytes);
    return blobToDataUri(new Blob([gifBuffer], { type: "image/gif" }));
  } catch {
    return "";
  }
}

function stripPackedPlaceholders(value: unknown) {
  if (!value || typeof value !== "object") return value;

  const skeleton = value as Record<string, unknown>;
  const bones = skeleton.bones;
  const rootBoneName =
    Array.isArray(bones) && bones[0] && typeof bones[0] === "object" && "name" in bones[0] && typeof bones[0].name === "string"
      ? bones[0].name
      : "root";

  if (Array.isArray(bones)) {
    skeleton.bones = bones.map((bone, index) => {
      if (bone && typeof bone === "object" && "name" in bone && bone.name === null) {
        return { name: `__placeholder_bone_${index}`, parent: rootBoneName };
      }

      return bone;
    });
  }

  const slots = skeleton.slots;
  if (Array.isArray(slots)) {
    skeleton.slots = slots.map((slot, index) => {
      if (slot && typeof slot === "object" && "name" in slot && slot.name === null) {
        return { name: `__placeholder_slot_${index}`, bone: rootBoneName };
      }

      return slot;
    });
  }

  for (const key of ["transform", "path", "physics"]) {
    const section = skeleton[key];
    if (Array.isArray(section)) {
      skeleton[key] = section.filter((item) => {
        return !(item && typeof item === "object" && "name" in item && item.name === null);
      });
    }
  }

  return skeleton;
}

async function loadFiles(files: File[]) {
  const usefulFiles = files.filter((file) => isSkeletonFile(file) || isAtlasFile(file) || isImageFile(file));

  if (usefulFiles.length < 3) {
    throw new Error("You need at least skeleton .json/.skel, .atlas, and texture .png/.webp/.jpg.");
  }

  const assets = await Promise.all(
    usefulFiles.map(async (file): Promise<LoadedAsset> => {
      const text = isAtlasFile(file) ? await readAtlasText(file) : extensionOf(file.name) === "json" ? await readAsText(file) : undefined;
      let dataUri = await readAsDataUri(file);
      const transparentizedImage = isImageFile(file) ? await readAsTransparentizedImageDataUri(file) : undefined;

      if (extensionOf(file.name) === "json" && text) {
        const decodedJson = stripPackedPlaceholders(decodePackedSkeletonJson(text));
        dataUri = textDataUri("application/json", JSON.stringify(decodedJson));
      }

      if (isAtlasFile(file) && text) {
        dataUri = textDataUri("text/plain", text);
      }

      return {
        file,
        dataUri,
        transparentizedDataUri: transparentizedImage?.dataUri,
        premultipliedTransparentizedDataUri: transparentizedImage?.premultipliedDataUri,
        hasBlackMatte: transparentizedImage?.hasBlackMatte,
        text,
      };
    }),
  );

  const skeletons = assets.filter((asset) => isSkeletonFile(asset.file));
  const atlases = assets.filter((asset) => isAtlasFile(asset.file));
  const images = assets.filter((asset) => isImageFile(asset.file));

  if (skeletons.length === 0 || atlases.length === 0 || images.length === 0) {
    throw new Error("The set must include a skeleton, atlas, and at least one texture image.");
  }

  const preparedSets = (
    await Promise.all(
      skeletons.map(async (skeleton): Promise<PreparedSpine | null> => {
      const skeletonStem = assetStem(skeleton.file.name);
      const atlas =
        atlases.find((candidate) => assetStem(candidate.file.name) === skeletonStem) ??
        (skeletons.length === 1 && atlases.length === 1 ? atlases[0] : undefined);

      if (!atlas) return null;

      const rawDataURIs: Record<string, string> = {};
      for (const asset of [skeleton, atlas]) {
        rawDataURIs[asset.file.name] = asset.dataUri;
        rawDataURIs[basename(asset.file.name)] = asset.dataUri;
      }

      const atlasPages = extractAtlasPages(atlas.text);
      const premultipliedAlpha = hasPremultipliedAlpha(atlas.text);
      let usesRebuiltStraightAlphaTexture = false;
      const skeletonJson =
        extensionOf(skeleton.file.name) === "json" ? stripPackedPlaceholders(decodePackedSkeletonJson(skeleton.text)) : null;
      const animationNames =
        skeletonJson && typeof skeletonJson === "object" && "animations" in skeletonJson
          ? Object.keys((skeletonJson as { animations?: Record<string, unknown> }).animations ?? {})
          : [];
      const defaultAnimation =
        animationNames.find((animationName) => animationName.toLowerCase() === "idle") ??
        animationNames.find((animationName) => animationName.toLowerCase().includes("idle")) ??
        animationNames.find((animationName) => !animationName.toLowerCase().startsWith("eyes")) ??
        animationNames[0];
      const skinNames =
        skeletonJson && typeof skeletonJson === "object" && "skins" in skeletonJson
          ? ((skeletonJson as { skins?: Array<{ name?: string }> }).skins ?? []).map((skin) => skin.name).filter(Boolean)
          : [];
      const defaultSkin = skinNames.find((skinName) => skinName !== "default") ?? skinNames[0];
      const skeletonBounds =
        skeletonJson && typeof skeletonJson === "object" && "skeleton" in skeletonJson
          ? (skeletonJson as { skeleton?: Partial<PreparedSpine["viewport"]> }).skeleton
          : undefined;
      const viewport =
        typeof skeletonBounds?.x === "number" &&
        typeof skeletonBounds.y === "number" &&
        typeof skeletonBounds.width === "number" &&
        typeof skeletonBounds.height === "number"
          ? {
              x: skeletonBounds.x,
              y: skeletonBounds.y,
              width: skeletonBounds.width,
              height: skeletonBounds.height,
            }
          : undefined;

      for (const pageName of atlasPages) {
        const pageBase = basename(pageName).toLowerCase();
        const matchedImage =
          images.find((imageAsset) => imageAsset.file.name.toLowerCase() === pageName.toLowerCase()) ??
          images.find((imageAsset) => basename(imageAsset.file.name).toLowerCase() === pageBase) ??
          images.find((imageAsset) => assetStem(imageAsset.file.name) === skeletonStem) ??
          (images.length === 1 ? images[0] : undefined);

        if (matchedImage) {
          if (!premultipliedAlpha && matchedImage.hasBlackMatte) usesRebuiltStraightAlphaTexture = true;
          const imageDataUri = premultipliedAlpha
            ? await transparentizeAtlasEffectRegions(matchedImage.dataUri, atlas.text, pageName)
            : matchedImage.transparentizedDataUri ?? matchedImage.dataUri;
          rawDataURIs[matchedImage.file.name] = imageDataUri;
          rawDataURIs[basename(matchedImage.file.name)] = imageDataUri;
          rawDataURIs[pageName] = imageDataUri;
          rawDataURIs[basename(pageName)] = imageDataUri;
        }
      }

      if (usesRebuiltStraightAlphaTexture && !premultipliedAlpha && atlas.text) {
        const fixedAtlasDataUri = textDataUri("text/plain", atlasTextWithPremultipliedAlpha(atlas.text, false));
        rawDataURIs[atlas.file.name] = fixedAtlasDataUri;
        rawDataURIs[basename(atlas.file.name)] = fixedAtlasDataUri;
      }

      return {
        label: skeletonStem,
        skeletonName: skeleton.file.name,
        atlasName: atlas.file.name,
      atlasPages,
      animations: animationNames,
      defaultAnimation,
        defaultSkin,
        premultipliedAlpha,
        viewport,
        rawDataURIs,
      };
      }),
    )
  )
    .filter((set): set is PreparedSpine => Boolean(set));

  if (preparedSets.length === 0) {
    throw new Error("Could not find matching skeleton + atlas pairs. Check file names.");
  }

  return preparedSets;
}

function chooseInitialSet(preparedSets: PreparedSpine[]) {
  return (
    preparedSets.find((set) => set.label.includes("clover")) ??
    preparedSets.find((set) => set.defaultAnimation?.toLowerCase() === "idle") ??
    preparedSets[0]
  );
}

function filesForLibrary(preparedSpine: PreparedSpine) {
  const fileMap = new Map<string, string>();
  const addFile = (name: string, dataUri?: string) => {
    if (!dataUri) return;
    fileMap.set(basename(name), dataUri);
  };

  addFile(preparedSpine.skeletonName, preparedSpine.rawDataURIs[preparedSpine.skeletonName] ?? preparedSpine.rawDataURIs[basename(preparedSpine.skeletonName)]);
  addFile(preparedSpine.atlasName, preparedSpine.rawDataURIs[preparedSpine.atlasName] ?? preparedSpine.rawDataURIs[basename(preparedSpine.atlasName)]);

  for (const pageName of preparedSpine.atlasPages) {
    addFile(pageName, preparedSpine.rawDataURIs[pageName] ?? preparedSpine.rawDataURIs[basename(pageName)]);
  }

  return Array.from(fileMap.entries()).map(([name, dataUri]) => ({ name, dataUri }));
}

function applySkeletonRenderSettings(preparedSpine: PreparedSpine, settings: SkeletonRenderSettings): PreparedSpine {
  const rawDataURIs = { ...preparedSpine.rawDataURIs };
  const atlasDataUri = rawDataURIs[preparedSpine.atlasName] ?? rawDataURIs[basename(preparedSpine.atlasName)];
  const skeletonDataUri = rawDataURIs[preparedSpine.skeletonName] ?? rawDataURIs[basename(preparedSpine.skeletonName)];

  if (atlasDataUri?.startsWith("data:")) {
    const atlasText = textFromDataUri(atlasDataUri);
    const nextAtlasDataUri = textDataUri("text/plain", atlasTextWithPremultipliedAlpha(atlasText, settings.pma));
    rawDataURIs[preparedSpine.atlasName] = nextAtlasDataUri;
    rawDataURIs[basename(preparedSpine.atlasName)] = nextAtlasDataUri;
  }

  if (settings.blend !== "original" && extensionOf(preparedSpine.skeletonName) === "json" && skeletonDataUri?.startsWith("data:")) {
    try {
      const skeleton = JSON.parse(textFromDataUri(skeletonDataUri)) as { slots?: Array<Record<string, unknown>> };
      if (Array.isArray(skeleton.slots)) {
        skeleton.slots = skeleton.slots.map((slot) => ({ ...slot, blend: settings.blend }));
        const nextSkeletonDataUri = textDataUri("application/json", JSON.stringify(skeleton));
        rawDataURIs[preparedSpine.skeletonName] = nextSkeletonDataUri;
        rawDataURIs[basename(preparedSpine.skeletonName)] = nextSkeletonDataUri;
      }
    } catch {
      return { ...preparedSpine, premultipliedAlpha: settings.pma, rawDataURIs };
    }
  }

  return {
    ...preparedSpine,
    premultipliedAlpha: settings.pma,
    rawDataURIs,
  };
}

function updateLoopButtonState(button: HTMLButtonElement, isLoopEnabled: boolean) {
  button.classList.toggle("is-on", isLoopEnabled);
  button.classList.toggle("is-off", !isLoopEnabled);
  button.title = isLoopEnabled ? "Loop on" : "Loop off";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(isLoopEnabled));
}

function setPlayerTrackLoop(player: SpinePlayerInstance | null, isLoopEnabled: boolean) {
  const trackEntry = (player as PlayerWithLoopControls | null)?.animationState?.getCurrent?.(0);
  if (trackEntry) trackEntry.loop = isLoopEnabled;
}

function disablePlayerMix(player: SpinePlayerInstance | null) {
  const animationStateData = (player as PlayerWithLoopControls | null)?.animationState?.data;
  if (animationStateData) animationStateData.defaultMix = 0;
}

function playAnimationWithLoopMode(player: SpinePlayerInstance | null, animationName: string, isLoopEnabled: boolean, isLoopEnabledNow: () => boolean) {
  if (!player || !animationName) return;

  disablePlayerMix(player);
  const trackEntry = player.setAnimation(animationName, isLoopEnabled);
  (trackEntry as { mixDuration?: number; mixTime?: number }).mixDuration = 0;
  (trackEntry as { mixDuration?: number; mixTime?: number }).mixTime = 0;
  trackEntry.listener = {
    ...trackEntry.listener,
    complete: () => {
      if (!isLoopEnabledNow()) player.pause();
    },
  };
  player.play();
}

function syncLoopButtons(player: SpinePlayerInstance | null, isLoopEnabled: boolean) {
  const buttons = (player as PlayerWithLoopControls | null)?.dom?.querySelectorAll<HTMLButtonElement>(".spine-link-loop-button");
  buttons?.forEach((button) => updateLoopButtonState(button, isLoopEnabled));
}

function installLoopButton(player: SpinePlayerInstance, isLoopEnabled: boolean, onToggle: () => void, onPlayButton: () => void) {
  const playerDom = (player as PlayerWithLoopControls).dom;
  const buttons = playerDom?.querySelector(".spine-player-buttons");
  const playButton = buttons?.querySelector(".spine-player-button");
  if (!buttons || !playButton) return;

  (playButton as HTMLButtonElement).onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const typedPlayer = player as PlayerWithLoopControls;
    if (typedPlayer.paused === false) {
      player.pause();
      return;
    }
    onPlayButton();
  };

  if (buttons.querySelector(".spine-link-loop-button")) return;

  const loopButton = document.createElement("button");
  loopButton.type = "button";
  loopButton.className = "spine-player-button spine-link-loop-button";
  updateLoopButtonState(loopButton, isLoopEnabled);
  loopButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });
  playButton.insertAdjacentElement("afterend", loopButton);
}

function togglePlayerPlayback(player: SpinePlayerInstance | null, onPlayButton: () => void) {
  const typedPlayer = player as PlayerWithLoopControls | null;
  if (!typedPlayer) return;
  if (typedPlayer.paused === false) {
    typedPlayer.pause();
    return;
  }
  onPlayButton();
}

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const colors = ["255,255,255", "140,199,255", "255,106,40"];
    const particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let animationFrame = 0;

    const resetParticle = (particle: Particle, randomizePosition = false) => {
      particle.x = Math.random() * width;
      particle.y = randomizePosition ? Math.random() * height : height + Math.random() * 80;
      particle.radius = 0.55 + Math.random() * 1.8;
      particle.speedX = (Math.random() - 0.5) * 0.16;
      particle.speedY = -(0.08 + Math.random() * 0.34);
      particle.alpha = 0.18 + Math.random() * 0.64;
      particle.pulse = Math.random() * Math.PI * 2;
      particle.color = colors[Math.floor(Math.random() * colors.length)];
    };

    const resize = () => {
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const targetCount = Math.min(170, Math.max(72, Math.floor((width * height) / 9000)));
      while (particles.length < targetCount) {
        const particle = {} as Particle;
        resetParticle(particle, true);
        particles.push(particle);
      }
      particles.length = targetCount;
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);

      for (const particle of particles) {
        particle.x += particle.speedX + Math.sin(time * 0.00025 + particle.pulse) * 0.035;
        particle.y += particle.speedY;

        if (particle.y < -24 || particle.x < -32 || particle.x > width + 32) {
          resetParticle(particle);
        }

        const alpha = particle.alpha * (0.68 + Math.sin(time * 0.0012 + particle.pulse) * 0.32);
        const glowRadius = particle.radius * 5.5;
        const gradient = context.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, glowRadius);
        gradient.addColorStop(0, `rgba(${particle.color}, ${alpha})`);
        gradient.addColorStop(0.42, `rgba(${particle.color}, ${alpha * 0.24})`);
        gradient.addColorStop(1, `rgba(${particle.color}, 0)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(particle.x, particle.y, glowRadius, 0, Math.PI * 2);
        context.fill();
      }

      animationFrame = window.requestAnimationFrame(draw);
    };

    resize();
    animationFrame = window.requestAnimationFrame(draw);
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas className="particle-field" ref={canvasRef} aria-hidden="true" />;
}

export function App({ initialFiles }: AppProps) {
  const playerRef = useRef<SpinePlayerInstance | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const googleTokenClientRef = useRef<GoogleTokenClient | null>(null);
  const baseViewportRef = useRef<PlayerViewport | null>(null);
  const pinchDistanceRef = useRef<number | null>(null);
  const panPositionRef = useRef<{ x: number; y: number } | null>(null);
  const publishedKeysRef = useRef<Set<string>>(new Set());
  const isPublishingRef = useRef(false);
  const zoomRef = useRef(1);
  const loopEnabledRef = useRef(true);
  const activeAnimationRef = useRef("");
  const animationsRef = useRef<string[]>([]);
  const preparedSpineRef = useRef<PreparedSpine | null>(null);
  const [spineOptions, setSpineOptions] = useState<PreparedSpine[]>([]);
  const [preparedSpine, setPreparedSpine] = useState<PreparedSpine | null>(null);
  const [animations, setAnimations] = useState<string[]>([]);
  const [activeAnimation, setActiveAnimation] = useState("");
  const [zoom, setZoom] = useState(1);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [anonymousAccount] = useState<AnonymousAccount>(() => getStoredAnonymousAccount());
  const [activeTreeDrawer, setActiveTreeDrawer] = useState<"render" | "zoom" | null>(null);
  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState("");
  const [isPublishingLink, setIsPublishingLink] = useState(false);
  const [isLinkBannerOpen, setIsLinkBannerOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [previewNote, setPreviewNote] = useState("");
  const [previewNoteStatus, setPreviewNoteStatus] = useState("");
  const [currentLibraryEntry, setCurrentLibraryEntry] = useState<LibraryEntry | null>(null);
  const [status, setStatus] = useState("Drop three Spine files here: json, atlas, and texture.");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isIntroDocking, setIsIntroDocking] = useState(false);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(() => readStoredGoogleSession()?.user ?? null);
  const [googleIdToken, setGoogleIdToken] = useState(() => getValidStoredGoogleToken());
  const [googleAuthError, setGoogleAuthError] = useState("");
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [showProfileOnSharedPages, setShowProfileOnSharedPages] = useState(() => readStoredProfileVisibility());
  const [profileVisibilityStatus, setProfileVisibilityStatus] = useState("");
  const [renderSettingsByLabel, setRenderSettingsByLabel] = useState<Record<string, SkeletonRenderSettings>>({});
  const publicLibraryUrl = useMemo(
    () => new URL(`/u/${encodeURIComponent(publicOwnerIdFor(googleUser, anonymousAccount))}`, window.location.origin).toString(),
    [anonymousAccount, googleUser],
  );

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    loopEnabledRef.current = loopEnabled;
    setPlayerTrackLoop(playerRef.current, loopEnabled);
    syncLoopButtons(playerRef.current, loopEnabled);
  }, [loopEnabled]);

  useEffect(() => {
    activeAnimationRef.current = activeAnimation;
  }, [activeAnimation]);

  useEffect(() => {
    animationsRef.current = animations;
  }, [animations]);

  useEffect(() => {
    preparedSpineRef.current = preparedSpine;
  }, [preparedSpine]);

  useEffect(() => {
    if (!googleClientId) {
      setGoogleAuthError("Google OAuth Client ID is not configured.");
    }
  }, []);

  const fileSummary = useMemo(() => {
    if (!preparedSpine) return "No files selected yet";
    const pages = preparedSpine.atlasPages.length ? preparedSpine.atlasPages.join(", ") : "atlas pages are not specified";
    return `${preparedSpine.skeletonName} + ${preparedSpine.atlasName} + ${pages}`;
  }, [preparedSpine]);

  const activeRenderSettings = useMemo<SkeletonRenderSettings>(
    () => ({
      pma: renderSettingsByLabel[preparedSpine?.label ?? ""]?.pma ?? preparedSpine?.premultipliedAlpha ?? false,
      blend: renderSettingsByLabel[preparedSpine?.label ?? ""]?.blend ?? "original",
    }),
    [preparedSpine, renderSettingsByLabel],
  );
  const shouldShowStatus = isLoading || Boolean(error) || !preparedSpine || /failed|error|stopped/i.test(status);

  const configuredSpine = useMemo(
    () => (preparedSpine ? applySkeletonRenderSettings(preparedSpine, activeRenderSettings) : null),
    [activeRenderSettings, preparedSpine],
  );

  const updateActiveRenderSettings = (nextSettings: Partial<SkeletonRenderSettings>) => {
    if (!preparedSpine) return;
    setRenderSettingsByLabel((currentSettings) => ({
      ...currentSettings,
      [preparedSpine.label]: {
        pma: currentSettings[preparedSpine.label]?.pma ?? preparedSpine.premultipliedAlpha ?? false,
        blend: currentSettings[preparedSpine.label]?.blend ?? "original",
        ...nextSettings,
      },
    }));
  };

  const resetPlayer = useCallback(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    baseViewportRef.current = null;
    if (playerHostRef.current) playerHostRef.current.innerHTML = "";
  }, []);

  const toggleLoopEnabled = useCallback(() => {
    setLoopEnabled((currentLoopEnabled) => {
      const nextLoopEnabled = !currentLoopEnabled;
      loopEnabledRef.current = nextLoopEnabled;
      setPlayerTrackLoop(playerRef.current, nextLoopEnabled);
      syncLoopButtons(playerRef.current, nextLoopEnabled);
      return nextLoopEnabled;
    });
  }, []);

  const playActiveAnimationFromStart = useCallback(() => {
    const animationName = activeAnimationRef.current || preparedSpineRef.current?.defaultAnimation || animationsRef.current[0] || "";
    playAnimationWithLoopMode(playerRef.current, animationName, loopEnabledRef.current, () => loopEnabledRef.current);
    if (animationName) setActiveAnimation(animationName);
  }, []);

  const togglePreviewPlayback = useCallback(() => {
    togglePlayerPlayback(playerRef.current, playActiveAnimationFromStart);
  }, [playActiveAnimationFromStart]);

  const applyZoomToPlayer = useCallback((nextZoom: number, animate = true) => {
    const player = playerRef.current as unknown as PlayerWithViewport | null;
    const baseViewport = baseViewportRef.current;

    if (!player?.currentViewport || !baseViewport) return;

    const centerX = baseViewport.x + baseViewport.width / 2;
    const centerY = baseViewport.y + baseViewport.height / 2;
    const width = baseViewport.width / nextZoom;
    const height = baseViewport.height / nextZoom;

    const nextViewport = {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      padLeft: baseViewport.padLeft / nextZoom,
      padRight: baseViewport.padRight / nextZoom,
      padTop: baseViewport.padTop / nextZoom,
      padBottom: baseViewport.padBottom / nextZoom,
    };

    player.previousViewport = animate ? player.currentViewport : { ...nextViewport };
    player.currentViewport = nextViewport;
    player.viewportTransitionStart = performance.now();
  }, []);

  const rememberCurrentViewport = useCallback(() => {
    const player = playerRef.current as unknown as PlayerWithViewport | null;
    if (!player?.currentViewport) return;

    baseViewportRef.current = { ...player.currentViewport };
  }, []);

  const panPlayerByPixels = useCallback((deltaX: number, deltaY: number) => {
    const player = playerRef.current as unknown as (PlayerWithViewport & { canvas?: HTMLCanvasElement | null }) | null;
    const baseViewport = baseViewportRef.current;
    const currentViewport = player?.currentViewport;
    const canvas = player?.canvas;
    if (!currentViewport || !baseViewport || !canvas) return;

    const totalWidth = currentViewport.width + currentViewport.padLeft + currentViewport.padRight;
    const totalHeight = currentViewport.height + currentViewport.padTop + currentViewport.padBottom;
    const worldDeltaX = (deltaX / Math.max(1, canvas.clientWidth)) * totalWidth;
    const worldDeltaY = (deltaY / Math.max(1, canvas.clientHeight)) * totalHeight;
    const baseScale = zoomRef.current;

    currentViewport.x -= worldDeltaX;
    currentViewport.y += worldDeltaY;
    baseViewport.x -= worldDeltaX * baseScale;
    baseViewport.y += worldDeltaY * baseScale;
    player.previousViewport = { ...currentViewport };
    player.viewportTransitionStart = performance.now();
  }, []);

  const prepareFromFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const shouldDockIntro = !preparedSpine;
      setIsIntroDocking(shouldDockIntro);
      setIsLoading(true);
      setError("");
      setStatus("Reading files locally...");

      try {
        const nextSpineOptions = await loadFiles(Array.from(fileList));
        if (shouldDockIntro) await wait(650);
        resetPlayer();
        setAnimations([]);
        setActiveAnimation("");
        setZoom(1);
        setGeneratedPreviewUrl("");
        setIsPublishingLink(false);
        setIsLinkBannerOpen(false);
        setCopyStatus("");
        setPreviewNoteStatus("");
        setCurrentLibraryEntry(null);
        publishedKeysRef.current.clear();
        setSpineOptions(nextSpineOptions);
        setPreparedSpine(chooseInitialSet(nextSpineOptions));
        setStatus(nextSpineOptions.length > 1 ? `Sets found: ${nextSpineOptions.length}. Starting preview...` : "Files ready. Starting preview...");
      } catch (nextError) {
        setSpineOptions([]);
        setPreparedSpine(null);
        setAnimations([]);
        setActiveAnimation("");
        setGeneratedPreviewUrl("");
        setIsPublishingLink(false);
        setIsLinkBannerOpen(false);
        setCopyStatus("");
        setPreviewNoteStatus("");
        setCurrentLibraryEntry(null);
        setError(nextError instanceof Error ? nextError.message : "Could not prepare Spine files.");
        setStatus("Upload stopped.");
      } finally {
        setIsIntroDocking(false);
        setIsLoading(false);
      }
    },
    [preparedSpine, resetPlayer],
  );

  const initialFilesLoadedRef = useRef(false);
  const editEntryLoadedRef = useRef(false);

  useEffect(() => {
    if (initialFilesLoadedRef.current || !initialFiles?.length) return;
    initialFilesLoadedRef.current = true;
    void prepareFromFiles(initialFiles);
  }, [initialFiles, prepareFromFiles]);

  useEffect(() => {
    const editEntryId = editEntryIdFromLocation();
    if (editEntryLoadedRef.current || !editEntryId) return;
    editEntryLoadedRef.current = true;

    let isCancelled = false;
    const loadEditableEntry = async () => {
      setIsLoading(true);
      setError("");
      setStatus("Loading editable preview...");
      try {
        const requestHeaders: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;
        const response = await fetch("/api/github-upload", {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({
            action: "get-index",
            googleIdToken,
            anonymousAccount,
            settings: githubPublishSettings,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
        const entry = (Array.isArray(result.entries) ? result.entries : []).find(
          (candidate: LibraryEntry) => candidate.id === editEntryId,
        ) as LibraryEntry | undefined;
        if (!entry) throw new Error("This preview is not in your editable library.");
        const entryFiles = Array.isArray(entry.files) ? entry.files : [];
        const files = await Promise.all(entryFiles.map((fileName) => fileFromLibraryPath(entry, fileName)));
        const nextSpineOptions = (await loadFiles(files)).map((set) => {
          const isEntrySet = basename(set.skeletonName) === basename(entry.skeleton);
          return isEntrySet && entry.defaultAnimation ? { ...set, defaultAnimation: entry.defaultAnimation } : set;
        });
        if (isCancelled) return;
        const nextSpine =
          nextSpineOptions.find((set) => basename(set.skeletonName) === basename(entry.skeleton)) ?? chooseInitialSet(nextSpineOptions);
        resetPlayer();
        setAnimations([]);
        setActiveAnimation(entry.defaultAnimation || nextSpine?.defaultAnimation || "");
        setZoom(1);
        setSpineOptions(nextSpineOptions);
        setPreparedSpine(nextSpine);
        setCurrentLibraryEntry(entry);
        setLibraryEntries((currentEntries) => [entry, ...currentEntries.filter((currentEntry) => currentEntry.id !== entry.id)]);
        setPreviewNote(entry.note || "");
        setGeneratedPreviewUrl(new URL(`/p/${encodeURIComponent(entry.id)}`, window.location.origin).toString());
        setIsLinkBannerOpen(false);
        setCopyStatus("");
        setPreviewNoteStatus("");
        publishedKeysRef.current.clear();
        setStatus(`Editing "${entry.title || entry.id}". Choose an animation and save.`);
      } catch (nextError) {
        if (isCancelled) return;
        setError(nextError instanceof Error ? nextError.message : "Could not load editable preview.");
        setStatus("Edit stopped.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void loadEditableEntry();
    return () => {
      isCancelled = true;
    };
  }, [anonymousAccount, googleIdToken, resetPlayer]);

  useEffect(() => {
    if (!configuredSpine || !playerHostRef.current) return;

    let isCancelled = false;
    resetPlayer();
    const config: SpinePlayerConfig = {
      skeleton: configuredSpine.skeletonName,
      atlas: configuredSpine.atlasName,
      rawDataURIs: configuredSpine.rawDataURIs,
      animation: configuredSpine.defaultAnimation,
      skin: configuredSpine.defaultSkin,
      premultipliedAlpha: configuredSpine.premultipliedAlpha,
      showControls: true,
      showLoading: true,
      alpha: true,
      preserveDrawingBuffer: true,
      backgroundColor: "00000000",
      viewport: {
        ...configuredSpine.viewport,
        padLeft: "14%",
        padRight: "14%",
        padTop: "14%",
        padBottom: "14%",
      },
      success: (player) => {
        const names = player.skeleton?.data.animations.map((animation) => animation.name) ?? [];
        const initialAnimation = configuredSpine.defaultAnimation && names.includes(configuredSpine.defaultAnimation) ? configuredSpine.defaultAnimation : names[0];
        setAnimations(names);
        setActiveAnimation(initialAnimation ?? "");
        if (initialAnimation) {
          disablePlayerMix(player);
          playAnimationWithLoopMode(player, initialAnimation, loopEnabledRef.current, () => loopEnabledRef.current);
          installLoopButton(player, loopEnabledRef.current, toggleLoopEnabled, playActiveAnimationFromStart);
          rememberCurrentViewport();
          applyZoomToPlayer(zoomRef.current, false);
          void publishToGitHub(configuredSpine, names, initialAnimation);
        }
        setStatus(
          names.length
            ? `Ready. Animations found: ${names.length}. Creating permanent link...`
            : "Ready, but the animation list is empty.",
        );
      },
      error: (_player, message) => {
        setError(message || "Spine runtime could not open these files.");
        setStatus("Preview error.");
      },
    };

    void loadSpinePlayerModule()
      .then(({ SpinePlayer }) => {
        if (isCancelled || !playerHostRef.current) return;
        playerRef.current = new SpinePlayer(playerHostRef.current, config);
      })
      .catch(() => {
        if (isCancelled) return;
        setError("Spine runtime could not be loaded.");
        setStatus("Preview error.");
      });

    return () => {
      isCancelled = true;
      resetPlayer();
    };
  }, [applyZoomToPlayer, configuredSpine, googleIdToken, googleUser, playActiveAnimationFromStart, rememberCurrentViewport, resetPlayer, toggleLoopEnabled]);

  useEffect(() => {
    applyZoomToPlayer(zoom);
  }, [applyZoomToPlayer, zoom]);

  const selectAnimation = (animationName: string) => {
    setActiveAnimation(animationName);
    playAnimationWithLoopMode(playerRef.current, animationName, loopEnabledRef.current, () => loopEnabledRef.current);
    applyZoomToPlayer(zoomRef.current, false);
    if (!generatedPreviewUrl && preparedSpine && animations.length) {
      void publishToGitHub(preparedSpine, animations, animationName);
    }
  };

  const changeZoom = useCallback((nextZoom: number) => {
    const clampedZoom = Math.min(4, Math.max(0.25, nextZoom));
    zoomRef.current = clampedZoom;
    setZoom(clampedZoom);
  }, []);

  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;

    const handleWheel = (event: WheelEvent) => {
      if (!preparedSpine) return;

      event.preventDefault();
      const zoomDirection = event.deltaY > 0 ? -1 : 1;
      const zoomStep = event.ctrlKey || event.metaKey ? 0.18 : 0.1;
      changeZoom(zoomRef.current + zoomDirection * zoomStep);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinchDistanceRef.current = distanceBetweenTouches(event.touches);
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!preparedSpine || event.touches.length !== 2 || pinchDistanceRef.current === null) return;

      event.preventDefault();
      const nextDistance = distanceBetweenTouches(event.touches);
      const zoomDelta = (nextDistance - pinchDistanceRef.current) / 220;
      pinchDistanceRef.current = nextDistance;
      changeZoom(zoomRef.current + zoomDelta);
    };

    const handleTouchEnd = () => {
      pinchDistanceRef.current = null;
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!preparedSpine) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (!preparedSpine) return;
      if (!preparedSpine || event.button !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      panPositionRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePreviewClick = (event: MouseEvent) => {
      if (!preparedSpine || (event.target as Element | null)?.closest(".spine-player-controls, .link-ready-banner")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "click" && event.button === 0) togglePreviewPlayback();
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!panPositionRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const deltaX = event.clientX - panPositionRef.current.x;
      const deltaY = event.clientY - panPositionRef.current.y;
      panPositionRef.current = { x: event.clientX, y: event.clientY };
      panPlayerByPixels(deltaX, deltaY);
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      panPositionRef.current = null;
    };

    panel.addEventListener("wheel", handleWheel, { passive: false });
    panel.addEventListener("contextmenu", handleContextMenu, true);
    panel.addEventListener("mousedown", handleMouseDown, true);
    panel.addEventListener("click", handlePreviewClick, true);
    panel.addEventListener("dblclick", handlePreviewClick, true);
    window.addEventListener("mousemove", handleMouseMove, { passive: false, capture: true });
    window.addEventListener("mouseup", handleMouseUp, true);
    panel.addEventListener("touchstart", handleTouchStart, { passive: false });
    panel.addEventListener("touchmove", handleTouchMove, { passive: false });
    panel.addEventListener("touchend", handleTouchEnd);
    panel.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      panel.removeEventListener("wheel", handleWheel);
      panel.removeEventListener("contextmenu", handleContextMenu, true);
      panel.removeEventListener("mousedown", handleMouseDown, true);
      panel.removeEventListener("click", handlePreviewClick, true);
      panel.removeEventListener("dblclick", handlePreviewClick, true);
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
      panel.removeEventListener("touchstart", handleTouchStart);
      panel.removeEventListener("touchmove", handleTouchMove);
      panel.removeEventListener("touchend", handleTouchEnd);
      panel.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [changeZoom, panPlayerByPixels, preparedSpine, togglePreviewPlayback]);

  const selectSpineSet = (label: string) => {
    const nextSpine = spineOptions.find((option) => option.label === label);
    if (!nextSpine) return;

    resetPlayer();
    setAnimations([]);
    setActiveAnimation("");
    setZoom(1);
    setPreparedSpine(nextSpine);
    setStatus("Switching Spine set...");
  };

  const copyGeneratedLink = async () => {
    if (!generatedPreviewUrl) return;

    try {
      await navigator.clipboard.writeText(generatedPreviewUrl);
      setCopyStatus("Link copied");
    } catch {
      setCopyStatus("Open the link with the button nearby");
    }
  };

  const copyPublicLibraryLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLibraryUrl);
      setProfileVisibilityStatus("Public library link copied");
    } catch {
      setProfileVisibilityStatus(publicLibraryUrl);
    }
  };

  const shareGeneratedLink = async () => {
    if (!generatedPreviewUrl) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: currentLibraryEntry?.title || "Spine-Link preview",
          text: "Spine animation preview",
          url: generatedPreviewUrl,
        });
        setCopyStatus("Link shared");
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      }
    }

    await copyGeneratedLink();
  };

  const savePreviewNote = async (nextNote = previewNote) => {
    if (!currentLibraryEntry) {
      setPreviewNoteStatus("Upload files first, then save text.");
      return;
    }

    const limitedNote = limitWords(nextNote);
    setPreviewNote(limitedNote);
    setPreviewNoteStatus("Saving...");

    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;
      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          action: "update-note",
          googleIdToken,
          anonymousAccount,
          settings: githubPublishSettings,
          entryId: currentLibraryEntry.id,
          note: limitedNote,
          commitPrefix: `Update Spine preview ${currentLibraryEntry.title}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      }
      const nextEntry = { ...currentLibraryEntry, note: limitedNote || undefined };
      setCurrentLibraryEntry(nextEntry);
      setLibraryEntries((currentEntries) => currentEntries.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry)));
      setPreviewNoteStatus(limitedNote ? "Text saved" : "Text deleted");
    } catch (nextError) {
      setPreviewNoteStatus(nextError instanceof Error ? nextError.message : "Could not save text.");
    }
  };

  const deletePreviewNote = () => {
    void savePreviewNote("");
  };

  const copyLibraryEntryLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setLibraryError("");
      setProfileVisibilityStatus("Preview link copied");
    } catch {
      setProfileVisibilityStatus(url);
    }
  };

  const updateLibraryEntryVisibility = async (entry: LibraryEntry, hiddenFromPublicLibrary: boolean) => {
    setLibraryError("");
    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;
      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          action: "update-entry-visibility",
          googleIdToken,
          anonymousAccount,
          settings: githubPublishSettings,
          entryId: entry.id,
          hiddenFromPublicLibrary,
          commitPrefix: `${hiddenFromPublicLibrary ? "Hide" : "Show"} Spine preview ${entry.title || entry.id}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      const nextEntry = { ...entry, hiddenFromPublicLibrary };
      setLibraryEntries((currentEntries) => currentEntries.map((currentEntry) => (currentEntry.id === entry.id ? nextEntry : currentEntry)));
      if (currentLibraryEntry?.id === entry.id) setCurrentLibraryEntry(nextEntry);
      setProfileVisibilityStatus(hiddenFromPublicLibrary ? "Preview hidden from public library" : "Preview visible in public library");
    } catch (nextError) {
      setLibraryError(nextError instanceof Error ? nextError.message : "Could not update preview visibility.");
    }
  };

  const deleteLibraryEntry = async (entry: LibraryEntry) => {
    if (!window.confirm(`Delete "${entry.title || entry.id}" from library?`)) return;
    setLibraryError("");
    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;
      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          action: "delete-entry",
          googleIdToken,
          anonymousAccount,
          settings: githubPublishSettings,
          entryId: entry.id,
          commitPrefix: `Delete Spine preview ${entry.title || entry.id}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      setLibraryEntries((currentEntries) => currentEntries.filter((currentEntry) => currentEntry.id !== entry.id));
      if (currentLibraryEntry?.id === entry.id) {
        setCurrentLibraryEntry(null);
        setGeneratedPreviewUrl("");
        setIsLinkBannerOpen(false);
        setPreviewNote("");
      }
    } catch (nextError) {
      setLibraryError(nextError instanceof Error ? nextError.message : "Could not delete library entry.");
    }
  };

  const signOutGoogle = () => {
    window.google?.accounts.id.disableAutoSelect();
    clearStoredGoogleSession();
    setGoogleUser(null);
    setGoogleIdToken("");
    setGoogleAuthError("");
    setIsLibraryOpen(false);
    setLibraryEntries([]);
    setLibraryError("");
    setStatus("Browser library is active. Google can merge it later.");
  };

  async function mergeAnonymousLibrary(accessToken: string, user: GoogleUser) {
    try {
      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "merge-anonymous-account",
          googleIdToken: accessToken,
          anonymousAccount,
          settings: githubPublishSettings,
          commitPrefix: `Merge Spine-Link library ${user.email}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      }
      setLibraryEntries(Array.isArray(result.entries) ? result.entries : []);
    } catch (nextError) {
      setGoogleAuthError(nextError instanceof Error ? nextError.message : "Could not merge browser library.");
    }
  }

  const loadLibrary = useCallback(async () => {
    setIsLibraryLoading(true);
    setLibraryError("");

    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;

      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          action: "get-index",
          googleIdToken,
          anonymousAccount,
          settings: githubPublishSettings,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      }

      setLibraryEntries(Array.isArray(result.entries) ? result.entries : []);
    } catch (nextError) {
      setLibraryError(nextError instanceof Error ? nextError.message : "Could not load library.");
    } finally {
      setIsLibraryLoading(false);
    }
  }, [anonymousAccount, googleIdToken]);

  const openLibrary = () => {
    setIsLibraryOpen(true);
    void loadLibrary();
  };

  const startNewLibraryEntry = () => {
    setIsLibraryOpen(false);
    setCurrentLibraryEntry(null);
    setGeneratedPreviewUrl("");
    setIsLinkBannerOpen(false);
    setCopyStatus("");
    setPreviewNote("");
    setPreviewNoteStatus("");
    setError("");
    setStatus("Choose files for a new library card.");
    publishedKeysRef.current.clear();
    window.setTimeout(() => uploadInputRef.current?.click(), 0);
  };

  const updateSharedProfileVisibility = async (nextValue: boolean) => {
    setShowProfileOnSharedPages(nextValue);
    storeProfileVisibility(nextValue);
    setProfileVisibilityStatus("Saving...");

    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;

      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          action: "update-profile-visibility",
          googleIdToken,
          anonymousAccount,
          settings: githubPublishSettings,
          showOwnerLibrary: nextValue,
          ownerName: googleUser?.name,
          ownerPicture: googleUser?.picture,
          publicOwnerId: publicOwnerIdFor(googleUser, anonymousAccount),
          commitPrefix: "Update Spine-Link public profile setting",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      }
      setLibraryEntries(Array.isArray(result.entries) ? result.entries : []);
      setProfileVisibilityStatus(nextValue ? "Your name is visible" : "Your name is hidden");
    } catch (nextError) {
      setProfileVisibilityStatus(nextError instanceof Error ? nextError.message : "Could not save profile setting.");
    }
  };

  const ensureGoogleAuth = async () => {
    if (!googleClientId) {
      setGoogleAuthError("Google OAuth Client ID is not configured.");
      return false;
    }

    try {
      await loadGoogleIdentityScript();
    } catch {
      setGoogleAuthError("Could not load Google sign-in.");
      return false;
    }

    if (!window.google) {
      setGoogleAuthError("Could not load Google sign-in.");
      return false;
    }

    if (!googleTokenClientRef.current) {
      googleTokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: "openid email profile",
        callback: async (response) => {
          if (response.error || !response.access_token) {
            if (googleUser || readStoredGoogleSession()?.user?.email) {
              setGoogleIdToken("");
              return;
            }
            setGoogleAuthError(response.error || "Google sign-in failed.");
            return;
          }

          try {
            const userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${response.access_token}` },
            });
            const payload = (await userResponse.json()) as { email?: string; name?: string; picture?: string; email_verified?: boolean };
            const email = payload.email ?? "";
            if (!userResponse.ok || !payload.email_verified || !email) {
              setGoogleUser(null);
              setGoogleIdToken("");
              clearStoredGoogleSession();
              setGoogleAuthError("Google email is not verified.");
              return;
            }

            const nextGoogleUser = { email, name: payload.name, picture: payload.picture };
            setGoogleUser(nextGoogleUser);
            setGoogleIdToken(response.access_token);
            storeGoogleSession(nextGoogleUser, response.access_token, response.expires_in);
            setGoogleAuthError("");
            setStatus("Signed in. Library account merged.");
            void mergeAnonymousLibrary(response.access_token, nextGoogleUser);
          } catch {
            setGoogleAuthError("Could not read Google profile.");
          }
        },
      });
    }

    return true;
  };

  const openGoogleSignIn = async () => {
    const isReady = await ensureGoogleAuth();
    if (!isReady || !googleTokenClientRef.current) return;

    setGoogleAuthError("");
    googleTokenClientRef.current.requestAccessToken({ prompt: "select_account" });
  };

  async function publishToGitHub(spine: PreparedSpine, animationNames: string[], defaultAnimation: string) {
      const existingEntry = currentLibraryEntry;
      const nextSettings = {
        ...githubPublishSettings,
        owner: githubPublishSettings.owner.trim(),
        repo: githubPublishSettings.repo.trim(),
        branch: githubPublishSettings.branch.trim() || "main",
        basePath: cleanRepoPath(githubPublishSettings.basePath || "library"),
        title: existingEntry?.title || githubPublishSettings.title.trim() || spine.label,
      };

      if (!nextSettings.owner || !nextSettings.repo || isPublishingRef.current) return;

      const isEditingEntry = Boolean(existingEntry?.id);
      const publishKey = `${existingEntry?.id || spine.label}:${spine.skeletonName}:${spine.atlasName}:${defaultAnimation}`;
      if (!isEditingEntry && publishedKeysRef.current.has(publishKey)) return;

      isPublishingRef.current = true;
      setIsPublishingLink(true);
      publishedKeysRef.current.add(publishKey);

      try {
        const uploadedAt = new Date().toISOString();
        const uploadId = existingEntry?.id || `${safePathSegment(nextSettings.title)}-${uploadedAt.replace(/[:.]/g, "-")}`;
        const uploadPath = cleanRepoPath(existingEntry?.previewPath || joinRepoPath(nextSettings.basePath, uploadId));
        const permanentPreviewUrl = new URL(`/p/${encodeURIComponent(uploadId)}`, window.location.origin).toString();
        const setsForPublish = spineOptions.length ? spineOptions : [spine];
        const note = limitWords(previewNote);
        const playerCanvas = (playerRef.current as unknown as { canvas?: HTMLCanvasElement | null } | null)?.canvas;
        const animatedThumbnail = await createAnimatedCanvasThumbnail(playerCanvas);
        const thumbnailSourceName = spine.atlasPages[0] ? basename(spine.atlasPages[0]) : "";
        const thumbnailSource = thumbnailSourceName
          ? spine.rawDataURIs[thumbnailSourceName] ?? spine.rawDataURIs[spine.atlasPages[0]]
          : "";
        const fallbackThumbnail = thumbnailSource?.startsWith("data:image/") ? await createImageThumbnail(thumbnailSource) : "";
        const thumbnail = animatedThumbnail || fallbackThumbnail;
        const thumbnailType = animatedThumbnail ? "gif" : thumbnail ? "image" : undefined;
        const fileMap = new Map<string, string>();
        for (const nextSpine of setsForPublish) {
          for (const file of filesForLibrary(nextSpine)) {
            fileMap.set(`${nextSpine.label}/${file.name}`, file.dataUri);
          }
        }
        const files = Array.from(fileMap.entries()).map(([name, dataUri]) => ({ name, contentBase64: dataUriToBase64(dataUri) }));
        const commitPrefix = `${isEditingEntry ? "Update" : "Add"} Spine preview ${nextSettings.title}`;

        if (files.length < 3) {
          throw new Error("Could not collect skeleton, atlas, and texture for publishing.");
        }

        setStatus(`Files ready. Uploading: 0/${files.length}...`);

        for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
          const file = files[fileIndex];
          const filePath = joinRepoPath(uploadPath, file.name);
          const requestHeaders: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;
          const response = await fetch("/api/github-upload", {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify({
              action: "put-file",
              googleIdToken,
              anonymousAccount,
              settings: nextSettings,
              file: {
                path: filePath,
                contentBase64: file.contentBase64,
              },
              message: `${commitPrefix}: ${file.name}`,
            }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(typeof result?.error === "string" ? result.error : `Upload API ${response.status}`);
          }
          setStatus(`Files ready. Uploading: ${fileIndex + 1}/${files.length}...`);
        }

        const entry: LibraryEntry = {
          id: uploadId,
          title: nextSettings.title || existingEntry?.title || spine.label,
          ownerEmail: googleUser?.email || existingEntry?.ownerEmail,
          ownerName: googleUser?.name || existingEntry?.ownerName,
          ownerPicture: googleUser?.picture || existingEntry?.ownerPicture,
          publicOwnerId: existingEntry?.publicOwnerId || publicOwnerIdFor(googleUser, anonymousAccount),
          ownerAnonId: existingEntry?.ownerAnonId || anonymousAccount.id,
          ownerAnonFingerprint: existingEntry?.ownerAnonFingerprint || anonymousAccount.fingerprint,
          showOwnerLibrary: existingEntry?.showOwnerLibrary ?? showProfileOnSharedPages,
          hiddenFromPublicLibrary: existingEntry?.hiddenFromPublicLibrary,
          uploadedAt: existingEntry?.uploadedAt || uploadedAt,
          skeleton: spine.skeletonName,
          atlas: spine.atlasName,
          textures: Array.from(new Set(setsForPublish.flatMap((nextSpine) => nextSpine.atlasPages.map(basename)))),
          animations: animationNames,
          defaultAnimation,
          files: files.map((file) => file.name),
          previewPath: uploadPath,
          repositoryUrl: existingEntry?.repositoryUrl || "",
          ...(note ? { note } : {}),
          ...(thumbnail ? { thumbnail } : {}),
          ...(thumbnailType ? { thumbnailType } : {}),
        };
        const indexRequestHeaders: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (googleIdToken) indexRequestHeaders.Authorization = `Bearer ${googleIdToken}`;
        const indexResponse = await fetch("/api/github-upload", {
          method: "POST",
          headers: indexRequestHeaders,
          body: JSON.stringify({
            action: "update-index",
            googleIdToken,
            anonymousAccount,
            settings: nextSettings,
            entry,
            commitPrefix,
          }),
        });
        const indexResult = await indexResponse.json().catch(() => ({}));
        if (!indexResponse.ok) {
          throw new Error(typeof indexResult?.error === "string" ? indexResult.error : `Library API ${indexResponse.status}`);
        }

        setLibraryEntries((currentEntries) => [entry, ...currentEntries.filter((currentEntry) => currentEntry.id !== entry.id)]);
        setCurrentLibraryEntry(entry);
        setPreviewNote(note);
        setGeneratedPreviewUrl(permanentPreviewUrl);
        setIsLinkBannerOpen(true);
        setCopyStatus("Permanent link ready");
        setStatus(`Ready. Animations found: ${animationNames.length}. Uploaded.`);
      } catch (nextError) {
        publishedKeysRef.current.delete(publishKey);
        setStatus(
          `Ready. Animations found: ${animationNames.length}. Upload failed: ${
            nextError instanceof Error ? nextError.message : "publishing error"
          }`,
        );
      } finally {
        isPublishingRef.current = false;
        setIsPublishingLink(false);
      }
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    void prepareFromFiles(event.dataTransfer.files);
  };

  return (
    <main
      className={`app-shell ${!preparedSpine ? "is-empty" : ""} ${isIntroDocking ? "is-docking" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      <section className="seo-intro" aria-label="Spine-Link SEO description">
        <h1>Spine-Link online Spine preview and Spine web viewer</h1>
        <p>
          Spine-Link is a browser based Spine preview tool for Spine online workflows, Spine web previews, Spine webview links,
          JSON and SKEL animation files, atlas files, and texture images.
        </p>
      </section>
      <ParticleField />
      <section className="workspace">
        <header className="topbar">
          <a className="brand-link" href="/" aria-label="Spine-Link home">
            <span className="brand-logo" aria-hidden="true">
              <span>s</span>
              <span>p</span>
              <span className="brand-spine-mark">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <span>n</span>
              <span>e</span>
              <span className="brand-plus">link</span>
            </span>
          </a>
          <div className="auth-panel">
            {googleUser ? (
              <div className="auth-user">
                {googleUser.picture && <img src={googleUser.picture} alt="" />}
                <button type="button" onClick={openLibrary}>My Library</button>
                <button className="sign-out-icon-button" type="button" onClick={signOutGoogle} title="Sign out" aria-label="Sign out">
                  <LogOut size={17} />
                </button>
              </div>
            ) : (
              <>
                <button className="my-library-button" type="button" onClick={openLibrary}>
                  My Library
                </button>
                <button className="google-fallback-button" type="button" onClick={openGoogleSignIn}>
                  <span aria-hidden="true">G</span>
                  Library with Google
                </button>
                {googleAuthError && <span className="auth-error">{googleAuthError}</span>}
              </>
            )}
          </div>
        </header>

        <div className="stage">
          <div
            className="preview-panel"
            ref={previewPanelRef}
            style={{ "--preview-pattern-size": `${140 * zoom}px` } as React.CSSProperties}
          >
            {!preparedSpine && (
              <div className="empty-state">
                <Upload size={44} strokeWidth={1.5} />
                <span>Waiting for Spine files</span>
              </div>
            )}
            <div className="player-host" ref={playerHostRef} />
            {generatedPreviewUrl && isLinkBannerOpen && (
              <div className="link-ready-banner" role="status" aria-live="polite">
                <div className="link-ready-banner-main">
                  <strong>Permanent link ready</strong>
                  <a href={generatedPreviewUrl} target="_blank" rel="noreferrer">
                    {generatedPreviewUrl}
                  </a>
                </div>
                <div className="link-ready-banner-actions">
                  <button type="button" onClick={copyGeneratedLink}>
                    <Copy size={15} />
                    Copy
                  </button>
                  <button type="button" onClick={shareGeneratedLink}>
                    <Send size={15} />
                    Share
                  </button>
                  <button type="button" onClick={() => setIsLinkBannerOpen(false)} aria-label="Close link banner">
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className="inspector">
            <div className="tree-panel-top">
              <div className="tree-tab">Tree</div>
              <div className="tree-actions">
                <button
                  className={activeTreeDrawer === "render" ? "active" : ""}
                  type="button"
                  onClick={() => setActiveTreeDrawer((currentDrawer) => (currentDrawer === "render" ? null : "render"))}
                  title="Render settings"
                  aria-label="Render settings"
                  aria-expanded={activeTreeDrawer === "render"}
                >
                  ☷
                </button>
                <button
                  className={activeTreeDrawer === "zoom" ? "active" : ""}
                  type="button"
                  onClick={() => setActiveTreeDrawer((currentDrawer) => (currentDrawer === "zoom" ? null : "zoom"))}
                  title="Zoom"
                  aria-label="Zoom"
                  aria-expanded={activeTreeDrawer === "zoom"}
                >
                  ☰
                </button>
              </div>
            </div>
            <div className={`tree-drawer ${activeTreeDrawer ? "is-open" : ""}`}>
              {activeTreeDrawer === "render" && (
                <div className="tree-drawer-panel render-drawer is-active">
                  <SlidersHorizontal size={20} />
                  <div className="render-settings">
                    <div className="render-setting-group" aria-label="Premultiplied alpha">
                      <span>PMA</span>
                      <button
                        className={activeRenderSettings.pma ? "active" : ""}
                        disabled={!preparedSpine}
                        type="button"
                        onClick={() => updateActiveRenderSettings({ pma: true })}
                      >
                        true
                      </button>
                      <button
                        className={!activeRenderSettings.pma ? "active" : ""}
                        disabled={!preparedSpine}
                        type="button"
                        onClick={() => updateActiveRenderSettings({ pma: false })}
                      >
                        false
                      </button>
                    </div>
                    <div className="render-setting-group" aria-label="Blend mode">
                      <span>Blend</span>
                      {(["original", "normal", "screen", "additive"] as BlendOverride[]).map((blendMode) => (
                        <button
                          className={activeRenderSettings.blend === blendMode ? "active" : ""}
                          disabled={!preparedSpine}
                          key={blendMode}
                          type="button"
                          onClick={() => updateActiveRenderSettings({ blend: blendMode })}
                        >
                          {blendMode}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {activeTreeDrawer === "zoom" && (
                <div className="tree-drawer-panel zoom-drawer is-active">
                  <div className="zoom-panel">
                    <div className="zoom-header">
                      <div className="section-title">Zoom</div>
                      <button type="button" onClick={() => changeZoom(1)} disabled={zoom === 1}>
                        <RefreshCw size={15} />
                        {Math.round(zoom * 100)}%
                      </button>
                    </div>
                    <div className="zoom-controls">
                      <button type="button" onClick={() => changeZoom(zoom - 0.1)} disabled={zoom <= 0.25} title="Zoom out">
                        <ZoomOut size={17} />
                      </button>
                      <input
                        type="range"
                        min="0.25"
                        max="4"
                        step="0.05"
                        value={zoom}
                        onChange={(event) => changeZoom(Number(event.target.value))}
                        aria-label="Preview zoom"
                      />
                      <button type="button" onClick={() => changeZoom(zoom + 0.1)} disabled={zoom >= 4} title="Zoom in">
                        <ZoomIn size={17} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <label
              className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                event.stopPropagation();
                setIsDragging(false);
              }}
              onDrop={handleDrop}
            >
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                accept=".json,.skel,.atlas,.txt,.docx,.png,.jpg,.jpeg,.webp"
                onChange={(event) => event.target.files && void prepareFromFiles(event.target.files)}
              />
              <Upload size={22} />
              <strong>Drag files here</strong>
              <span>json/skel, atlas, and one or more texture images</span>
            </label>

            {shouldShowStatus && (
              <div className="status-line" data-state={error ? "error" : "ready"}>
                {isLoading ? <Loader2 className="spin" size={17} /> : error ? <X size={17} /> : <RefreshCw size={17} />}
                <span>{error || status}</span>
              </div>
            )}

            <div className="asset-list">
              <div className="asset-row">
                <FileArchive size={17} />
                <span>{fileSummary}</span>
              </div>
            </div>

            {spineOptions.length > 1 && (
              <div className="set-panel">
                <div className="section-title">Set</div>
                <select value={preparedSpine?.label ?? ""} onChange={(event) => selectSpineSet(event.target.value)}>
                  {spineOptions.map((option) => (
                    <option key={option.label} value={option.label}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="link-panel">
              <div className="section-title">Link</div>
              <div className="generated-link-row">
                <input
                  aria-label="Generated permanent preview link"
                  readOnly
                  value={
                    generatedPreviewUrl ||
                    (isPublishingLink ? "Creating permanent link..." : "Upload files and choose an animation to create a permanent link")
                  }
                />
                <button type="button" onClick={copyGeneratedLink} disabled={!generatedPreviewUrl} title="Copy link">
                  <Copy size={16} />
                </button>
              </div>
              <div className="link-actions">
                <button
                  type="button"
                  onClick={() => {
                    if (!preparedSpine || !animations.length || !activeAnimation) return;
                    void publishToGitHub(preparedSpine, animations, activeAnimation);
                  }}
                  disabled={(!currentLibraryEntry && Boolean(generatedPreviewUrl)) || !preparedSpine || !animations.length || !activeAnimation || isPublishingLink}
                >
                  {isPublishingLink ? <Loader2 className="spin" size={16} /> : <LinkIcon size={16} />}
                  {currentLibraryEntry ? "Save" : "Create"}
                </button>
                {generatedPreviewUrl ? (
                  <a href={generatedPreviewUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} />
                    Open
                  </a>
                ) : (
                  <button type="button" disabled>
                    <ExternalLink size={16} />
                    Open
                  </button>
                )}
                {generatedPreviewUrl ? (
                  <a href={generatedPreviewUrl} download={`${activeAnimation || "spine"}-preview.html`}>
                    <Download size={16} />
                    Download HTML
                  </a>
                ) : (
                  <button type="button" disabled>
                    <Download size={16} />
                    Download HTML
                  </button>
                )}
              </div>
              <p className="link-note">{copyStatus || "Permanent links work without Google sign-in."}</p>
            </div>

            <div className="note-panel">
              <div className="section-title">Text</div>
              <textarea
                value={previewNote}
                maxLength={240}
                rows={3}
                placeholder="Write up to 20 words for the generated page"
                onChange={(event) => {
                  setPreviewNote(limitWords(event.target.value));
                  setPreviewNoteStatus("");
                }}
              />
              <div className="note-actions">
                <span>{previewNote ? `${previewNote.split(/\s+/).filter(Boolean).length}/20 words` : "0/20 words"}</span>
                <button type="button" onClick={() => void savePreviewNote()} disabled={!currentLibraryEntry}>
                  Save text
                </button>
                <button type="button" onClick={deletePreviewNote} disabled={!currentLibraryEntry || !previewNote}>
                  Delete
                </button>
              </div>
              <p className="link-note">{previewNoteStatus || "Only this library owner can edit or delete this text."}</p>
            </div>

            <div className="animation-list">
              <div className="section-title">Animations</div>
              {animations.length === 0 ? (
                <p className="muted">Clickable skeleton animations will appear here after upload.</p>
              ) : (
                <div className="animation-grid">
                  {animations.map((animationName) => (
                    <button
                      className={animationName === activeAnimation ? "active" : ""}
                      key={animationName}
                      type="button"
                      onClick={() => selectAnimation(animationName)}
                      title={animationName}
                    >
                      {animationName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>
      {isLibraryOpen && (
        <div className="library-modal" role="dialog" aria-modal="true" aria-label="Library">
          <div className="library-modal-top">
            <div>
              <div className="library-kicker">LIBRARY</div>
              <h2>YOUR</h2>
            </div>
            <div className="library-modal-actions">
              <button type="button" onClick={startNewLibraryEntry} title="Add new animation card">
                <Plus size={18} />
              </button>
              <button type="button" onClick={loadLibrary} disabled={isLibraryLoading} title="Refresh library">
                {isLibraryLoading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
              </button>
              <button type="button" onClick={() => setIsLibraryOpen(false)} title="Close library">
                <X size={18} />
              </button>
            </div>
          </div>

          {libraryError && <div className="library-error">{libraryError}</div>}

          <div className="library-profile-settings">
            <div className="library-profile-settings-copy">
              <div className="section-title">Library link</div>
              <strong>Share a link to your library</strong>
              <a href={publicLibraryUrl} target="_blank" rel="noreferrer">
                {publicLibraryUrl}
              </a>
              {profileVisibilityStatus && <em>{profileVisibilityStatus}</em>}
            </div>
            <div className="library-profile-settings-actions">
              <button type="button" onClick={copyPublicLibraryLink}>
                <Copy size={17} />
                Copy link
              </button>
              <button
                className={!showProfileOnSharedPages ? "active" : ""}
                type="button"
                onClick={() => void updateSharedProfileVisibility(!showProfileOnSharedPages)}
                aria-pressed={!showProfileOnSharedPages}
              >
                {showProfileOnSharedPages ? <EyeOff size={17} /> : <Eye size={17} />}
                {showProfileOnSharedPages ? "Hide my name" : "Show my name"}
              </button>
            </div>
          </div>

          {isLibraryLoading && libraryEntries.length === 0 ? (
            <div className="library-empty">
              <Loader2 className="spin" size={26} />
              <span>Loading history</span>
            </div>
          ) : libraryEntries.length === 0 ? (
            <div className="library-empty">
              <Layers size={28} />
              <span>No uploads yet</span>
            </div>
          ) : (
            <div className="library-grid">
              {libraryEntries.map((entry, index) => {
                const previewUrl = new URL(`/p/${encodeURIComponent(entry.id)}`, window.location.origin).toString();
                const editUrl = new URL(`/?edit=${encodeURIComponent(entry.id)}`, window.location.origin).toString();
                const uploadedDate = entry.uploadedAt ? new Date(entry.uploadedAt) : null;
                return (
                  <div
                    className={`library-card${entry.hiddenFromPublicLibrary ? " is-hidden" : ""}`}
                    key={entry.id}
                    style={{
                      "--library-card-offset": `${(index % 4) * 18}px`,
                      ...(entry.thumbnail ? { "--library-thumbnail": `url(${entry.thumbnail})` } : {}),
                    } as React.CSSProperties}
                  >
                    <a className="library-card-link" href={previewUrl} target="_blank" rel="noreferrer">
                    <div className="library-card-visual">
                      <Layers size={24} />
                      <span>{entry.animations?.length ?? 0}</span>
                    </div>
                    <div className="library-card-body">
                      <strong>{entry.title || entry.id}</strong>
                      <span>{entry.skeleton || "Spine preview"}</span>
                      <div className="library-card-meta">
                        <span>
                          <Calendar size={13} />
                          {uploadedDate && !Number.isNaN(uploadedDate.getTime())
                            ? `${uploadedDate.toLocaleDateString()} ${uploadedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                            : "Saved"}
                        </span>
                        <span>{entry.files?.length ?? 0} files</span>
                      </div>
                    </div>
                    </a>
                    <div className="library-card-actions" aria-label={`${entry.title || entry.id} actions`}>
                      <a href={editUrl}>Edit</a>
                      <button type="button" onClick={() => void updateLibraryEntryVisibility(entry, !entry.hiddenFromPublicLibrary)}>
                        {entry.hiddenFromPublicLibrary ? "Show" : "Hide"}
                      </button>
                      <button type="button" onClick={() => void copyLibraryEntryLink(previewUrl)}>Link</button>
                      <button className="danger" type="button" onClick={() => void deleteLibraryEntry(entry)}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <a className="site-credit" href="https://t.me/vladleopold" target="_blank" rel="noreferrer">
        by leopold
      </a>
    </main>
  );
}
