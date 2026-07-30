import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import {
  Calendar,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileArchive,
  Heart,
  Layers,
  Link as LinkIcon,
  LogOut,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  SlidersHorizontal,
  Upload,
  User,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { SpinePlayer as SpinePlayerInstance, SpinePlayerConfig } from "@esotericsoftware/spine-player";

type AppProps = {
  initialFiles?: File[];
  initialOpenLibrary?: boolean;
  initialLogin?: boolean;
  initialUpload?: boolean;
};

declare global {
  interface Window {
    __spineLinkReceiveFiles?: (files: File[]) => void;
    __spinePatched?: boolean;
    spine?: {
      SpinePlayer?: new (parent: HTMLElement | string, config: SpinePlayerConfig) => SpinePlayerInstance;
      AtlasAttachmentLoader?: new () => unknown;
    };
  }
}

type LoadedAsset = {
  file: File;
  dataUri: string;
  transparentizedDataUri?: string;
  premultipliedTransparentizedDataUri?: string;
  hasBlackMatte?: boolean;
  text?: string;
  skeletonVersion?: string;
};

type PreparedSpine = {
  label: string;
  skeletonName: string;
  atlasName: string;
  atlasPages: string[];
  skeletonVersion?: string;
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

type ExtraSpinePlayer = {
  id: string;
  set: PreparedSpine;
  animations: string[];
  activeAnimation: string;
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
    getCurrent?: (trackIndex: number) => { loop?: boolean; animation?: { duration?: number } } | null;
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

type SourceProofFile = {
  name: string;
  bytes: number;
  sha256: string;
};

type BrowserEnvironmentProof = {
  userAgent: string;
  platform: string;
  language: string;
  languages: string[];
  hardwareConcurrency: number;
  deviceMemory?: number;
  screen: {
    width: number;
    height: number;
    colorDepth: number;
    pixelRatio: number;
  };
  timezone: string;
  timezoneOffset: number;
  maxTouchPoints: number;
  cookieEnabled: boolean;
};

type SourceProof = {
  type: "SpineLinkSourceProof";
  version: 1;
  proofHash: string;
  hashAlgorithm: "SHA-256";
  entryId: string;
  title: string;
  uploadedAt: string;
  proofPath: string;
  proofUrl: string;
  uploader: {
    mode: "google-account" | "anonymous-browser";
    googleEmailSha256?: string;
    anonymousAccountId: string;
    anonymousFingerprint: string;
    browserFingerprintSha256: string;
    browserEnvironmentHashSha256: string;
    browserEnvironment: BrowserEnvironmentProof;
  };
  github: {
    owner: string;
    repo: string;
    branch: string;
    previewPath: string;
  };
  blockchain: {
    status: "ready-to-anchor";
    recommendedAnchorPayload: string;
    note: string;
  };
  files: SourceProofFile[];
};

type GitHubProofReceipt = {
  name: string;
  path: string;
  bytes: number;
  sha256: string;
  github: {
    contentSha?: string;
    commitSha?: string;
    commitUrl?: string;
    downloadUrl?: string;
  };
};

type BlockchainAnchor = {
  type: "SpineLinkGitHubBlockchainAnchor";
  version: 1;
  anchorHash: string;
  recommendedAnchorPayload: string;
  anchorPath?: string;
  anchorUrl?: string;
  sourceProofHash: string;
  sourceProofPath?: string;
  sourceProofUrl?: string;
  blockchain: {
    status: "ready-to-anchor" | "submitted" | "failed";
    chain?: string;
    chainId?: number;
    network?: string;
    transactionHash?: string;
    transactionData?: string;
    explorerUrl?: string;
    message?: string;
  };
  github?: {
    owner?: string;
    repo?: string;
    branch?: string;
    repositoryUrl?: string;
    uploadPath?: string;
    anchorPath?: string;
    anchorUrl?: string;
    anchorCommitSha?: string;
    anchorCommitUrl?: string;
    files?: GitHubProofReceipt[];
  };
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
  portfolioMode?: boolean;
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
  thumbnailPoster?: string;
  thumbnailType?: "gif" | "image";
  webmPreview?: string;
  thumbnailPath?: string;
  thumbnailPosterPath?: string;
  webmPreviewPath?: string;
  previewWidth?: number;
  previewHeight?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaAspectRatio?: number;
  previewDuration?: number;
  cardSize?: LibraryCardSize;
  sourceProof?: SourceProof;
  sourceProofPath?: string;
  sourceProofUrl?: string;
  blockchainAnchor?: BlockchainAnchor;
  webmStatus?: string;
  webmChunksJson?: string;
  webmChunks?: string[];
  webmChunkCount?: number;
  webmIsChunked?: boolean;
  webmAnimDuration?: number;
  webmGeneratedAt?: string;
};

type EntryMetric = {
  likes: number;
  views: number;
  liked?: boolean;
};

type HomeFeedEntry = {
  id: string;
  title: string;
  ownerName?: string;
  ownerUrl?: string;
  previewUrl: string;
  webmPreview?: string;
  thumbnail?: string;
  thumbnailPoster?: string;
  thumbnailType?: "gif" | "image";
  previewWidth?: number;
  previewHeight?: number;
  mediaAspectRatio?: number;
  animations?: number;
  pageMode?: "Portfolio" | "Library";
  metrics?: EntryMetric;
};

type UploadResponse = {
  previewUrl?: string;
  repositoryUrl?: string;
  error?: string;
};

type LibraryCardSize =
  | "auto"
  | "square"
  | "small-square"
  | "horizontal"
  | "vertical"
  | "medium-wide"
  | "medium-narrow";

const libraryCardSizeOptions: Array<{ value: LibraryCardSize; label: string; dimensions: string }> = [
  { value: "auto", label: "Auto from WebM", dimensions: "video ratio" },
  { value: "square", label: "square", dimensions: "415x324" },
  { value: "small-square", label: "small-square", dimensions: "270x210" },
  { value: "horizontal", label: "horizontal", dimensions: "415x210" },
  { value: "vertical", label: "vertical", dimensions: "270x438" },
  { value: "medium-wide", label: "medium-wide", dimensions: "559x324" },
  { value: "medium-narrow", label: "medium-narrow", dimensions: "270x324" },
];

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

function compareLibraryEntries(a: LibraryEntry, b: LibraryEntry) {
  const aOrder = Number(a.libraryOrder);
  const bOrder = Number(b.libraryOrder);
  const hasAOrder = Number.isFinite(aOrder);
  const hasBOrder = Number.isFinite(bOrder);
  if (hasAOrder && hasBOrder && aOrder !== bOrder) return aOrder - bOrder;
  if (hasAOrder !== hasBOrder) return hasAOrder ? -1 : 1;
  return String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || ""));
}

function normalizeLibraryOrder(entries: LibraryEntry[]) {
  return [...entries].sort(compareLibraryEntries).map((entry, index) => ({ ...entry, libraryOrder: index + 1 }));
}

function moveLibraryEntryInList(entries: LibraryEntry[], entryId: string, direction: "up" | "down") {
  const nextEntries = normalizeLibraryOrder(entries);
  const currentPosition = nextEntries.findIndex((currentEntry) => currentEntry.id === entryId);
  const nextPosition = direction === "up" ? currentPosition - 1 : currentPosition + 1;
  if (currentPosition < 0 || nextPosition < 0 || nextPosition >= nextEntries.length) return nextEntries;
  const [movedEntry] = nextEntries.splice(currentPosition, 1);
  nextEntries.splice(nextPosition, 0, movedEntry);
  return nextEntries.map((currentEntry, index) => ({ ...currentEntry, libraryOrder: index + 1 }));
}

function libraryCardSizeClassForRatio(ratio: number) {
  if (!Number.isFinite(ratio) || ratio <= 0) return "library-card--square";
  if (ratio >= 3.2) return "library-card--full";
  if (ratio >= 1.85) return "library-card--wide";
  if (ratio >= 1.35) return "library-card--horizontal";
  if (ratio >= 1.12) return "library-card--medium-wide";
  if (ratio <= 0.62) return "library-card--vertical";
  if (ratio <= 0.72) return "library-card--medium-narrow";
  return "library-card--square";
}

function libraryCardSizeClassForManualSize(size?: string) {
  if (!size || size === "auto") return "";
  return `library-card--${size}`;
}

function fallbackLibraryCardSizeClass(index: number) {
  const fallbackSizes = [
    "library-card--horizontal",
    "library-card--square",
    "library-card--medium-wide",
    "library-card--vertical",
    "library-card--large-rect",
    "library-card--wide",
    "library-card--medium-narrow",
    "library-card--square",
  ];
  return fallbackSizes[Math.abs(index) % fallbackSizes.length];
}

function libraryCardSizeClass(entry: LibraryEntry, index: number) {
  const manualClass = libraryCardSizeClassForManualSize(entry.cardSize);
  const mediaRatio = Number(entry.mediaAspectRatio || 0);
  const width = Number(entry.previewWidth || entry.thumbnailWidth || entry.mediaWidth || 0);
  const height = Number(entry.previewHeight || entry.thumbnailHeight || entry.mediaHeight || 0);
  const ratio = mediaRatio > 0 ? mediaRatio : width > 0 && height > 0 ? width / height : 0;
  if (manualClass === "library-card--medium-narrow" && ratio >= 0.75 && ratio <= 1.15) {
    return "library-card--square";
  }
  if (manualClass) return manualClass;
  if (!ratio) return fallbackLibraryCardSizeClass(index);
  return libraryCardSizeClassForRatio(ratio);
}

function selectLibraryVideoAspectRatio(video: HTMLVideoElement) {
  return video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 0;
}

function applyLibraryCardVideoAspect(video: HTMLVideoElement) {
  const card = video.closest(".library-card-shell") || video.closest(".library-card");
  if (!card || !video.videoWidth || !video.videoHeight) return;
  if (card instanceof HTMLElement && card.dataset.cardSizeMode === "manual") return;
  const nextClass = libraryCardSizeClassForRatio(selectLibraryVideoAspectRatio(video));
  card.classList.remove(
    "library-card--small-square",
    "library-card--square",
    "library-card--horizontal",
    "library-card--wide",
    "library-card--vertical",
    "library-card--medium-narrow",
    "library-card--medium-wide",
    "library-card--large-rect",
    "library-card--full",
  );
  card.classList.add(nextClass);
}

function videoPreviewAspectRatioStyle(entry?: Pick<LibraryEntry, "previewWidth" | "previewHeight"> | null) {
  const width = Number(entry?.previewWidth || 0);
  const height = Number(entry?.previewHeight || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return { "--video-preview-ratio": `${Math.round(width)} / ${Math.round(height)}` } as React.CSSProperties;
}

function ProgressiveMedia({
  posterSrc,
  videoSrc,
  chunks,
  className,
  loop: loopProp,
  controls: controlsProp,
  onLoadedMetadata: onLoadedMetadataProp,
  ...props
}: {
  posterSrc?: string;
  videoSrc?: string;
  chunks?: string[];
  className?: string;
  loop?: boolean;
  controls?: boolean;
  onLoadedMetadata?: React.VideoHTMLAttributes<HTMLVideoElement>["onLoadedMetadata"];
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onLoadedMetadata">) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);

  useEffect(() => {
    if (!videoSrc || !videoReady || !videoRef.current) return;
    const v = videoRef.current;
    v.play().catch(() => {});
  }, [videoReady, videoSrc]);

  const startVideoLoad = useCallback(() => {
    if (videoStarted || !videoSrc) return;
    setVideoStarted(true);
    if (videoRef.current && chunks && chunks.length > 1 && window.MediaSource) {
      const v = videoRef.current;
      const ms = new MediaSource();
      v.src = URL.createObjectURL(ms);
      let cancelled = false;
      ms.addEventListener("sourceopen", async () => {
        try {
          const sb = ms.addSourceBuffer('video/webm; codecs="vp8"');
          for (const chunkUrl of chunks) {
            if (cancelled) break;
            const buf = await fetch(chunkUrl).then((r) => r.arrayBuffer());
            if (cancelled) break;
            await new Promise<void>((resolve) => {
              sb.addEventListener("updateend", () => resolve(), { once: true });
              sb.appendBuffer(buf);
            });
          }
          if (!cancelled && ms.readyState === "open") ms.endOfStream();
        } catch (err) {
          console.error("ProgressiveMedia chunked error:", err);
        }
      });
      cancelRef.current = () => { cancelled = true; };
    } else if (videoRef.current) {
      videoRef.current.src = videoSrc;
    }
  }, [videoSrc, videoStarted, chunks]);

  useEffect(() => {
    return () => {
      cancelRef.current?.();
    };
  }, []);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }} {...props}>
      {posterSrc && <img src={posterSrc} alt="" loading="lazy" decoding="async" onLoad={startVideoLoad} style={{ width: "100%", height: "100%", objectFit: "contain", position: "absolute", inset: 0, opacity: videoReady ? 0 : 1, transition: "opacity .3s", zIndex: videoReady ? 0 : 1 }} />}
      <video
        ref={videoRef}
        muted
        playsInline
        loop={loopProp}
        controls={controlsProp}
        preload={videoStarted ? "auto" : "none"}
        onCanPlayThrough={() => setVideoReady(true)}
        onLoadedMetadata={onLoadedMetadataProp}
        style={{ width: "100%", height: "100%", objectFit: "contain", position: "absolute", inset: 0, opacity: videoReady ? 1 : 0, zIndex: videoReady ? 1 : 0 }}
      />
    </div>
  );
}

function ChunkedVideo({ src, chunks, ...props }: React.VideoHTMLAttributes<HTMLVideoElement> & { chunks?: string[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    if (!chunks || chunks.length <= 1 || !videoRef.current || !window.MediaSource) return;
    
    let isCancelled = false;
    const ms = new MediaSource();
    videoRef.current.src = URL.createObjectURL(ms);
    
    ms.addEventListener('sourceopen', async () => {
      try {
        const sb = ms.addSourceBuffer('video/webm; codecs="vp8"'); // Use generic webm mime type
        for (const chunkUrl of chunks) {
          if (isCancelled) break;
          const buf = await fetch(chunkUrl).then(r => r.arrayBuffer());
          if (isCancelled) break;
          await new Promise<void>(resolve => {
            sb.addEventListener('updateend', () => resolve(), { once: true });
            sb.appendBuffer(buf);
          });
        }
        if (!isCancelled && ms.readyState === 'open') {
          ms.endOfStream();
        }
      } catch (err) {
        console.error("ChunkedVideo error:", err);
      }
    });
    
    return () => {
      isCancelled = true;
    };
  }, [chunks]);

  const fallbackSrc = !chunks || chunks.length <= 1 ? src : undefined;
  
  return <video ref={videoRef} src={fallbackSrc} {...props} />;
}

function applySeoVideoPreviewAspect(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) return;
  const frame = video.closest(".seo-video-frame");
  if (!(frame instanceof HTMLElement)) return;
  frame.style.setProperty("--video-preview-ratio", `${video.videoWidth} / ${video.videoHeight}`);
}

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
const legacySpinePlayerPromises = new Map<
  string,
  Promise<{ SpinePlayer: new (parent: HTMLElement | string, config: SpinePlayerConfig) => SpinePlayerInstance }>
>();
let googleScriptPromise: Promise<void> | null = null;

function loadSpinePlayerModule() {
  if (!spinePlayerModulePromise) {
    spinePlayerModulePromise = Promise.all([
      import("@esotericsoftware/spine-player"),
      import("@esotericsoftware/spine-player/dist/spine-player.css"),
    ]).then(([module]) => {
      (module.GLTexture as unknown as { DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL?: boolean }).DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = true;
      patchAtlasAttachmentLoader(module.AtlasAttachmentLoader, module);
      setTimeout(() => patchAtlasAttachmentLoader(window.spine?.AtlasAttachmentLoader, window.spine), 100);
      return module;
    });
  }

  return spinePlayerModulePromise;
}

function patchAtlasAttachmentLoader(Al: unknown, spineNs?: unknown) {
  if (!Al || window.__spinePatched) return;
  window.__spinePatched = true;
  const p = (Al as Record<string, unknown>).prototype as Record<string, unknown>;

  const origFindRegion = p.findRegion as (...args: unknown[]) => unknown;
  if (typeof origFindRegion === "function") {
    (p as Record<string, (...args: unknown[]) => unknown>).findRegion = function (this: unknown, ...args: unknown[]) {
      try { return origFindRegion.apply(this, args); } catch { return null; }
    };
  }
  const origFindRegions = p.findRegions as (...args: unknown[]) => unknown;
  if (typeof origFindRegions === "function") {
    (p as Record<string, (...args: unknown[]) => unknown>).findRegions = function (this: unknown, ...args: unknown[]) {
      try { return origFindRegions.apply(this, args); } catch { return []; }
    };
  }
  const methods = ["newRegionAttachment", "newMeshAttachment", "newBoundingBoxAttachment", "newPathAttachment", "newPointAttachment", "newClippingAttachment"];
  for (const method of methods) {
    const orig = p[method] as (...args: unknown[]) => unknown;
    if (typeof orig !== "function") continue;
    (p as Record<string, (...args: unknown[]) => unknown>)[method] = function (this: unknown, ...args: unknown[]) {
      try { return orig.apply(this, args); } catch { return null; }
    };
  }

  const ns = spineNs as Record<string, unknown> | undefined;
  if (!ns) return;
  for (const ctorName of ["RegionAttachment", "MeshAttachment"]) {
    const ctor = ns[ctorName];
    if (typeof ctor !== "function") continue;
    const proto = (ctor as unknown as Record<string, unknown>).prototype as Record<string, unknown>;
    const orig = proto.computeUVs as (...args: unknown[]) => unknown;
    if (typeof orig !== "function") continue;
    (proto as Record<string, (...args: unknown[]) => unknown>).computeUVs = function (this: unknown, ...args: unknown[]) {
      try { return orig.apply(this, args); } catch { return; }
    };
  }
}

function loadScriptOnce(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existingScript?.dataset.loaded === "true") {
      resolve();
      return;
    }
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

function loadStylesheetOnce(href: string) {
  if (document.querySelector<HTMLLinkElement>(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function isLegacySpine38(preparedSpine?: Pick<PreparedSpine, "skeletonVersion"> | null) {
  return /^3\./.test(preparedSpine?.skeletonVersion || "");
}

function legacySpine3Runtime(version = "") {
  if (/^3\.7(?:\.|$)/.test(version)) return "3.7";
  if (/^3\.8(?:\.|$)/.test(version)) return "3.8";
  return "";
}

function unsupportedSpineMajorMessage(version = "") {
  const major = version.match(/^(\d+)\./)?.[1] || "";
  if (major === "1" || major === "2") {
    return `This skeleton was exported with Spine ${version}. The file was detected correctly, but Spine ${major}.x needs its matching legacy web runtime bundle before it can be previewed in this browser player.`;
  }
  return "";
}

async function loadSpinePlayerForSet(preparedSpine?: Pick<PreparedSpine, "skeletonVersion"> | null) {
  const version = preparedSpine?.skeletonVersion || "";
  const unsupportedMessage = unsupportedSpineMajorMessage(preparedSpine?.skeletonVersion || "");
  if (unsupportedMessage) throw new Error(unsupportedMessage);
  if (!isLegacySpine38(preparedSpine)) return loadSpinePlayerModule();

  const runtime = legacySpine3Runtime(version);
  if (!runtime) {
    throw new Error(
      `This skeleton was exported with Spine ${version || "3.x"}. Spine 3.7 and 3.8 legacy players are bundled; this older 3.x export needs its matching runtime or a re-export to 3.8/4.x.`,
    );
  }

  if (!legacySpinePlayerPromises.has(runtime)) {
    legacySpinePlayerPromises.set(
      runtime,
      (async () => {
      loadStylesheetOnce(`/vendor-spine-player-${runtime}.css`);
      await loadScriptOnce(`/vendor-spine-player-${runtime}.js`);
      const SpinePlayer = window.spine?.SpinePlayer;
      if (!SpinePlayer) throw new Error(`Legacy Spine ${runtime} runtime could not be loaded.`);
      patchAtlasAttachmentLoader(window.spine?.AtlasAttachmentLoader, window.spine);
      return { SpinePlayer };
      })(),
    );
  }

  return legacySpinePlayerPromises.get(runtime)!;
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
const skeletonUploadTipStoragePrefix = "spine-link-skeleton-upload-tip";

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

function browserEnvironmentProof(): BrowserEnvironmentProof {
  if (typeof window === "undefined") {
    return {
      userAgent: "server",
      platform: "server",
      language: "",
      languages: [],
      hardwareConcurrency: 0,
      screen: { width: 0, height: 0, colorDepth: 0, pixelRatio: 1 },
      timezone: "",
      timezoneOffset: 0,
      maxTouchPoints: 0,
      cookieEnabled: false,
    };
  }

  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: Array.from(navigator.languages || []).slice(0, 8),
    hardwareConcurrency: Number(navigator.hardwareConcurrency || 0),
    ...(typeof navigatorWithMemory.deviceMemory === "number" ? { deviceMemory: navigatorWithMemory.deviceMemory } : {}),
    screen: {
      width: Number(window.screen?.width || 0),
      height: Number(window.screen?.height || 0),
      colorDepth: Number(window.screen?.colorDepth || 0),
      pixelRatio: Number(window.devicePixelRatio || 1),
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    timezoneOffset: new Date().getTimezoneOffset(),
    maxTouchPoints: Number(navigator.maxTouchPoints || 0),
    cookieEnabled: Boolean(navigator.cookieEnabled),
  };
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

function updateStoredGoogleUser(user: GoogleUser) {
  if (typeof window === "undefined") return;
  const storedSession = readStoredGoogleSession();
  if (!storedSession?.accessToken) return;
  window.localStorage.setItem(googleSessionStorageKey, JSON.stringify({ ...storedSession, user } satisfies StoredGoogleSession));
}

function clearStoredGoogleSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(googleSessionStorageKey);
}

function cleanAccountDisplayName(value = "") {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 80);
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

function skeletonUploadTipStorageKeys(user: GoogleUser | null, anonymousAccount: AnonymousAccount) {
  const keys = [`${skeletonUploadTipStoragePrefix}:browser:${anonymousAccount.id}`];
  const email = user?.email?.trim().toLowerCase();
  if (email) keys.push(`${skeletonUploadTipStoragePrefix}:user:${email}`);
  return keys;
}

function hasDismissedSkeletonUploadTip(user: GoogleUser | null, anonymousAccount: AnonymousAccount) {
  if (typeof window === "undefined") return false;
  try {
    return skeletonUploadTipStorageKeys(user, anonymousAccount).some((key) => window.localStorage.getItem(key) === "dismissed");
  } catch {
    return false;
  }
}

function storeDismissedSkeletonUploadTip(user: GoogleUser | null, anonymousAccount: AnonymousAccount) {
  if (typeof window === "undefined") return;
  try {
    for (const key of skeletonUploadTipStorageKeys(user, anonymousAccount)) {
      window.localStorage.setItem(key, "dismissed");
    }
  } catch {
    // Ignore storage failures; the close button should still hide the prompt for this render.
  }
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

function skinNamesFromSkeletonJson(skeletonJson: unknown) {
  if (!skeletonJson || typeof skeletonJson !== "object" || !("skins" in skeletonJson)) return [];
  const skins = (skeletonJson as { skins?: unknown }).skins;
  if (Array.isArray(skins)) {
    return skins
      .map((skin) => {
        if (typeof skin === "string") return skin;
        if (skin && typeof skin === "object" && "name" in skin && typeof skin.name === "string") return skin.name;
        return "";
      })
      .filter(Boolean);
  }
  if (skins && typeof skins === "object") {
    return Object.keys(skins).filter(Boolean);
  }
  return [];
}

function preferredSkinName(skinNames: string[]) {
  if (!skinNames.length) return "";
  return skinNames.includes("default") ? "default" : skinNames[0] || "";
}

function sanitizeSkeletonData(json: unknown): unknown {
  return sanitizeSkeletonJson(json);
}

const validSlotTimelineTypes = new Set(["attachment", "rgba", "rgb", "alpha", "rgba2", "rgb2", "color", "twoColor", "drawOrder", "event", "sequence", "flipx", "flipy"]);

function sanitizeSkeletonJson(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const obj = json as Record<string, unknown>;
  if (obj.animations && typeof obj.animations === "object") {
    for (const animName of Object.keys(obj.animations as Record<string, unknown>)) {
      const anim = (obj.animations as Record<string, unknown>)[animName];
      if (!anim || typeof anim !== "object") continue;
      const animObj = anim as Record<string, unknown>;
      if (animObj.slots && typeof animObj.slots === "object") {
        for (const slotName of Object.keys(animObj.slots as Record<string, unknown>)) {
          const slotTimelines = (animObj.slots as Record<string, unknown>)[slotName];
          if (!slotTimelines || typeof slotTimelines !== "object") continue;
          for (const timelineName of Object.keys(slotTimelines as Record<string, unknown>)) {
            if (!validSlotTimelineTypes.has(timelineName)) {
              delete (slotTimelines as Record<string, unknown>)[timelineName];
            }
          }
        }
      }
    }
  }
  const skins = (json as Record<string, unknown>).skins as Record<string, unknown>[] | undefined;
  if (!skins) return json;
  const attachments = skins.flatMap((skin) => Object.values(skin || {})) || [];
  for (const slotAttachments of attachments) {
    if (!slotAttachments || typeof slotAttachments !== "object") continue;
    const attachmentValues = Object.values(slotAttachments as Record<string, unknown>);
    for (const attachment of attachmentValues) {
      if (!attachment || typeof attachment !== "object") continue;
      const attachmentObj = attachment as Record<string, unknown>;
      const type = attachmentObj.type as string | undefined;
      if (type === "mesh" || type === "linkedmesh") {
        if (!attachmentObj.source) {
          if (type === "mesh" || type === "linkedmesh") {
            if (!Array.isArray(attachmentObj.uvs)) attachmentObj.uvs = [];
            if (!Array.isArray(attachmentObj.vertices)) attachmentObj.vertices = [];
            if (!Array.isArray(attachmentObj.triangles)) attachmentObj.triangles = [];
          }
        }
      }
    }
  }
  return json;
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

class SpineBinaryCursor {
  index = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readByte() {
    return this.bytes[this.index++] ?? 0;
  }

  skip(length: number) {
    this.index += length;
  }

  readInt(optimizePositive: boolean) {
    let byte = this.readByte();
    let result = byte & 0x7f;
    if ((byte & 0x80) !== 0) {
      byte = this.readByte();
      result |= (byte & 0x7f) << 7;
      if ((byte & 0x80) !== 0) {
        byte = this.readByte();
        result |= (byte & 0x7f) << 14;
        if ((byte & 0x80) !== 0) {
          byte = this.readByte();
          result |= (byte & 0x7f) << 21;
          if ((byte & 0x80) !== 0) {
            byte = this.readByte();
            result |= (byte & 0x7f) << 28;
          }
        }
      }
    }
    return optimizePositive ? result : (result >>> 1) ^ -(result & 1);
  }

  readStringMeta() {
    const start = this.index;
    const byteCount = this.readInt(true);
    const contentStart = this.index;
    if (byteCount === 0) return { start, end: this.index, value: null as string | null };
    if (byteCount === 1) return { start, end: this.index, value: "" };
    this.skip(byteCount - 1);
    return {
      start,
      end: this.index,
      value: new TextDecoder().decode(this.bytes.slice(contentStart, this.index)),
    };
  }
}

function encodeSpineBinaryString(value: string) {
  const textBytes = new TextEncoder().encode(value);
  const byteCount = textBytes.length + 1;
  const lengthBytes: number[] = [];
  let remaining = byteCount;
  while (true) {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    lengthBytes.push(byte);
    if (!remaining) break;
  }
  return new Uint8Array([...lengthBytes, ...textBytes]);
}

function replaceByteRanges(bytes: Uint8Array, replacements: Array<{ start: number; end: number; bytes: Uint8Array }>) {
  if (!replacements.length) return bytes;
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  const nextLength = sorted.reduce((length, replacement) => length - (replacement.end - replacement.start) + replacement.bytes.length, bytes.length);
  const nextBytes = new Uint8Array(nextLength);
  let sourceIndex = 0;
  let targetIndex = 0;

  for (const replacement of sorted) {
    nextBytes.set(bytes.slice(sourceIndex, replacement.start), targetIndex);
    targetIndex += replacement.start - sourceIndex;
    nextBytes.set(replacement.bytes, targetIndex);
    targetIndex += replacement.bytes.length;
    sourceIndex = replacement.end;
  }

  nextBytes.set(bytes.slice(sourceIndex), targetIndex);
  return nextBytes;
}

function sanitizedSkelDataUriFromBuffer(buffer: ArrayBuffer, version = "") {
  const bytes = new Uint8Array(buffer);
  const cursor = new SpineBinaryCursor(bytes);
  const replacements: Array<{ start: number; end: number; bytes: Uint8Array }> = [];

  try {
    if (/^3\./.test(version)) {
      cursor.readStringMeta();
      cursor.readStringMeta();
    } else {
      cursor.skip(8);
      cursor.readStringMeta();
      cursor.skip(4);
    }
    cursor.skip(16);
    const nonessential = cursor.readByte() !== 0;
    if (nonessential) {
      cursor.skip(4);
      cursor.readStringMeta();
      cursor.readStringMeta();
    }

    const stringCount = cursor.readInt(true);
    for (let index = 0; index < stringCount; index += 1) cursor.readStringMeta();

    const boneCount = cursor.readInt(true);
    for (let index = 0; index < boneCount; index += 1) {
      const name = cursor.readStringMeta();
      if (!name.value) {
        replacements.push({
          start: name.start,
          end: name.end,
          bytes: encodeSpineBinaryString(`__placeholder_bone_${index}`),
        });
      }

      if (index > 0) cursor.readInt(true);
      cursor.skip(32);
      cursor.readInt(true);
      cursor.skip(1);
      if (nonessential) {
        cursor.skip(4);
      }
    }
  } catch {
    return `data:application/octet-stream;base64,${bytesToBase64FromBytes(bytes)}`;
  }

  return `data:application/octet-stream;base64,${bytesToBase64FromBytes(replaceByteRanges(bytes, replacements))}`;
}

function spineBinaryVersionFromBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const legacyCursor = new SpineBinaryCursor(bytes);
  try {
    legacyCursor.readStringMeta();
    const version = legacyCursor.readStringMeta().value || "";
    if (/^\d+\.\d+(?:\.|$)/.test(version)) return version;
  } catch {
    // Try the current binary header below.
  }

  const cursor = new SpineBinaryCursor(bytes);
  try {
    cursor.skip(8);
    return cursor.readStringMeta().value || "";
  } catch {
    return "";
  }
}

function spineSkeletonVersionFromText(text?: string) {
  if (!text) return "";
  try {
    const decodedJson = sanitizeSkeletonData(stripPackedPlaceholders(decodePackedSkeletonJson(text)));
    if (decodedJson && typeof decodedJson === "object" && "skeleton" in decodedJson) {
      const version = (decodedJson as { skeleton?: { spine?: unknown } }).skeleton?.spine;
      return typeof version === "string" ? version : "";
    }
  } catch {
    return "";
  }
  return "";
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

function canonicalAtlasPageName(pageName = "") {
  return basename(String(pageName || "").replace(/\\/g, "/").trim());
}

function imageMatchesAtlasPage(imageName = "", pageName = "") {
  const imageBase = basename(String(imageName || "").replace(/\\/g, "/").trim()).toLowerCase();
  const pageBase = canonicalAtlasPageName(pageName).toLowerCase();
  if (!imageBase || !pageBase) return false;
  if (imageBase === pageBase) return true;
  if (pageBase.endsWith(imageBase)) return true;
  if (imageBase.endsWith(pageBase)) return true;
  return false;
}

function atlasTextWithCanonicalPageNames(atlasText = "") {
  const lines = atlasText.split(/\r?\n/);
  let nextPage = false;

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        nextPage = false;
        return line;
      }

      if (!/^\s/.test(line) && /\.(png|jpe?g|webp)$/i.test(trimmed)) {
        nextPage = true;
        return canonicalAtlasPageName(trimmed);
      }

      if (nextPage && !/^\s/.test(line) && /:/.test(line)) {
        nextPage = false;
      }

      return line;
    })
    .join("\n");
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

function fallbackViewportFromAtlas(atlasText = ""): PreparedSpine["viewport"] {
  const lines = atlasText.split(/\r?\n/);
  let maxWidth = 0;
  let maxHeight = 0;
  let activeRegion = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      activeRegion = "";
      continue;
    }

    if (/^[^\s].*\.(png|jpe?g|webp)$/i.test(rawLine)) {
      activeRegion = "";
      continue;
    }

    if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
      activeRegion = line;
      continue;
    }

    if (!activeRegion || !/^(?:orig|size|bounds):/i.test(line)) continue;

    const numbers = line.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const [first, second, third, fourth] = numbers;
    const width = typeof third === "number" ? third : first;
    const height = typeof fourth === "number" ? fourth : second;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
    maxWidth = Math.max(maxWidth, width);
    maxHeight = Math.max(maxHeight, height);
  }

  if (maxWidth <= 0 || maxHeight <= 0) return undefined;

  const paddedWidth = Math.max(256, maxWidth * 1.16);
  const paddedHeight = Math.max(256, maxHeight * 1.16);
  return {
    x: -paddedWidth / 2,
    y: -paddedHeight / 2,
    width: paddedWidth,
    height: paddedHeight,
  };
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
  return `data:${mime};charset=utf-8,${text}`;
}

const transparentPngDataUri =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6Xn4cAAAAASUVORK5CYII=";

function textFromDataUri(dataUri = "") {
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex < 0) return "";

  const metadata = dataUri.slice(0, commaIndex);
  const payload = dataUri.slice(commaIndex + 1);
  if (metadata.includes(";base64")) return decodeURIComponent(escape(window.atob(payload)));
  return payload;
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

function bytesToBase64FromBytes(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function byteLengthFromBase64(base64: string) {
  const normalized = base64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function base64ToBytes(base64: string) {
  const binary = window.atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256HexFromBytes(bytes: Uint8Array) {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  return bytesToHex(await crypto.subtle.digest("SHA-256", input.buffer));
}

async function sha256HexFromText(text: string) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value = "", head = 10, tail = 8) {
  const clean = value.trim();
  if (clean.length <= head + tail + 3) return clean;
  return `${clean.slice(0, head)}...${clean.slice(-tail)}`;
}

async function createSourceProof(
  files: { name: string; contentBase64: string }[],
  options: {
    uploadId: string;
    title: string;
    uploadedAt: string;
    uploadPath: string;
    proofPath: string;
    proofUrl: string;
    settings: GitHubSettings;
    user: GoogleUser | null;
    anonymousAccount: AnonymousAccount;
  },
): Promise<SourceProof> {
  const fileProofs = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      bytes: byteLengthFromBase64(file.contentBase64),
      sha256: await sha256HexFromBytes(base64ToBytes(file.contentBase64)),
    })),
  );
  const browserHash = await sha256HexFromText(browserFingerprint());
  const browserEnvironment = browserEnvironmentProof();
  const browserEnvironmentHashSha256 = await sha256HexFromText(canonicalJson(browserEnvironment));
  const googleEmailSha256 = options.user?.email ? await sha256HexFromText(options.user.email.trim().toLowerCase()) : undefined;
  const proofPayload = {
    type: "SpineLinkSourceProof" as const,
    version: 1 as const,
    hashAlgorithm: "SHA-256" as const,
    entryId: options.uploadId,
    title: options.title,
    uploadedAt: options.uploadedAt,
    proofPath: options.proofPath,
    proofUrl: options.proofUrl,
    uploader: {
      mode: options.user?.email ? ("google-account" as const) : ("anonymous-browser" as const),
      ...(googleEmailSha256 ? { googleEmailSha256 } : {}),
      anonymousAccountId: options.anonymousAccount.id,
      anonymousFingerprint: options.anonymousAccount.fingerprint,
      browserFingerprintSha256: browserHash,
      browserEnvironmentHashSha256,
      browserEnvironment,
    },
    github: {
      owner: options.settings.owner,
      repo: options.settings.repo,
      branch: options.settings.branch,
      previewPath: options.uploadPath,
    },
    blockchain: {
      status: "ready-to-anchor" as const,
      recommendedAnchorPayload: "",
      note:
        "Anchor proofHash on-chain together with the GitHub commit/file path to timestamp the original upload evidence.",
    },
    files: fileProofs.sort((a, b) => a.name.localeCompare(b.name)),
  };
  const proofHash = await sha256HexFromText(canonicalJson(proofPayload));
  return {
    ...proofPayload,
    proofHash,
    blockchain: {
      ...proofPayload.blockchain,
      recommendedAnchorPayload: `sha256:${proofHash}`,
    },
  };
}

function editEntryIdFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("edit") || "";
}

function previewUrlForEntry(entryId: string, animationName = "") {
  const url = new URL(`/p/${encodeURIComponent(entryId)}`, window.location.origin);
  if (animationName) url.searchParams.set("animation", animationName);
  return url.toString();
}

function cleanAssetVersion(value = "") {
  return value
    .trim()
    .replace(/[^a-z0-9._-]/gi, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function withAssetVersion(url: string, version = "") {
  const cleanVersion = cleanAssetVersion(version);
  if (!url || !cleanVersion || /[?&]v=/i.test(url) || !/\/assets\//i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(cleanVersion)}`;
}

function assetUrlForRepoPath(path: string, version = "") {
  return withAssetVersion(`${window.location.origin}/assets/${encodeRepoPath(path)}`, version);
}

function assetVersionForLibraryEntry(entry: LibraryEntry, fallback = "") {
  if (fallback === "webm" && entry.webmGeneratedAt) {
    return cleanAssetVersion(entry.webmGeneratedAt);
  }
  return cleanAssetVersion(
    entry.sourceProof?.proofHash ||
      entry.blockchainAnchor?.sourceProofHash ||
      entry.blockchainAnchor?.anchorHash ||
      entry.uploadedAt ||
      entry.id ||
      fallback,
  );
}

function safeLibraryAssetUrl(value = "") {
  const url = value.trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) && !/^data:/i.test(url) ? url : "";
}

function normalizeAssetDomain(url: string) {
  return url.replace(/https:\/\/vladleopold\.github\.io\/spine/gi, window.location.origin);
}

function derivedLibraryAssetUrl(entry: LibraryEntry, extensions: string[]) {
  const previewPath = cleanRepoPath(entry.previewPath || "");
  const files = Array.isArray(entry.files) ? entry.files : [];
  const file = files.find((fileName) => extensions.some((extension) => fileName.toLowerCase().endsWith(extension)));
  return previewPath && file ? assetUrlForRepoPath(joinRepoPath(previewPath, file), assetVersionForLibraryEntry(entry, file)) : "";
}

function generatedPosterUrlForEntry(entry: LibraryEntry) {
  return entry.id && /^data:image\/webp;base64,/i.test(entry.thumbnailPoster || "")
    ? assetUrlForRepoPath(`library/${entry.id}/generated-preview.webp`, assetVersionForLibraryEntry(entry, "generated-preview"))
    : "";
}

function generatedWebmUrlForEntry(entry: LibraryEntry) {
  return entry.id ? `${window.location.origin}/v_holder.webm` : "";
}

const metricsVisitorStorageKey = "spine-link-metrics-visitor";

function getStoredMetricsVisitorId() {
  try {
    const existing = window.localStorage.getItem(metricsVisitorStorageKey);
    if (existing) return existing;
    let generated = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    if (window.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      generated = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    window.localStorage.setItem(metricsVisitorStorageKey, generated);
    return generated;
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
}

function emptyEntryMetric(): EntryMetric {
  return { likes: 0, views: 0, liked: false };
}

function safePreviewFileName(name: string, fallback: string) {
  const cleaned = safePathSegment(name.replace(/\.[^.]+$/g, ""));
  return cleaned ? `${cleaned}-${fallback}` : fallback;
}

async function fileFromLibraryPath(entry: LibraryEntry, fileName: string) {
  const assetPath = joinRepoPath(entry.previewPath, fileName);
  const response = await fetch(`/assets/${encodeRepoPath(assetPath)}`);
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

function waitAnimationFrames(count = 1) {
  return new Promise<void>((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
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

function compositeImageDataOnBackground(rgba: Uint8ClampedArray, background: [number, number, number]) {
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3] / 255;
    if (alpha >= 1) continue;
    rgba[index] = Math.round(rgba[index] * alpha + background[0] * (1 - alpha));
    rgba[index + 1] = Math.round(rgba[index + 1] * alpha + background[1] * (1 - alpha));
    rgba[index + 2] = Math.round(rgba[index + 2] * alpha + background[2] * (1 - alpha));
    rgba[index + 3] = 255;
  }
}

async function createCanvasImageThumbnail(sourceCanvas?: HTMLCanvasElement | null, width = 360, height = 220) {
  if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return "";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";

  const scale = Math.min(width / sourceCanvas.width, height / sourceCanvas.height);
  const nextWidth = Math.max(1, Math.round(sourceCanvas.width * scale));
  const nextHeight = Math.max(1, Math.round(sourceCanvas.height * scale));
  const offsetX = Math.round((width - nextWidth) / 2);
  const offsetY = Math.round((height - nextHeight) / 2);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#050607";
  context.fillRect(0, 0, width, height);
  context.drawImage(sourceCanvas, offsetX, offsetY, nextWidth, nextHeight);
  return canvas.toDataURL("image/webp", 0.86);
}

type CanvasPreviewMedia = {
  poster: string;
  video: string;
  width: number;
  height: number;
  duration: number;
};

function evenDimension(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

type CanvasContentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function previewCanvasSize(bounds: CanvasContentBounds, maxWidth = 1280, maxHeight = 1280) {
  const sourceWidth = Math.max(1, bounds.width);
  const sourceHeight = Math.max(1, bounds.height);
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, Math.max(1, 720 / Math.min(sourceWidth, sourceHeight)));
  return {
    width: evenDimension(Math.min(maxWidth, sourceWidth * scale)),
    height: evenDimension(Math.min(maxHeight, sourceHeight * scale)),
  };
}

function sampleCanvasCornerBackground(data: Uint8ClampedArray, width: number, height: number): [number, number, number, number] {
  const sampleSize = Math.max(2, Math.min(16, Math.floor(Math.min(width, height) / 8)));
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;
  const samplePixel = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    red += data[index];
    green += data[index + 1];
    blue += data[index + 2];
    alpha += data[index + 3];
    count += 1;
  };

  for (let y = 0; y < sampleSize; y += 1) {
    for (let x = 0; x < sampleSize; x += 1) {
      samplePixel(x, y);
      samplePixel(width - 1 - x, y);
      samplePixel(x, height - 1 - y);
      samplePixel(width - 1 - x, height - 1 - y);
    }
  }

  return [red / count, green / count, blue / count, alpha / count];
}

function detectImageDataContentBounds(imageData: ImageData): CanvasContentBounds {
  const { width, height, data } = imageData;
  const fullBounds = { x: 0, y: 0, width, height };
  if (!width || !height) return fullBounds;

  const background = sampleCanvasCornerBackground(data, width, height);
  const backgroundLuma = background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      const rgbDistance =
        Math.abs(red - background[0]) +
        Math.abs(green - background[1]) +
        Math.abs(blue - background[2]);
      const alphaDistance = Math.abs(alpha - background[3]);
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      const isTransparentContent = background[3] < 32 ? alpha > 18 : alphaDistance > 80;
      const isVisibleVideoContent =
        alpha > 12 && rgbDistance > 72 && (luma > backgroundLuma + 24 || chroma > 28 || rgbDistance > 120);
      if (isTransparentContent || isVisibleVideoContent) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return fullBounds;

  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const padding = Math.max(2, Math.round(Math.max(contentWidth, contentHeight) * 0.015));
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(width, maxX + padding + 1);
  const bottom = Math.min(height, maxY + padding + 1);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function detectCanvasContentBounds(sourceCanvas: HTMLCanvasElement): CanvasContentBounds {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const fullBounds = { x: 0, y: 0, width, height };
  if (!width || !height) return fullBounds;

  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = width;
  probeCanvas.height = height;
  const probeContext = probeCanvas.getContext("2d", { willReadFrequently: true });
  if (!probeContext) return fullBounds;

  probeContext.clearRect(0, 0, width, height);
  probeContext.drawImage(sourceCanvas, 0, 0);

  let imageData: ImageData;
  try {
    imageData = probeContext.getImageData(0, 0, width, height);
  } catch {
    return fullBounds;
  }

  return detectImageDataContentBounds(imageData);
}

function drawCanvasPreviewFrame(
  context: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  sourceBounds: CanvasContentBounds,
) {
  const scale = Math.min(width / sourceBounds.width, height / sourceBounds.height);
  const nextWidth = Math.max(1, Math.round(sourceBounds.width * scale));
  const nextHeight = Math.max(1, Math.round(sourceBounds.height * scale));
  const offsetX = Math.round((width - nextWidth) / 2);
  const offsetY = Math.round((height - nextHeight) / 2);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#050607";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, sourceBounds.x, sourceBounds.y, sourceBounds.width, sourceBounds.height, offsetX, offsetY, nextWidth, nextHeight);
}

async function createCanvasPreviewMedia(
  sourceCanvas?: HTMLCanvasElement | null,
  durationSeconds = 1.8,
  restartAnimation?: () => void | Promise<void>,
): Promise<CanvasPreviewMedia> {
  const emptyPreview = { poster: "", video: "", width: 0, height: 0, duration: 0 };
  if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return emptyPreview;
  if (typeof MediaRecorder === "undefined") return emptyPreview;

  const supportedMimeTypes = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mimeType = supportedMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) return emptyPreview;

  try {
    await restartAnimation?.();
    await waitAnimationFrames(4);
    const sourceBounds = detectCanvasContentBounds(sourceCanvas);
    const { width, height } = previewCanvasSize(sourceBounds);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(0);
    if (!context || !stream) return emptyPreview;
    const frameTrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;

    drawCanvasPreviewFrame(context, sourceCanvas, width, height, sourceBounds);
    frameTrack?.requestFrame?.();
    const poster = canvas.toDataURL("image/webp", 0.94);

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: width * height >= 900_000 ? 4_800_000 : 3_200_000,
    });
    const framesPerSecond = 30;
    const captureDuration = Math.max(0.5, durationSeconds);
    const totalFrames = Math.max(1, Math.ceil(captureDuration * framesPerSecond));
    const frameDurationMs = 1000 / framesPerSecond;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<CanvasPreviewMedia>((resolve) => {
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        resolve({
          poster,
          video: chunks.length ? await blobToDataUri(new Blob(chunks, { type: "video/webm" })) : "",
          width,
          height,
          duration: captureDuration,
        });
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        resolve({ poster: "", video: "", width, height, duration: captureDuration });
      };
    });

    await restartAnimation?.();
    await waitAnimationFrames(1);
    drawCanvasPreviewFrame(context, sourceCanvas, width, height, sourceBounds);
    recorder.start(250);
    frameTrack?.requestFrame?.();
    const startedAt = performance.now();

    for (let frame = 1; frame <= totalFrames; frame += 1) {
      const targetTime = startedAt + frame * frameDurationMs;
      const delay = targetTime - performance.now();
      if (delay > 0) await wait(delay);
      drawCanvasPreviewFrame(context, sourceCanvas, width, height, sourceBounds);
      frameTrack?.requestFrame?.();
    }
    drawCanvasPreviewFrame(context, sourceCanvas, width, height, sourceBounds);
    frameTrack?.requestFrame?.();
    await wait(180);
    recorder.stop();
    return stopped;
  } catch {
    return emptyPreview;
  }
}

function currentAnimationDurationSeconds(player: SpinePlayerInstance | null) {
  const current = (player as PlayerWithLoopControls | null)?.animationState?.getCurrent?.(0);
  const duration = Number(current?.animation?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 1.8;
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

function isWebmPreview(value = "") {
  return /^https:\/\/[^\s"'<>]+\.webm(?:[?#][^\s"'<>]*)?$/i.test(value);
}

async function loadFiles(files: File[]) {
  const usefulFiles = files.filter((file) => isSkeletonFile(file) || isAtlasFile(file) || isImageFile(file));

  if (usefulFiles.length < 3) {
    throw new Error("You need at least skeleton .json/.skel, .atlas, and texture .png/.webp/.jpg.");
  }

  const assets = await Promise.all(
    usefulFiles.map(async (file): Promise<LoadedAsset> => {
      const text = isAtlasFile(file) ? await readAtlasText(file) : extensionOf(file.name) === "json" ? await readAsText(file) : undefined;
      const binaryBuffer = extensionOf(file.name) === "skel" ? await readAsArrayBuffer(file) : undefined;
      const skeletonVersion = binaryBuffer ? spineBinaryVersionFromBuffer(binaryBuffer) : spineSkeletonVersionFromText(text);
      let dataUri =
        binaryBuffer && /^(3\.8|4\.)/.test(skeletonVersion)
          ? sanitizedSkelDataUriFromBuffer(binaryBuffer, skeletonVersion)
          : binaryBuffer
            ? `data:application/octet-stream;base64,${bytesToBase64FromBytes(new Uint8Array(binaryBuffer))}`
            : await readAsDataUri(file);
      const transparentizedImage = isImageFile(file) ? await readAsTransparentizedImageDataUri(file) : undefined;

if (extensionOf(file.name) === "json" && text) {
         const decodedJson = sanitizeSkeletonData(stripPackedPlaceholders(decodePackedSkeletonJson(text)));
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
        skeletonVersion,
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
        extensionOf(skeleton.file.name) === "json" ? sanitizeSkeletonData(stripPackedPlaceholders(decodePackedSkeletonJson(skeleton.text))) : null;
      const animationNames =
        skeletonJson && typeof skeletonJson === "object" && "animations" in skeletonJson
          ? Object.keys((skeletonJson as { animations?: Record<string, unknown> }).animations ?? {})
          : [];
      const defaultAnimation =
        animationNames.find((animationName) => animationName.toLowerCase() === "idle") ??
        animationNames.find((animationName) => animationName.toLowerCase().includes("idle")) ??
        animationNames.find((animationName) => !animationName.toLowerCase().startsWith("eyes")) ??
        animationNames[0];
      const skinNames = skinNamesFromSkeletonJson(skeletonJson);
      const defaultSkin = preferredSkinName(skinNames);
      const skeletonBounds =
        skeletonJson && typeof skeletonJson === "object" && "skeleton" in skeletonJson
          ? (skeletonJson as { skeleton?: Partial<PreparedSpine["viewport"]> }).skeleton
          : undefined;
      const skeletonViewport =
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
      const viewport = skeletonViewport?.width && skeletonViewport.height ? skeletonViewport : fallbackViewportFromAtlas(atlas.text);

      for (const pageName of atlasPages) {
        const canonicalPageName = canonicalAtlasPageName(pageName);
        const pageBase = canonicalPageName.toLowerCase();
        const matchedImage =
          images.find((imageAsset) => imageMatchesAtlasPage(imageAsset.file.name, pageName)) ??
          (images.length === 1 ? images[0] : undefined);

        if (matchedImage) {
          if (!premultipliedAlpha && matchedImage.hasBlackMatte) usesRebuiltStraightAlphaTexture = true;
          const imageDataUri = premultipliedAlpha
            ? await transparentizeAtlasEffectRegions(matchedImage.dataUri, atlas.text, pageName)
            : matchedImage.transparentizedDataUri ?? matchedImage.dataUri;
          rawDataURIs[matchedImage.file.name] = imageDataUri;
          rawDataURIs[basename(matchedImage.file.name)] = imageDataUri;
          rawDataURIs[canonicalPageName] = imageDataUri;
          rawDataURIs[pageName] = imageDataUri;
        } else {
          rawDataURIs[canonicalPageName] = transparentPngDataUri;
          rawDataURIs[pageName] = transparentPngDataUri;
        }
      }

      const atlasTextForPreview = atlasTextWithCanonicalPageNames(
        usesRebuiltStraightAlphaTexture && !premultipliedAlpha && atlas.text
          ? atlasTextWithPremultipliedAlpha(atlas.text, false)
          : atlas.text,
      );

      if (atlasTextForPreview) {
        const fixedAtlasDataUri = textDataUri("text/plain", atlasTextForPreview);
        rawDataURIs[atlas.file.name] = fixedAtlasDataUri;
        rawDataURIs[basename(atlas.file.name)] = fixedAtlasDataUri;
      }

      return {
        label: skeletonStem,
        skeletonName: skeleton.file.name,
        atlasName: atlas.file.name,
      atlasPages,
      skeletonVersion: skeleton.skeletonVersion,
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
  if (!player || !animationName) return false;

  disablePlayerMix(player);
  let trackEntry: ReturnType<SpinePlayerInstance["setAnimation"]>;
  try {
    trackEntry = player.setAnimation(animationName, isLoopEnabled);
  } catch (error) {
    console.warn(`Could not play Spine animation "${animationName}".`, error);
    return false;
  }

  if (trackEntry) {
    (trackEntry as { mixDuration?: number; mixTime?: number }).mixDuration = 0;
    (trackEntry as { mixDuration?: number; mixTime?: number }).mixTime = 0;
    trackEntry.listener = {
      ...trackEntry.listener,
      complete: () => {
        if (!isLoopEnabledNow()) player.pause();
      },
    };
  }
  player.play();
  return true;
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

function ParticleField({ mode = "rich" }: { mode?: "quiet" | "rich" }) {
  return null;
}

export function App({ initialFiles, initialOpenLibrary = false, initialLogin = false, initialUpload = false }: AppProps) {
  const isEditPage = Boolean(editEntryIdFromLocation());
  const playerRef = useRef<SpinePlayerInstance | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const homeUploadInputRef = useRef<HTMLInputElement | null>(null);
  const homeFeedRef = useRef<HTMLDivElement | null>(null);
  const googleTokenClientRef = useRef<GoogleTokenClient | null>(null);
  const baseViewportRef = useRef<PlayerViewport | null>(null);
  const playerCanvasSizeRef = useRef({ width: 1, height: 1 });
  const pinchDistanceRef = useRef<number | null>(null);
  const panPositionRef = useRef<{ x: number; y: number } | null>(null);
  const touchPanPositionRef = useRef<{ x: number; y: number } | null>(null);
  const publishedKeysRef = useRef<Set<string>>(new Set());
  const isPublishingRef = useRef(false);
  const zoomRef = useRef(1);
  const loopEnabledRef = useRef(true);
  const activeAnimationRef = useRef("");
  const animationsRef = useRef<string[]>([]);
  const preparedSpineRef = useRef<PreparedSpine | null>(null);
  const initialOpenLibraryRef = useRef(initialOpenLibrary);
  const initialLoginRef = useRef(initialLogin);
  const initialUploadRef = useRef(initialUpload);
  const [spineOptions, setSpineOptions] = useState<PreparedSpine[]>([]);
  const [extraSpineSets, setExtraSpineSets] = useState<ExtraSpinePlayer[]>([]);
  const [preparedSpine, setPreparedSpine] = useState<PreparedSpine | null>(null);
  const [animations, setAnimations] = useState<string[]>([]);
  const [activeAnimation, setActiveAnimation] = useState("");
  const [zoom, setZoom] = useState(1);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [anonymousAccount] = useState<AnonymousAccount>(() => getStoredAnonymousAccount());
  const [activeTreeDrawer, setActiveTreeDrawer] = useState<"render" | "zoom" | null>(null);
  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState("");
  const [isPublishingLink, setIsPublishingLink] = useState(false);
  const [publishProgress, setPublishProgress] = useState({ isOpen: false, value: 0, label: "" });
  const [isLinkBannerOpen, setIsLinkBannerOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [selectedPreviewImage, setSelectedPreviewImage] = useState("");
  const [selectedCardSize, setSelectedCardSize] = useState<LibraryCardSize>("auto");
  const [previewNote, setPreviewNote] = useState("");
  const [previewNoteStatus, setPreviewNoteStatus] = useState("");
  const [currentLibraryEntry, setCurrentLibraryEntry] = useState<LibraryEntry | null>(null);
  const [status, setStatus] = useState("Drop three Spine files here: json, atlas, and texture.");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isIntroDocking, setIsIntroDocking] = useState(false);
  const [isUploadPage, setIsUploadPage] = useState(initialUpload);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(() => readStoredGoogleSession()?.user ?? null);
  const [googleIdToken, setGoogleIdToken] = useState(() => getValidStoredGoogleToken());
  const [profileNameInput, setProfileNameInput] = useState(() => cleanAccountDisplayName(readStoredGoogleSession()?.user?.name || ""));
  const [isSavingProfileName, setIsSavingProfileName] = useState(false);
  const [isSkeletonUploadTipVisible, setIsSkeletonUploadTipVisible] = useState(
    () => !hasDismissedSkeletonUploadTip(googleUser, anonymousAccount),
  );
  const [googleAuthError, setGoogleAuthError] = useState("");
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([]);
  const [homeFeedEntries, setHomeFeedEntries] = useState<HomeFeedEntry[]>([]);
  const [entryMetrics, setEntryMetrics] = useState<Record<string, EntryMetric>>({});
  const [metricsVisitorId] = useState(() => getStoredMetricsVisitorId());
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [isPortfolioMode, setIsPortfolioMode] = useState(false);
  const [portfolioSearch, setPortfolioSearch] = useState("");
  const [portfolioFilter, setPortfolioFilter] = useState<"all" | "visible" | "hidden">("all");
  const [portfolioSort, setPortfolioSort] = useState<"curated" | "newest" | "name">("curated");
  const [showProfileOnSharedPages, setShowProfileOnSharedPages] = useState(() => readStoredProfileVisibility());
  const [profileVisibilityStatus, setProfileVisibilityStatus] = useState("");
  const [renderSettingsByLabel, setRenderSettingsByLabel] = useState<Record<string, SkeletonRenderSettings>>({});
  const visiblePortfolioEntries = useMemo(() => {
    const search = portfolioSearch.trim().toLowerCase();
    const filteredEntries = libraryEntries.filter((entry) => {
      if (portfolioFilter === "visible" && entry.hiddenFromPublicLibrary) return false;
      if (portfolioFilter === "hidden" && !entry.hiddenFromPublicLibrary) return false;
      if (!search) return true;
      return [entry.title, entry.skeleton, entry.defaultAnimation, entry.note, ...(entry.animations || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    });

    return [...filteredEntries].sort((a, b) => {
      if (portfolioSort === "name") return (a.title || a.id).localeCompare(b.title || b.id);
      if (portfolioSort === "newest") return new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime();
      return compareLibraryEntries(a, b);
    });
  }, [libraryEntries, portfolioFilter, portfolioSearch, portfolioSort]);
  const portfolioStats = useMemo(
    () => ({
      total: libraryEntries.length,
      visible: libraryEntries.filter((entry) => !entry.hiddenFromPublicLibrary).length,
      animations: libraryEntries.reduce((total, entry) => total + (entry.animations?.length ?? 0), 0),
    }),
    [libraryEntries],
  );

  useEffect(() => {
    const ids = Array.from(new Set(libraryEntries.map((entry) => entry.id).filter(Boolean)));
    if (!ids.length) {
      setEntryMetrics({});
      return;
    }

    let cancelled = false;
    fetch("/api/github-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "get-metrics",
        ids,
        visitorId: metricsVisitorId,
      }),
    })
      .then((response) => response.json().then((payload) => ({ response, payload })).catch(() => ({ response, payload: {} })))
      .then(({ response, payload }) => {
        if (cancelled || !response.ok || !payload.metrics) return;
        setEntryMetrics((currentMetrics) => ({ ...currentMetrics, ...payload.metrics }));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [libraryEntries, metricsVisitorId]);

  useEffect(() => {
    if (isEditPage) return;
    let cancelled = false;

    const applyHomeFeedEntries = (entries: HomeFeedEntry[]) => {
      const nextEntries = entries
        .filter((entry: HomeFeedEntry) => entry?.id && entry?.previewUrl)
        .slice(0, 32);
      setHomeFeedEntries(nextEntries);
      setEntryMetrics((currentMetrics) => {
        const nextMetrics = { ...currentMetrics };
        nextEntries.forEach((entry: HomeFeedEntry) => {
          if (entry.metrics) nextMetrics[entry.id] = entry.metrics;
        });
        return nextMetrics;
      });
    };

    try {
      const cached = JSON.parse(window.sessionStorage.getItem("spine-link-home-feed-cache") || "null") as {
        savedAt?: number;
        entries?: HomeFeedEntry[];
      } | null;
      if (cached?.savedAt && Date.now() - cached.savedAt < 5 * 60 * 1000 && Array.isArray(cached.entries)) {
        applyHomeFeedEntries(cached.entries);
      }
    } catch {
      // Session cache is only a speed hint.
    }

    fetch("/api/github-archive?feed=home")
      .then((response) => response.json().then((payload) => ({ response, payload })).catch(() => ({ response, payload: {} })))
      .then(({ response, payload }) => {
        if (cancelled || !response.ok || !Array.isArray(payload.entries)) return;
        const nextEntries = payload.entries
          .filter((entry: HomeFeedEntry) => entry?.id && entry?.previewUrl)
          .slice(0, 32);
        applyHomeFeedEntries(nextEntries);
        try {
          window.sessionStorage.setItem("spine-link-home-feed-cache", JSON.stringify({ savedAt: Date.now(), entries: nextEntries }));
        } catch {
          // Session cache is optional.
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isEditPage]);

  useEffect(() => {
    const root = homeFeedRef.current;
    if (!root || !homeFeedEntries.length) return;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    if (prefersReducedMotion || saveData) return;

    const videos = Array.from(root.querySelectorAll<HTMLVideoElement>(".home-feed-video"));
    if (!videos.length) return;

    const visibleVideos = new Set<HTMLVideoElement>();
    const manualVideos = new WeakSet<HTMLVideoElement>();
    let chaosTimer = 0;

    const playVideo = (video: HTMLVideoElement) => {
      if (!video.currentSrc && !video.src) return;
      video.muted = true;
      video.loop = false;
      video.playsInline = true;
      try {
        video.currentTime = 0;
      } catch {}
      void video.play().catch(() => undefined);
    };

    const stopVideo = (video: HTMLVideoElement) => {
      video.pause();
      video.onended = null;
      try {
        video.currentTime = 0;
      } catch {}
    };

    const randomSample = <T,>(items: T[], count: number) =>
      items
        .map((item) => ({ item, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .slice(0, count)
        .map((entry) => entry.item);

    const scheduleChaos = () => {
      window.clearTimeout(chaosTimer);
      chaosTimer = window.setTimeout(runChaos, 3000 + Math.random() * 4000);
    };

    const runChaos = () => {
      const videos = Array.from(visibleVideos).filter((video) => video.isConnected && (video.currentSrc || video.src));
      if (!videos.length) {
        scheduleChaos();
        return;
      }
      const activeLimit = Math.min(2, Math.max(1, Math.ceil(videos.length * 0.25)));
      randomSample(
        videos.filter((video) => !video.paused && !manualVideos.has(video)),
        videos.length,
      )
        .slice(activeLimit)
        .forEach(stopVideo);
      randomSample(
        videos.filter((video) => video.paused && !manualVideos.has(video)),
        activeLimit,
      ).forEach((video) => {
        if (Math.random() < 0.7) {
          playVideo(video);
          window.setTimeout(() => {
            if (!manualVideos.has(video) && visibleVideos.has(video) && Math.random() < 0.85) stopVideo(video);
          }, 500 + Math.random() * 2000);
        }
      });
      scheduleChaos();
    };

    let observer: IntersectionObserver | null = null;
    const cards = root.querySelectorAll<HTMLAnchorElement>(".home-feed-card");
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const video = entry.target.querySelector<HTMLVideoElement>(".home-feed-video");
            if (!video) return;
            if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
              visibleVideos.add(video);
              if (video.readyState < 1) {
                video.preload = "metadata";
                video.load();
              }
            } else {
              visibleVideos.delete(video);
              if (!manualVideos.has(video)) stopVideo(video);
            }
          });
          scheduleChaos();
        },
        { threshold: [0, 0.4, 0.7, 1] },
      );
      cards.forEach((card) => observer?.observe(card));
    } else {
      cards.forEach((card) => {
        const video = card.querySelector<HTMLVideoElement>(".home-feed-video");
        if (video) visibleVideos.add(video);
      });
      scheduleChaos();
    }

    return () => {
      window.clearTimeout(chaosTimer);
      observer?.disconnect();
    };
  }, [homeFeedEntries]);

  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".library-card"));
    if (!cards.length) return;

    const visibleVideos = new Set<HTMLVideoElement>();
    const manualVideos = new WeakSet<HTMLVideoElement>();
    const hoverTimers = new WeakMap<HTMLVideoElement, number>();
    const cleanups: Array<() => void> = [];
    let chaosTimer = 0;

    const stopVideo = (video: HTMLVideoElement) => {
      video.pause();
      video.onended = null;
      try {
        video.currentTime = 0;
      } catch {
        // Some browsers block seeking before metadata is ready.
      }
    };

    const playVideo = (video: HTMLVideoElement) => {
      if (!video.currentSrc && !video.src) return;
      video.muted = true;
      video.loop = false;
      video.playsInline = true;
      try {
        video.currentTime = 0;
      } catch {
        // Some browsers block seeking before metadata is ready.
      }
      void video.play().catch(() => undefined);
    };

    const clearHoverTimer = (video: HTMLVideoElement) => {
      const timer = hoverTimers.get(video);
      if (timer) window.clearTimeout(timer);
      hoverTimers.delete(video);
    };

    const startHoverLoop = (video: HTMLVideoElement) => {
      manualVideos.add(video);
      clearHoverTimer(video);
      video.onended = () => {
        const timer = window.setTimeout(() => {
          if (!manualVideos.has(video)) return;
          try {
            video.currentTime = 0;
          } catch {
            // Some browsers block seeking before metadata is ready.
          }
          playVideo(video);
        }, 1000);
        hoverTimers.set(video, timer);
      };
      playVideo(video);
    };

    const stopHoverLoop = (video: HTMLVideoElement) => {
      manualVideos.delete(video);
      clearHoverTimer(video);
      stopVideo(video);
    };

    const randomSample = <T,>(items: T[], count: number) =>
      items
        .map((item) => ({ item, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .slice(0, count)
        .map((entry) => entry.item);

    const scheduleChaos = () => {
      window.clearTimeout(chaosTimer);
    };

    const runChaos = () => {
      const videos = Array.from(visibleVideos).filter((video) => video.isConnected && (video.currentSrc || video.src));
      if (!videos.length) {
        scheduleChaos();
        return;
      }
      const activeLimit = Math.min(2, Math.max(1, Math.ceil(videos.length * 0.2)));
      randomSample(
        videos.filter((video) => !video.paused && !manualVideos.has(video)),
        videos.length,
      )
        .slice(activeLimit)
        .forEach(stopVideo);
      randomSample(
        videos.filter((video) => video.paused && !manualVideos.has(video)),
        activeLimit,
      ).forEach((video) => {
        if (Math.random() < 0.76) {
          playVideo(video);
          window.setTimeout(() => {
            if (!manualVideos.has(video) && visibleVideos.has(video) && Math.random() < 0.88) stopVideo(video);
          }, 460 + Math.random() * 2100);
        }
      });
      videos.forEach((video) => {
        if (!manualVideos.has(video) && !video.paused && Math.random() < 0.28) stopVideo(video);
      });
      scheduleChaos();
    };

    cards.forEach((card) => {
      const video = card.querySelector<HTMLVideoElement>(".library-card-webm");
      if (!video) return;
      const handleEnter = () => startHoverLoop(video);
      const handleLeave = () => stopHoverLoop(video);
      card.addEventListener("pointerenter", handleEnter);
      card.addEventListener("focusin", handleEnter);
      card.addEventListener("pointerleave", handleLeave);
      card.addEventListener("focusout", handleLeave);
      cleanups.push(() => {
        card.removeEventListener("pointerenter", handleEnter);
        card.removeEventListener("focusin", handleEnter);
        card.removeEventListener("pointerleave", handleLeave);
        card.removeEventListener("focusout", handleLeave);
      });
    });

    let observer: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const video = entry.target.querySelector<HTMLVideoElement>(".library-card-webm");
            if (!video) return;
            if (entry.isIntersecting && entry.intersectionRatio >= 0.42) {
              visibleVideos.add(video);
              if (video.readyState < 1) {
                video.preload = "metadata";
                video.load();
              }
            } else {
              visibleVideos.delete(video);
              if (!manualVideos.has(video)) stopVideo(video);
            }
          });
          scheduleChaos();
        },
        { threshold: [0, 0.42, 0.68, 1] },
      );
      cards.forEach((card) => observer?.observe(card));
    } else {
      cards.forEach((card) => {
        const video = card.querySelector<HTMLVideoElement>(".library-card-webm");
        if (video) visibleVideos.add(video);
      });
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        window.clearTimeout(chaosTimer);
        visibleVideos.forEach((video) => {
          if (!manualVideos.has(video)) stopVideo(video);
        });
      } else {
        scheduleChaos();
      }
    };
    const handlePageHide = () => {
      window.clearTimeout(chaosTimer);
      visibleVideos.forEach(stopVideo);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    scheduleChaos();

    return () => {
      window.clearTimeout(chaosTimer);
      visibleVideos.forEach(stopVideo);
      cleanups.forEach((cleanup) => cleanup());
      observer?.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [isLibraryOpen, visiblePortfolioEntries]);

  useEffect(() => {
    if (!publishProgress.isOpen || publishProgress.value >= 95) return;

    const duration = 4000 + Math.random() * 4000;
    const startedAt = performance.now();
    const startedValue = publishProgress.value;
    const targetValue = 95;
    let animationFrame = 0;

    const tick = (time: number) => {
      const elapsed = Math.min(1, (time - startedAt) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 2.6);
      setPublishProgress((current) => {
        if (!current.isOpen || current.value >= targetValue) return current;
        return { ...current, value: Math.max(current.value, Math.round(startedValue + (targetValue - startedValue) * eased)) };
      });
      if (elapsed < 1) animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [publishProgress.isOpen]);
  const publicLibraryOwnerId = useMemo(
    () => libraryEntries.find((entry) => entry.publicOwnerId)?.publicOwnerId || publicOwnerIdFor(googleUser, anonymousAccount),
    [anonymousAccount, googleUser, libraryEntries],
  );
  const publicLibraryUrl = useMemo(
    () => new URL(`/u/${encodeURIComponent(publicLibraryOwnerId)}`, window.location.origin).toString(),
    [publicLibraryOwnerId],
  );
  const accountDisplayName = useMemo(
    () => cleanAccountDisplayName(profileNameInput || googleUser?.name || libraryEntries.find((entry) => entry.ownerName)?.ownerName || ""),
    [googleUser?.name, libraryEntries, profileNameInput],
  );
  const isPublishProgressCompact = Boolean(preparedSpine && animations.length);

  useEffect(() => {
    const savedOwnerName = cleanAccountDisplayName(libraryEntries.find((entry) => entry.ownerName)?.ownerName || "");
    if (!savedOwnerName) return;
    const currentInput = cleanAccountDisplayName(profileNameInput);
    const googleName = cleanAccountDisplayName(googleUser?.name || "");
    if (currentInput && currentInput !== googleName) return;
    setProfileNameInput(savedOwnerName);
    if (googleUser && googleName !== savedOwnerName) {
      const nextGoogleUser = { ...googleUser, name: savedOwnerName };
      setGoogleUser(nextGoogleUser);
      updateStoredGoogleUser(nextGoogleUser);
    }
  }, [googleUser, libraryEntries, profileNameInput]);

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
    if (!currentLibraryEntry) return;
    setSelectedPreviewImage(
      currentLibraryEntry.thumbnailPoster ||
        currentLibraryEntry.thumbnail ||
        generatedPosterUrlForEntry(currentLibraryEntry) ||
        "",
    );
    setSelectedCardSize(currentLibraryEntry.cardSize || "auto");
  }, [currentLibraryEntry]);

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

  useEffect(() => {
    setIsSkeletonUploadTipVisible(!hasDismissedSkeletonUploadTip(googleUser, anonymousAccount));
  }, [anonymousAccount, googleUser]);

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
  const shouldShowSkeletonUploadTip = isSkeletonUploadTipVisible && !preparedSpine && !isEditPage;

  const configuredSpine = useMemo(
    () => (preparedSpine ? applySkeletonRenderSettings(preparedSpine, activeRenderSettings) : null),
    [activeRenderSettings, preparedSpine],
  );

  const dismissSkeletonUploadTip = () => {
    storeDismissedSkeletonUploadTip(googleUser, anonymousAccount);
    setIsSkeletonUploadTipVisible(false);
  };

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
    playerRef.current?.dispose?.();
    playerRef.current = null;
    baseViewportRef.current = null;
    playerCanvasSizeRef.current = { width: 1, height: 1 };
    if (playerHostRef.current) playerHostRef.current.innerHTML = "";
  }, []);

  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      const msg = event.message ?? "";
      if (msg.includes("Region not set") || msg.includes("Region not found")) {
        event.preventDefault();
      }
    };
    window.addEventListener("error", handler);
    return () => window.removeEventListener("error", handler);
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
    if (playAnimationWithLoopMode(playerRef.current, animationName, loopEnabledRef.current, () => loopEnabledRef.current)) {
      setActiveAnimation(animationName);
      setError("");
    } else if (animationName) {
      setError(`Animation bounds are invalid: ${animationName}.`);
      setStatus("Choose another animation.");
    }
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
    const player = playerRef.current as unknown as PlayerWithViewport | null;
    const baseViewport = baseViewportRef.current;
    const currentViewport = player?.currentViewport;
    if (!currentViewport || !baseViewport) return;

    const totalWidth = currentViewport.width + currentViewport.padLeft + currentViewport.padRight;
    const totalHeight = currentViewport.height + currentViewport.padTop + currentViewport.padBottom;
    const { width: canvasWidth, height: canvasHeight } = playerCanvasSizeRef.current;
    const worldDeltaX = (deltaX / Math.max(1, canvasWidth)) * totalWidth;
    const worldDeltaY = (deltaY / Math.max(1, canvasHeight)) * totalHeight;
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
      if (preparedSpine && !isEditPage) {
        if (extraSpineSets.length >= 9) {
          setError("You can add up to 10 players on one page.");
          setStatus("Extra player limit reached.");
          setIsDragging(false);
          return;
        }
        setStatus("Reading files for an extra player...");
        setError("");
        try {
          const nextSpineOptions = await loadFiles(Array.from(fileList));
          const nextSpine = chooseInitialSet(nextSpineOptions);
          if (!nextSpine) throw new Error("Could not create an extra player from these files.");
          const nextAnimations = nextSpine.animations.length ? nextSpine.animations : [nextSpine.defaultAnimation || "animation"].filter(Boolean);
          const nextActiveAnimation = nextSpine.defaultAnimation && nextAnimations.includes(nextSpine.defaultAnimation) ? nextSpine.defaultAnimation : nextAnimations[0] || "";
          setExtraSpineSets((currentSets) => [
            ...currentSets,
            {
              id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              set: nextSpine,
              animations: nextAnimations,
              activeAnimation: nextActiveAnimation,
            },
          ]);
          setStatus(`Extra player added. Total extra players: ${extraSpineSets.length + 1}.`);
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Could not prepare extra Spine files.");
          setStatus("Extra player upload stopped.");
        } finally {
          setIsDragging(false);
        }
        return;
      }

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
        setSelectedCardSize("auto");
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
    [extraSpineSets.length, isEditPage, preparedSpine, resetPlayer],
  );

  const handleSelectedFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      setIsDragging(false);
      setError("");
      setStatus(`Selected ${files.length} file${files.length === 1 ? "" : "s"}. Reading files locally...`);
      void prepareFromFiles(files);
    },
    [prepareFromFiles],
  );

  useEffect(() => {
    window.__spineLinkReceiveFiles = handleSelectedFiles;
    return () => {
      if (window.__spineLinkReceiveFiles === handleSelectedFiles) {
        window.__spineLinkReceiveFiles = undefined;
      }
    };
  }, [handleSelectedFiles]);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const files = Array.from(input.files ?? []);
      window.setTimeout(() => {
        input.value = "";
      }, 0);
      handleSelectedFiles(files);
    },
    [handleSelectedFiles],
  );

  const clearFileInputBeforePick = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    event.currentTarget.value = "";
  }, []);

  useEffect(() => {
    const handleDocumentDrop = (event: DragEvent) => {
      const hasFiles = Array.from(event.dataTransfer?.types ?? []).includes("Files");
      if (!hasFiles) return;
      event.preventDefault();
    };

    document.addEventListener("drop", handleDocumentDrop, true);
    return () => {
      document.removeEventListener("drop", handleDocumentDrop, true);
    };
  }, []);

  useEffect(() => {
    const disposers: Array<() => void> = [];
    const mountedPlayers: Array<SpinePlayerInstance> = [];
    let isCancelled = false;

    const mountExtraPlayers = async () => {
      if (!extraSpineSets.length) return;
      if (isCancelled) return;
      const hosts = Array.from(document.querySelectorAll<HTMLDivElement>(".extra-player-host[data-extra-player-id]"));
      for (const host of hosts) {
        const setId = host.dataset.extraPlayerId || "";
        const extraSet = extraSpineSets.find((candidate) => candidate.id === setId);
        const prepared = extraSet?.set;
        if (!prepared) continue;
        const { SpinePlayer } = await loadSpinePlayerForSet(prepared);
        if (isCancelled) return;
        host.innerHTML = "";
        const player = new SpinePlayer(host, {
          skeleton: prepared.skeletonName,
          ...(extensionOf(prepared.skeletonName) === "skel" ? { skelUrl: prepared.skeletonName } : { jsonUrl: prepared.skeletonName }),
          atlas: prepared.atlasName,
          atlasUrl: prepared.atlasName,
          rawDataURIs: prepared.rawDataURIs,
          animation: extraSet?.activeAnimation || prepared.defaultAnimation,
          ...(prepared.defaultSkin ? { skin: prepared.defaultSkin } : {}),
          premultipliedAlpha: prepared.premultipliedAlpha,
          showControls: true,
          showLoading: true,
          alpha: true,
          preserveDrawingBuffer: true,
          backgroundColor: "00000000",
        } as unknown as SpinePlayerConfig);
        mountedPlayers.push(player as unknown as SpinePlayerInstance);
      }
    };

    void mountExtraPlayers();
    return () => {
      isCancelled = true;
      disposers.forEach((dispose) => dispose());
      mountedPlayers.forEach((player) => player.dispose?.());
    };
  }, [extraSpineSets]);

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
    const fetchLibraryAction = async (action: "get-index" | "get-entry") => {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;
      return fetch("/api/github-upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          action,
          googleIdToken,
          anonymousAccount,
          settings: githubPublishSettings,
          ...(action === "get-entry" ? { entryId: editEntryId } : {}),
        }),
      });
    };

    const loadEditableEntry = async () => {
      setIsLoading(true);
      setError("");
      setStatus("Loading editable preview...");
      try {
        let response = await fetchLibraryAction("get-index");
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
        let entry = (Array.isArray(result.entries) ? result.entries : []).find(
          (candidate: LibraryEntry) => candidate.id === editEntryId,
        ) as LibraryEntry | undefined;
        if (!entry) {
          response = await fetchLibraryAction("get-entry");
          const entryResult = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(typeof entryResult?.error === "string" ? entryResult.error : `Library API ${response.status}`);
          entry = entryResult.entry as LibraryEntry | undefined;
        }
        if (!entry) throw new Error("This preview is not in the library.");
        const entryFiles = Array.isArray(entry.files) ? entry.files : [];
        if (!entryFiles.length) throw new Error("This preview has no editable files.");
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
        setSelectedCardSize(entry.cardSize || "auto");
        setGeneratedPreviewUrl(previewUrlForEntry(entry.id, entry.defaultAnimation || nextSpine?.defaultAnimation || ""));
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
    const config = {
      skeleton: configuredSpine.skeletonName,
      ...(extensionOf(configuredSpine.skeletonName) === "skel" ? { skelUrl: configuredSpine.skeletonName } : { jsonUrl: configuredSpine.skeletonName }),
      atlas: configuredSpine.atlasName,
      atlasUrl: configuredSpine.atlasName,
      rawDataURIs: configuredSpine.rawDataURIs,
      animation: configuredSpine.defaultAnimation,
      ...(configuredSpine.defaultSkin ? { skin: configuredSpine.defaultSkin } : {}),
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
      success: (player: SpinePlayerInstance) => {
        const names = player.skeleton?.data.animations.map((animation: { name: string }) => animation.name) ?? [];
        const initialAnimation = configuredSpine.defaultAnimation && names.includes(configuredSpine.defaultAnimation) ? configuredSpine.defaultAnimation : names[0];
        const playableAnimation =
          initialAnimation && playAnimationWithLoopMode(player, initialAnimation, loopEnabledRef.current, () => loopEnabledRef.current)
            ? initialAnimation
            : names.find((animationName: string) => playAnimationWithLoopMode(player, animationName, loopEnabledRef.current, () => loopEnabledRef.current));
        setAnimations(names);
        setActiveAnimation(playableAnimation ?? initialAnimation ?? "");
        if (playableAnimation) {
          installLoopButton(player, loopEnabledRef.current, toggleLoopEnabled, playActiveAnimationFromStart);
          rememberCurrentViewport();
          applyZoomToPlayer(zoomRef.current, false);
          if (!currentLibraryEntry) void publishToGitHub(configuredSpine, names, playableAnimation);
        } else if (initialAnimation) {
          setError(`Animation bounds are invalid: ${initialAnimation}.`);
        }
        setStatus(
          playableAnimation
            ? `Ready. Animations found: ${names.length}. Creating permanent link...`
            : names.length
              ? "Ready, but the available animations have invalid bounds."
            : "Ready, but the animation list is empty.",
        );
      },
      error: (_player: SpinePlayerInstance, message: unknown) => {
        const runtimeMessage = message as unknown;
        setError(runtimeMessage instanceof Error ? runtimeMessage.message : String(runtimeMessage || "Spine runtime could not open these files."));
        setStatus("Preview error.");
      },
    } as unknown as SpinePlayerConfig;

    void loadSpinePlayerForSet(configuredSpine)
      .then(({ SpinePlayer }) => {
        if (isCancelled || !playerHostRef.current) return;
        playerRef.current = new SpinePlayer(playerHostRef.current, config);
        const playerCanvas = (playerRef.current as unknown as { canvas?: HTMLCanvasElement | null }).canvas;
        if (playerCanvas) {
          playerCanvasSizeRef.current = {
            width: playerCanvas.clientWidth || playerCanvas.width || 1,
            height: playerCanvas.clientHeight || playerCanvas.height || 1,
          };
        }
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

  useEffect(() => {
    const host = playerHostRef.current;
    if (!host) return;

    const updateCanvasSize = () => {
      const playerCanvas = (playerRef.current as unknown as { canvas?: HTMLCanvasElement | null } | null)?.canvas;
      if (!playerCanvas) return;

      playerCanvasSizeRef.current = {
        width: playerCanvas.clientWidth || playerCanvas.width || 1,
        height: playerCanvas.clientHeight || playerCanvas.height || 1,
      };
    };

    updateCanvasSize();
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        updateCanvasSize();
        return;
      }
      playerCanvasSizeRef.current = {
        width: entry.contentRect.width || playerCanvasSizeRef.current.width || 1,
        height: entry.contentRect.height || playerCanvasSizeRef.current.height || 1,
      };
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
    };
  }, [preparedSpine]);

  const selectAnimation = (animationName: string) => {
    if (!playAnimationWithLoopMode(playerRef.current, animationName, loopEnabledRef.current, () => loopEnabledRef.current)) {
      setError(`Animation bounds are invalid: ${animationName}.`);
      setStatus("Choose another animation.");
      return;
    }

    setActiveAnimation(animationName);
    setError("");
    applyZoomToPlayer(zoomRef.current, false);
    window.setTimeout(() => {
      const canvas = (playerRef.current as unknown as { canvas?: HTMLCanvasElement | null } | null)?.canvas;
      if (!canvas) return;
      try {
        setSelectedPreviewImage(canvas.toDataURL("image/webp", 0.72));
      } catch {
        setSelectedPreviewImage("");
      }
    }, 160);
    if (currentLibraryEntry) {
      setGeneratedPreviewUrl(previewUrlForEntry(currentLibraryEntry.id, animationName));
      return;
    }
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
      if (!preparedSpine) return;
      if (event.touches.length === 2) {
        pinchDistanceRef.current = distanceBetweenTouches(event.touches);
      } else if (event.touches.length === 1) {
        event.preventDefault();
        const touch = event.touches.item(0);
        if (touch) touchPanPositionRef.current = { x: touch.clientX, y: touch.clientY };
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!preparedSpine) return;

      if (event.touches.length === 2 && pinchDistanceRef.current !== null) {
        event.preventDefault();
        const nextDistance = distanceBetweenTouches(event.touches);
        const zoomDelta = (nextDistance - pinchDistanceRef.current) / 220;
        pinchDistanceRef.current = nextDistance;
        changeZoom(zoomRef.current + zoomDelta);
      } else if (event.touches.length === 1 && touchPanPositionRef.current) {
        event.preventDefault();
        const touch = event.touches.item(0);
        if (!touch) return;
        const deltaX = touch.clientX - touchPanPositionRef.current.x;
        const deltaY = touch.clientY - touchPanPositionRef.current.y;
        touchPanPositionRef.current = { x: touch.clientX, y: touch.clientY };
        panPlayerByPixels(deltaX, deltaY);
      }
    };

    const handleTouchEnd = () => {
      pinchDistanceRef.current = null;
      touchPanPositionRef.current = null;
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!preparedSpine) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (!preparedSpine) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      panPositionRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePreviewClick = (event: MouseEvent) => {
      if (!preparedSpine || (event.target as Element | null)?.closest(".spine-player-controls, .link-ready-banner")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "click" && event.button === 2) togglePreviewPlayback();
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
      if (event.button !== 0) return;
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

  const toggleEntryLike = async (entry: Pick<LibraryEntry, "id">) => {
    const currentMetric = entryMetrics[entry.id] ?? emptyEntryMetric();
    const nextLiked = !currentMetric.liked;
    const optimisticMetric = {
      ...currentMetric,
      liked: nextLiked,
      likes: Math.max(0, currentMetric.likes + (nextLiked ? 1 : -1)),
    };
    setEntryMetrics((currentMetrics) => ({ ...currentMetrics, [entry.id]: optimisticMetric }));

    try {
      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "track-metric",
          metricAction: "like",
          entryId: entry.id,
          liked: nextLiked,
          visitorId: metricsVisitorId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Metrics API ${response.status}`);
      if (result.metric) {
        setEntryMetrics((currentMetrics) => ({ ...currentMetrics, [entry.id]: result.metric }));
      }
    } catch (nextError) {
      setEntryMetrics((currentMetrics) => ({ ...currentMetrics, [entry.id]: currentMetric }));
      setLibraryError(nextError instanceof Error ? nextError.message : "Could not update like.");
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

  const moveLibraryEntry = async (entry: LibraryEntry, direction: "up" | "down") => {
    setLibraryError("");
    setProfileVisibilityStatus("Saving order...");
    setLibraryEntries((currentEntries) => moveLibraryEntryInList(currentEntries, entry.id, direction));
    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;
      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          action: "update-library-order",
          googleIdToken,
          anonymousAccount,
          settings: githubPublishSettings,
          entryId: entry.id,
          direction,
          commitPrefix: "Reorder Spine-Link library",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      if (Array.isArray(result.entries)) {
        setLibraryEntries(normalizeLibraryOrder(result.entries));
      } else {
        await loadLibrary();
      }
      setProfileVisibilityStatus("Library order saved");
    } catch (nextError) {
      await loadLibrary();
      setLibraryError(nextError instanceof Error ? nextError.message : "Could not save library order.");
      setProfileVisibilityStatus("");
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
    setProfileNameInput("");
    setGoogleAuthError("");
    setIsAccountMenuOpen(false);
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
          ownerName: cleanAccountDisplayName(profileNameInput || user.name || ""),
          ownerPicture: user.picture,
          commitPrefix: `Merge Spine-Link library ${user.email}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      }
      const nextEntries = Array.isArray(result.entries) ? normalizeLibraryOrder(result.entries) : [];
      setLibraryEntries(nextEntries);
      setIsPortfolioMode(nextEntries.some((entry) => entry.portfolioMode === true));
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

      const nextEntries = Array.isArray(result.entries) ? normalizeLibraryOrder(result.entries) : [];
      setLibraryEntries(nextEntries);
      setIsPortfolioMode(nextEntries.some((entry) => entry.portfolioMode === true));
    } catch (nextError) {
      setLibraryError(nextError instanceof Error ? nextError.message : "Could not load library.");
    } finally {
      setIsLibraryLoading(false);
    }
  }, [anonymousAccount, googleIdToken]);

  const openLibrary = () => {
    setIsAccountMenuOpen(false);
    setIsLibraryOpen(true);
    void loadLibrary();
  };

  useEffect(() => {
    if (!initialOpenLibraryRef.current) return;
    initialOpenLibraryRef.current = false;
    openLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (!initialLoginRef.current) return;
    initialLoginRef.current = false;
    void openGoogleSignIn();
  }, []);

  useEffect(() => {
    if (!initialUploadRef.current) return;
    initialUploadRef.current = false;
    window.setTimeout(() => startNewLibraryEntry(), 120);
  }, []);

  const startNewLibraryEntry = (
    sourceElement?: HTMLElement | null,
    options: { openPicker?: boolean; picker?: HTMLInputElement | null } = {},
  ) => {
    void sourceElement;
    const { openPicker = true, picker = uploadInputRef.current } = options;
    if (!hasDismissedSkeletonUploadTip(googleUser, anonymousAccount)) {
      setIsSkeletonUploadTipVisible(true);
    }
    setIsUploadPage(true);
    setIsLibraryOpen(false);
    setCurrentLibraryEntry(null);
    setGeneratedPreviewUrl("");
    setIsLinkBannerOpen(false);
    setCopyStatus("");
    setPreviewNote("");
    setPreviewNoteStatus("");
    setSelectedCardSize("auto");
    setError("");
    setStatus("Choose files for a new library card.");
    publishedKeysRef.current.clear();
    if (openPicker) picker?.click();
  };

  const updateOwnerPortfolioMode = async (nextMode: boolean) => {
    setIsPortfolioMode(nextMode);
    setLibraryError("");
    setProfileVisibilityStatus(nextMode ? "Portfolio mode saved" : "Library mode saved");

    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;

      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          action: "update-owner-portfolio-mode",
          googleIdToken,
          anonymousAccount,
          settings: githubPublishSettings,
          portfolioMode: nextMode,
          ownerName: accountDisplayName || googleUser?.name,
          ownerPicture: googleUser?.picture,
          publicOwnerId: publicLibraryOwnerId,
          commitPrefix: nextMode ? "Enable Spine-Link portfolio mode" : "Enable Spine-Link library mode",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      if (Array.isArray(result.entries)) {
        const nextEntries = normalizeLibraryOrder(result.entries);
        setLibraryEntries(nextEntries);
        setIsPortfolioMode(nextEntries.some((entry) => entry.portfolioMode === true));
      }
    } catch (nextError) {
      setIsPortfolioMode(!nextMode);
      setLibraryError(nextError instanceof Error ? nextError.message : "Could not save portfolio mode.");
      setProfileVisibilityStatus("");
    }
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
          ownerName: accountDisplayName || googleUser?.name,
          ownerPicture: googleUser?.picture,
          publicOwnerId: publicOwnerIdFor(googleUser, anonymousAccount),
          commitPrefix: "Update Spine-Link public profile setting",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      }
      setLibraryEntries(Array.isArray(result.entries) ? normalizeLibraryOrder(result.entries) : []);
      setProfileVisibilityStatus(nextValue ? "Your name is visible" : "Your name is hidden");
    } catch (nextError) {
      setProfileVisibilityStatus(nextError instanceof Error ? nextError.message : "Could not save profile setting.");
    }
  };

  const saveAccountDisplayName = async () => {
    const nextName = cleanAccountDisplayName(profileNameInput);
    if (!nextName) {
      setProfileVisibilityStatus("Enter account name");
      return;
    }

    setIsSavingProfileName(true);
    setProfileVisibilityStatus("Saving account name...");
    const nextGoogleUser = googleUser ? { ...googleUser, name: nextName } : null;
    if (nextGoogleUser) {
      setGoogleUser(nextGoogleUser);
      updateStoredGoogleUser(nextGoogleUser);
    }

    try {
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (googleIdToken) requestHeaders.Authorization = `Bearer ${googleIdToken}`;

      const response = await fetch("/api/github-upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          action: "update-profile-name",
          googleIdToken,
          anonymousAccount,
          settings: githubPublishSettings,
          ownerName: nextName,
          ownerPicture: googleUser?.picture,
          publicOwnerId: publicLibraryOwnerId,
          commitPrefix: "Update Spine-Link account name",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof result?.error === "string" ? result.error : `Library API ${response.status}`);
      }
      if (Array.isArray(result.entries)) {
        setLibraryEntries(normalizeLibraryOrder(result.entries));
      } else {
        setLibraryEntries((currentEntries) =>
          currentEntries.map((currentEntry) => ({
            ...currentEntry,
            ownerName: nextName,
            ...(googleUser?.picture ? { ownerPicture: googleUser.picture } : {}),
          })),
        );
      }
      setProfileVisibilityStatus("Account name saved");
    } catch (nextError) {
      setProfileVisibilityStatus(nextError instanceof Error ? nextError.message : "Could not save account name.");
    } finally {
      setIsSavingProfileName(false);
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

            const googleDisplayName = cleanAccountDisplayName(payload.name || "");
            const storedSession = readStoredGoogleSession();
            const storedDisplayName =
              storedSession?.user?.email?.toLowerCase() === email.toLowerCase()
                ? cleanAccountDisplayName(storedSession.user.name || "")
                : "";
            const currentDisplayName = cleanAccountDisplayName(profileNameInput);
            const nextDisplayName =
              (currentDisplayName && currentDisplayName !== googleDisplayName ? currentDisplayName : "") ||
              storedDisplayName ||
              googleDisplayName;
            const nextGoogleUser = { email, name: nextDisplayName || payload.name, picture: payload.picture };
            setGoogleUser(nextGoogleUser);
            setProfileNameInput(nextDisplayName);
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
      setPublishProgress({ isOpen: true, value: 0, label: isEditingEntry ? "Updating Spine page" : "Converting Spine preview" });
      publishedKeysRef.current.add(publishKey);

      try {
        const uploadedAt = new Date().toISOString();
        const uploadId = existingEntry?.id || `${safePathSegment(nextSettings.title)}-${uploadedAt.replace(/[:.]/g, "-")}`;
        const uploadPath = cleanRepoPath(existingEntry?.previewPath || joinRepoPath(nextSettings.basePath, uploadId));
        const permanentPreviewUrl = previewUrlForEntry(uploadId, defaultAnimation);
        const setsForPublish = spineOptions.length ? spineOptions : [spine];
        const note = limitWords(previewNote);
        const playerCanvas = (playerRef.current as unknown as { canvas?: HTMLCanvasElement | null } | null)?.canvas;
        setPublishProgress((current) => ({ ...current, label: "Capturing thumbnail" }));
        const thumbnailPoster = await createCanvasImageThumbnail(playerCanvas);
        const fileMap = new Map<string, string>();
        for (const nextSpine of setsForPublish) {
          for (const file of filesForLibrary(nextSpine)) {
            fileMap.set(`${nextSpine.label}/${file.name}`, file.dataUri);
          }
        }
        const thumbnailPosterName = safePreviewFileName(defaultAnimation || "animation", "preview.webp");
        const thumbnailPosterPath = thumbnailPoster ? joinRepoPath(uploadPath, thumbnailPosterName) : "";
        if (thumbnailPoster) fileMap.set(thumbnailPosterName, thumbnailPoster);
        const proofFileName = "source-proof.json";
        const proofPath = joinRepoPath(uploadPath, proofFileName);
        let files = Array.from(fileMap.entries()).map(([name, dataUri]) => ({ name, contentBase64: dataUriToBase64(dataUri) }));
        const sourceProof = await createSourceProof(files, {
          uploadId,
          title: nextSettings.title || existingEntry?.title || spine.label,
          uploadedAt,
          uploadPath,
          proofPath,
          proofUrl: assetUrlForRepoPath(proofPath, uploadedAt),
          settings: nextSettings,
          user: googleUser ? { ...googleUser, name: accountDisplayName || googleUser.name } : googleUser,
          anonymousAccount,
        });
        fileMap.set(proofFileName, textDataUri("application/json", JSON.stringify(sourceProof, null, 2)));
        files = Array.from(fileMap.entries()).map(([name, dataUri]) => ({ name, contentBase64: dataUriToBase64(dataUri) }));
        const commitPrefix = `${isEditingEntry ? "Update" : "Add"} Spine preview ${nextSettings.title}`;

        if (files.length < 3) {
          throw new Error("Could not collect skeleton, atlas, and texture for publishing.");
        }

        setPublishProgress((current) => ({ ...current, label: "Saving files to library" }));
        setStatus(`Files ready. Uploading: 0/${files.length}...`);

         const uploadedProofFiles: GitHubProofReceipt[] = [];
         const MAX_BODY = 4_000_000;
         const CHUNK = 3_500_000;

         const uploadOneFile = async (f: { name: string; contentBase64: string }, idx: number): Promise<GitHubProofReceipt> => {
           const fp = joinRepoPath(uploadPath, f.name);
           const rh: Record<string, string> = { "Content-Type": "application/json" };
           if (googleIdToken) rh.Authorization = `Bearer ${googleIdToken}`;
           const sb = JSON.stringify({ action: "put-file", googleIdToken, anonymousAccount, settings: nextSettings, file: { path: fp, contentBase64: f.contentBase64 }, message: `${commitPrefix}: ${f.name}` });
           if (sb.length <= MAX_BODY) {
             const r = await fetch("/api/github-upload", { method: "POST", headers: rh, body: sb });
             const res = await r.json().catch(() => ({}));
             if (!r.ok) throw new Error(typeof res?.error === "string" ? res.error : `Upload API ${r.status}`);
             setPublishProgress((c) => ({ ...c, label: `Saving files ${idx + 1}/${files.length}`, value: Math.max(c.value, Math.round(((idx + 1) / Math.max(files.length + 1, 1)) * 88)) }));
             setStatus(`Files ready. Uploading: ${idx + 1}/${files.length}...`);
             const sp = sourceProof.files.find((pf) => pf.name === f.name);
             return { name: f.name, path: fp, bytes: Number(res.bytes || sp?.bytes || byteLengthFromBase64(f.contentBase64)), sha256: String(res.sha256 || sp?.sha256 || (await sha256HexFromBytes(base64ToBytes(f.contentBase64)))), github: { contentSha: typeof res.github?.contentSha === "string" ? res.github.contentSha : "", commitSha: typeof res.github?.commitSha === "string" ? res.github.commitSha : "", commitUrl: typeof res.github?.commitUrl === "string" ? res.github.commitUrl : "", downloadUrl: typeof res.github?.downloadUrl === "string" ? res.github.downloadUrl : "" } };
           }
           const base64 = f.contentBase64.replace(/\s/g, "");
           const totalChunks = Math.ceil(base64.length / CHUNK);
           const results = await Promise.all(Array.from({ length: totalChunks }, async (_, i) => {
             const chunk = base64.slice(i * CHUNK, (i + 1) * CHUNK);
             const chunkPath = `${fp}.__chunks/${String(i).padStart(5, "0")}`;
             const cb = JSON.stringify({ action: "multipart-upload-chunk", googleIdToken, anonymousAccount, settings: nextSettings, path: chunkPath, chunkIndex: i, contentBase64: chunk, message: `${commitPrefix}: chunk ${i} of ${f.name}` });
             const cr = await fetch("/api/github-upload", { method: "POST", headers: rh, body: cb });
             const cres = await cr.json().catch(() => ({}));
             if (!cr.ok) throw new Error(`Chunk ${i} upload failed: ${cr.status}`);
             return { chunkPath, bytes: Number(cres.bytes), sha256: String(cres.sha256) };
           }));
           for (const cr of results) { uploadedProofFiles.push({ name: `${f.name}.__chunks/${cr.chunkPath.split("/").pop()}`, path: cr.chunkPath, bytes: cr.bytes, sha256: cr.sha256, github: { contentSha: "", commitSha: "", commitUrl: "", downloadUrl: "" } }); }
           const rb = JSON.stringify({ action: "reassemble-file", googleIdToken, anonymousAccount, settings: nextSettings, path: fp, chunkCount: totalChunks, message: `${commitPrefix}: reassemble ${f.name}` });
           const rr = await fetch("/api/github-upload", { method: "POST", headers: rh, body: rb });
           const rres = await rr.json().catch(() => ({}));
           if (!rr.ok) throw new Error(typeof rres?.error === "string" ? rres.error : `Reassembly API ${rr.status}`);
           setPublishProgress((c) => ({ ...c, label: `Saving files ${idx + 1}/${files.length}`, value: Math.max(c.value, Math.round(((idx + 1) / Math.max(files.length + 1, 1)) * 88)) }));
           setStatus(`Files ready. Uploading: ${idx + 1}/${files.length}...`);
           const sp = sourceProof.files.find((pf) => pf.name === f.name);
           return { name: f.name, path: fp, bytes: Number(rres.bytes || sp?.bytes || byteLengthFromBase64(f.contentBase64)), sha256: String(rres.sha256 || sp?.sha256 || sha256HexFromBytes(base64ToBytes(base64))), github: { contentSha: typeof rres.github?.contentSha === "string" ? rres.github.contentSha : "", commitSha: typeof rres.github?.commitSha === "string" ? rres.github.commitSha : "", commitUrl: typeof rres.github?.commitUrl === "string" ? rres.github.commitUrl : "", downloadUrl: typeof rres.github?.downloadUrl === "string" ? rres.github.downloadUrl : "" } };
         };

         for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
           const file = files[fileIndex];
           try {
             const receipt = await uploadOneFile(file, fileIndex);
             uploadedProofFiles.push(receipt);
           } catch (uploadErr) {
             const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
             setError(`Failed to upload ${file.name}: ${msg}`);
             setStatus("Upload stopped.");
             return;
           }
         }

        setPublishProgress((current) => ({ ...current, label: "Writing source proof anchor", value: Math.max(current.value, 92) }));
        const anchorFileName = "blockchain-anchor.json";
        const anchorPath = joinRepoPath(uploadPath, anchorFileName);
        const anchorRequestHeaders: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (googleIdToken) anchorRequestHeaders.Authorization = `Bearer ${googleIdToken}`;
        const anchorResponse = await fetch("/api/github-upload", {
          method: "POST",
          headers: anchorRequestHeaders,
          body: JSON.stringify({
            action: "anchor-source-proof",
            googleIdToken,
            anonymousAccount,
            settings: nextSettings,
            sourceProof,
            uploadedFiles: uploadedProofFiles,
            anchorPath,
            uploadPath,
            entryId: uploadId,
            title: nextSettings.title || existingEntry?.title || spine.label,
            uploadedAt,
            proofPath,
            proofUrl: assetUrlForRepoPath(proofPath, uploadedAt),
            commitPrefix,
          }),
        });
        const anchorResult = await anchorResponse.json().catch(() => ({}));
        if (!anchorResponse.ok) {
          throw new Error(typeof anchorResult?.error === "string" ? anchorResult.error : `Blockchain anchor API ${anchorResponse.status}`);
        }
        const blockchainAnchor = anchorResult.anchor as BlockchainAnchor | undefined;
        const entryFiles = files.map((file) => file.name);
        if (blockchainAnchor?.anchorPath && !entryFiles.includes(anchorFileName)) entryFiles.push(anchorFileName);

        const entry: LibraryEntry = {
          id: uploadId,
          title: nextSettings.title || existingEntry?.title || spine.label,
          ownerEmail: googleUser?.email || existingEntry?.ownerEmail,
          ownerName: accountDisplayName || existingEntry?.ownerName || googleUser?.name,
          ownerPicture: googleUser?.picture || existingEntry?.ownerPicture,
          publicOwnerId: existingEntry?.publicOwnerId || publicOwnerIdFor(googleUser, anonymousAccount),
          ownerAnonId: existingEntry?.ownerAnonId || anonymousAccount.id,
          ownerAnonFingerprint: existingEntry?.ownerAnonFingerprint || anonymousAccount.fingerprint,
          showOwnerLibrary: existingEntry?.showOwnerLibrary ?? showProfileOnSharedPages,
          portfolioMode: existingEntry?.portfolioMode ?? isPortfolioMode,
          hiddenFromPublicLibrary: existingEntry?.hiddenFromPublicLibrary,
          uploadedAt: existingEntry?.uploadedAt || uploadedAt,
          skeleton: spine.skeletonName,
          atlas: spine.atlasName,
          textures: Array.from(new Set(setsForPublish.flatMap((nextSpine) => nextSpine.atlasPages.map(basename)))),
          animations: animationNames,
          defaultAnimation,
          files: entryFiles,
          previewPath: uploadPath,
          repositoryUrl: existingEntry?.repositoryUrl || "",
          ...(note ? { note } : {}),
          ...(thumbnailPosterPath ? { thumbnail: assetUrlForRepoPath(thumbnailPosterPath, uploadedAt), thumbnailPath: thumbnailPosterPath } : {}),
          ...(thumbnailPosterPath
            ? {
                thumbnailPoster: assetUrlForRepoPath(thumbnailPosterPath, uploadedAt),
                thumbnailPosterPath,
                cardSize: selectedCardSize === "auto" ? undefined : selectedCardSize,
              }
            : existingEntry?.thumbnailPoster && /^https:\/\//i.test(existingEntry.thumbnailPoster)
              ? { thumbnailPoster: existingEntry.thumbnailPoster, ...(existingEntry.thumbnailPosterPath ? { thumbnailPosterPath: existingEntry.thumbnailPosterPath } : {}) }
              : {}),
          ...(thumbnailPosterPath ? { thumbnailType: "image" } : {}),
          webmStatus: existingEntry?.webmStatus === "ready" ? "ready" : "pending",
          sourceProof,
          sourceProofPath: proofPath,
          sourceProofUrl: assetUrlForRepoPath(proofPath, uploadedAt),
          ...(blockchainAnchor ? { blockchainAnchor } : {}),
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

        setPublishProgress({ isOpen: true, value: 100, label: "Permanent link ready" });
        setLibraryEntries((currentEntries) => [entry, ...currentEntries.filter((currentEntry) => currentEntry.id !== entry.id)]);
        setCurrentLibraryEntry(entry);
        setIsLibraryOpen(false);
        setPreviewNote(note);
        setSelectedCardSize(entry.cardSize || "auto");
        setGeneratedPreviewUrl(permanentPreviewUrl);
        setIsLinkBannerOpen(true);
        setCopyStatus("Permanent link ready");
        setStatus(`Ready. Animations found: ${animationNames.length}. Uploaded.`);
        window.setTimeout(() => {
          setPublishProgress({ isOpen: false, value: 0, label: "" });
        }, 650);
      } catch (nextError) {
        setPublishProgress((current) => ({ ...current, isOpen: true, label: "Saving failed" }));
        window.setTimeout(() => {
          setPublishProgress({ isOpen: false, value: 0, label: "" });
        }, 1200);
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
    handleSelectedFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const updateExtraPlayerAnimation = (id: string, animationName: string) => {
    setExtraSpineSets((currentSets) =>
      currentSets.map((currentSet) =>
        currentSet.id === id
          ? {
              ...currentSet,
              activeAnimation: animationName,
            }
          : currentSet,
      ),
    );
  };

  const showHomeFeed = !preparedSpine && !isEditPage && homeFeedEntries.length > 0;
  const homeFeedLoop = showHomeFeed ? [...homeFeedEntries, ...homeFeedEntries] : [];
  const isHomeDropOnly = !preparedSpine && !isEditPage && !isUploadPage && extraSpineSets.length === 0;
  const siteReadingPages = [
    { href: "/spine-link.html", title: "Spine-Link", description: "Platform overview" },
    { href: "/spine-preview.html", title: "Spine Preview", description: "Open JSON, SKEL and atlas files" },
    { href: "/spine-preview-online.html", title: "Preview Online", description: "Browser Spine preview guide" },
    { href: "/spine-web-viewer.html", title: "Web Viewer", description: "Open Spine files online" },
    { href: "/spine-animation-preview.html", title: "Animation Preview", description: "Preview Spine animations" },
    { href: "/spine-animation-dataset.html", title: "Animation Dataset", description: "Commercial source database" },
    { href: "/spine-library.html", title: "Spine Library", description: "Online animation gallery" },
    { href: "/spine-portfolio.html", title: "Spine Portfolio", description: "Portfolio animation library" },
    { href: "/share-spine-animation-link.html", title: "Share Animation Link", description: "Create shareable previews" },
    { href: "/spine-portfolio-link.html", title: "Portfolio Link", description: "Public portfolio sharing" },
    { href: "/spine-animator.html", title: "Spine Animator", description: "Animator workflow notes" },
    { href: "/spine-animations.html", title: "Spine Animations", description: "Preview, save and share" },
    { href: "/spine-work.html", title: "Spine Work", description: "Share work previews" },
    { href: "/spine-link-manifesto.html", title: "Manifesto", description: "AI animator agreement" },
  ];

  return (
    <main
      className={`app-shell ${!preparedSpine ? "is-empty" : ""} ${isIntroDocking ? "is-docking" : ""} ${isEditPage ? "is-edit-page" : ""} ${isUploadPage ? "is-upload-page" : ""}`}
    >
      <section className="seo-intro" aria-label="Spine-Link SEO description">
        <h1>Spine-Link is an animation portfolio platform with Google accounts and uploads</h1>
        <p>
          World SPINE ARCHIVE is the public archive of user Spine animation works. Anyone can create an anonymous
          preview with Create preview, or sign in with Google to create a profile, choose a public portfolio with likes,
          views, showcase and archive publishing, or keep a private library profile that is not listed on the site or in
          Google.
        </p>
      </section>
      <ParticleField mode={isEditPage ? "quiet" : "rich"} />
      {publishProgress.isOpen && (
        <div className={`publish-progress-overlay ${isPublishProgressCompact ? "is-compact" : ""}`} role="status" aria-live="polite">
          <div className="publish-progress-dialog">
            <div className="publish-progress-kicker">{currentLibraryEntry ? "Saving page" : "Creating page"}</div>
            <strong>{publishProgress.label || "Saving Spine preview"}</strong>
            <div className="publish-progress-bar" aria-label="Conversion and save progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={publishProgress.value}>
              <span style={{ width: `${Math.min(100, Math.max(0, publishProgress.value))}%` }} />
            </div>
            <div className="publish-progress-meta">
              <span>Converting WebM / WebP</span>
              <b>{Math.min(100, Math.max(0, publishProgress.value))}%</b>
            </div>
          </div>
        </div>
      )}
      <section className="workspace">
        <header className="topbar">
          <a className="brand-link" href="/" aria-label="Spine-Link home">
            <span className="brand-mobile-text">spine link</span>
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
            <img className="brand-logo-image brand-logo-mobile" src="/logo-mobile.png" alt="" aria-hidden="true" />
          </a>
          <div className="top-actions-row">
            {isHomeDropOnly && (
              <a className="world-archive-link" href="/world-spine-archive">
                BROWSE
              </a>
            )}
            <div className="auth-panel">
              {googleUser ? (
                <div className={`auth-user ${isAccountMenuOpen ? "is-account-menu-open" : ""}`}>
                  <span>{googleUser.email}</span>
                  <button type="button" onClick={openLibrary}>MY PORTFOLIO</button>
                  <div className="avatar-menu">
                    <button
                      className="avatar-menu-toggle"
                      type="button"
                      title="Account"
                      aria-label="Account menu"
                      aria-expanded={isAccountMenuOpen}
                      onClick={() => setIsAccountMenuOpen((isOpen) => !isOpen)}
                    >
                      {googleUser.picture ? <img src={googleUser.picture} alt="" /> : <span>{(googleUser.name || googleUser.email || "A").charAt(0).toUpperCase()}</span>}
                    </button>
                    <button className="sign-out-icon-button" type="button" onClick={signOutGoogle} title="Sign out" aria-label="Sign out">
                      <LogOut size={17} />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <a className="my-library-button" href="/?portfolio=1" onClick={(event) => { event.preventDefault(); openLibrary(); }}>
                    Portfolio database
                  </a>
                  <button className="guest-account-button" type="button" onClick={() => { setIsAccountMenuOpen(false); void openGoogleSignIn(); }} title="Sign in" aria-label="Sign in">
                    <User className="user_icon" size={22} />
                  </button>
                  {googleAuthError && <span className="auth-error">{googleAuthError}</span>}
                </>
              )}
            </div>
            <div className="site-menu-group">
              <button className="site-add-button" type="button" onClick={(event) => startNewLibraryEntry(event.currentTarget)} aria-label="Add new animation card" title="Add new animation card">
                <Plus size={24} />
              </button>
              <details className="site-menu">
                <summary className="site-menu-toggle" aria-label="Open site menu" title="Menu">
                  <span />
                  <span />
                  <span />
                </summary>
                <nav className="site-menu-panel" aria-label="Site pages">
                  {siteReadingPages.map((page) => (
                    <a href={page.href} key={page.href}>
                      <strong>{page.title}</strong>
                      <span>{page.description}</span>
                    </a>
                  ))}
                </nav>
              </details>
            </div>
          </div>
        </header>

        {showHomeFeed && (
          <section className="home-portfolio-feed" aria-label="World SPINE ARCHIVE public portfolio and library work feed" ref={homeFeedRef}>
            <div className="home-feed-heading">
              <span className="home-feed-archive-label">World SPINE ARCHIVE</span>
              <strong>Public user works from portfolios and libraries</strong>
              <small>Anyone can add a Spine animation with Create preview or publish through a Google account profile.</small>
            </div>
            <div className="home-feed-viewport">
              <div className="home-feed-track">
                {homeFeedLoop.map((entry, index) => {
                  const metric = entryMetrics[entry.id] ?? entry.metrics ?? emptyEntryMetric();
                  const poster = normalizeAssetDomain(entry.thumbnailPoster || entry.thumbnail || "");
                  const likedEntry = Boolean(metric.liked);
                  const previewWidth = Number(entry.previewWidth || 0);
                  const previewHeight = Number(entry.previewHeight || 0);
                  const mediaRatio =
                    previewWidth > 0 && previewHeight > 0
                      ? previewWidth / previewHeight
                      : Number(entry.mediaAspectRatio || 0);
                  const cardStyle = {
                    ...(poster ? { "--home-feed-poster": `url(${poster})` } : {}),
                    ...(Number.isFinite(mediaRatio) && mediaRatio > 0
                      ? {
                          "--home-feed-ratio": `${Math.max(1, Math.round(mediaRatio * 1000))} / 1000`,
                          "--home-feed-card-width": `${Math.round(Math.max(260, Math.min(860, 320 * mediaRatio)))}px`,
                        }
                      : {}),
                  } as React.CSSProperties;
                  return (
                    <a
                      className="home-feed-card"
                      href={entry.previewUrl}
                      key={`${entry.id}-${index}`}
                      style={cardStyle}
                      aria-label={`Open ${entry.title}`}
                    >
                      {entry.webmPreview ? (
                        <ProgressiveMedia
                          className="home-feed-video"
                          videoSrc={normalizeAssetDomain(entry.webmPreview)}
                          posterSrc={poster || undefined}
                          chunks={(entry as any).webmChunks}
                          aria-hidden="true"
                        />
                      ) : poster ? (
                        <img src={poster} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span className="home-feed-fallback">{entry.animations ?? 0}</span>
                      )}
                      <button
                        className={`home-feed-like ${likedEntry ? "is-liked" : ""}`}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void toggleEntryLike(entry);
                        }}
                        aria-pressed={likedEntry}
                        title={likedEntry ? "Liked" : "Like"}
                      >
                        <Heart size={30} fill={likedEntry ? "currentColor" : "none"} />
                        <span>{metric.likes}</span>
                      </button>
                      <span className="home-feed-overlay">
                        <strong>{entry.title}</strong>
                        <em>{entry.ownerName || "Spine creator"} · {entry.pageMode || "Library"} · {metric.views} views</em>
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <div className="stage">
          <div className={isHomeDropOnly ? "home-drop-panel" : `preview-panel ${extraSpineSets.length ? "has-multiple-players" : ""}`} ref={previewPanelRef}>
            {!preparedSpine && !isEditPage && !isLibraryOpen && !isUploadPage && (
              <>
                <label
                  className={`drop-zone main-drop-zone ${isDragging ? "is-dragging" : ""}`}
                  onClick={(event) => {
                    if ((event.target as Element | null)?.closest("input")) return;
                    startNewLibraryEntry(event.currentTarget, { openPicker: false, picker: homeUploadInputRef.current });
                  }}
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
                    ref={homeUploadInputRef}
                    name="spine-files"
                    type="file"
                    multiple
                    accept=".json,.skel,.atlas,.txt,.docx,.png,.jpg,.jpeg,.webp"
                    aria-label="Upload Spine JSON SKEL atlas and texture files"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setIsDragging(true);
                    }}
                    onDrop={handleDrop}
                    onClick={clearFileInputBeforePick}
                    onChange={handleFileInputChange}
                    onInput={handleFileInputChange}
                  />
                  <Upload size={44} strokeWidth={1.5} />
                  <strong>Drag'and'Drop files here</strong>
                  <span>JSON or SKEL, atlas, and textures become a Spine preview.</span>
                </label>
                {isHomeDropOnly && (
                  <p className="home-drop-caption" style={{ fontSize: "8px", lineHeight: 1.2 }}>
                    <strong>Upload agreement:</strong> by adding files here, you agree to the{" "}
                    <a href="/spine-link-manifesto.html">Spine-Link Manifesto</a>. Public works and uploaded animation
                    files may be analyzed by automated systems and used as learning, testing, and reference material for
                    AI animator agents. Personal account data is not sold or shared for unrelated marketing.
                  </p>
                )}
                {(error || isLoading || isDragging || isPublishingLink) && (
                  <div
                    className="home-upload-monitor"
                    data-state={error ? "error" : isLoading ? "loading" : isDragging ? "dragging" : isPublishingLink ? "saving" : "ready"}
                    role="status"
                    aria-live="polite"
                  >
                    <strong>
                      {error
                        ? "Upload stopped"
                        : isLoading
                          ? "Reading files"
                          : isPublishingLink
                            ? "Creating portfolio card"
                            : "Drop files now"}
                    </strong>
                    <span>{error || status}</span>
                  </div>
                )}
                <p className="upload-agreement main-upload-agreement" style={{ fontSize: "8px", lineHeight: 1.2 }}>
                  Upload agreement: by dropping or choosing files here, you agree to the{" "}
                  <a href="/spine-link-manifesto.html">Spine-Link Manifesto</a>. Public animation files may be
                  processed, indexed, studied, and used to build educational datasets, evaluation material, and
                  training examples for AI animator agents. Upload only work you own or have permission to publish.
                </p>
              </>
            )}
            {shouldShowSkeletonUploadTip && (
              <div className="skeleton-upload-tip" role="status" aria-live="polite">
                <span>ты можешь перетащить одновременно 10 скелетов файлов</span>
                <button type="button" onClick={dismissSkeletonUploadTip} aria-label="Закрыть подсказку">
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="player-host" ref={playerHostRef} />
            {extraSpineSets.map((extraSet) => (
              <div key={extraSet.id} className="extra-player-shell">
                <div className="extra-player-toolbar">
                  <strong>{extraSet.set.label}</strong>
                  <select
                    aria-label={`Animation for ${extraSet.set.label}`}
                    value={extraSet.activeAnimation}
                    onChange={(event) => updateExtraPlayerAnimation(extraSet.id, event.target.value)}
                  >
                    {extraSet.animations.map((animationName) => (
                      <option key={animationName} value={animationName}>
                        {animationName}
                      </option>
                    ))}
                  </select>
                  <button
                    className="extra-player-remove"
                    type="button"
                    onClick={() => {
                      setExtraSpineSets((currentSets) => currentSets.filter((currentSet) => currentSet.id !== extraSet.id));
                      setStatus("Extra player removed.");
                    }}
                  >
                    Remove
                  </button>
                </div>
                <div className="player-host extra-player-host" data-extra-player-id={extraSet.id} />
              </div>
            ))}
            {generatedPreviewUrl && isLinkBannerOpen && (
              <div className="link-ready-banner" role="status" aria-live="polite">
                <div className="link-ready-banner-main">
                  <strong>Permanent link ready</strong>
                  <a href={generatedPreviewUrl} target="_blank" rel="noreferrer">
                    {generatedPreviewUrl}
                  </a>
                  {currentLibraryEntry?.sourceProof?.proofHash && (
                    <div className="proof-summary">
                      <span>proof {shortHash(currentLibraryEntry.sourceProof.proofHash)}</span>
                      <a
                        href={currentLibraryEntry.sourceProofUrl || currentLibraryEntry.sourceProof.proofUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        source-proof.json
                      </a>
                      {currentLibraryEntry.blockchainAnchor?.anchorUrl && (
                        <a href={currentLibraryEntry.blockchainAnchor.anchorUrl} target="_blank" rel="noreferrer">
                          blockchain-anchor.json
                        </a>
                      )}
                    </div>
                  )}
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
            {isEditPage && selectedPreviewImage ? (
              <div className="preview-card seo-video-card is-visible" id="seo-video-card">
                <div className="section-title">Video preview</div>
                <div className="seo-video-frame" style={videoPreviewAspectRatioStyle(currentLibraryEntry)}>
                  <ProgressiveMedia
                    className="seo-video-preview"
                    videoSrc={normalizeAssetDomain(currentLibraryEntry?.webmPreview || "") || undefined}
                    posterSrc={selectedPreviewImage}
                    chunks={currentLibraryEntry?.webmChunks}
                    loop
                    controls
                    onLoadedMetadata={(event) => applySeoVideoPreviewAspect(event.currentTarget as unknown as HTMLVideoElement)}
                  />
                </div>
              </div>
            ) : isUploadPage && !preparedSpine && spineOptions.length === 0 && extraSpineSets.length === 0 && !generatedPreviewUrl ? (
              <form
                className="portfolio-upload-form"
                action="/?upload=work"
                method="get"
                aria-label="Upload animation work to portfolio"
                onSubmit={(event) => {
                  event.preventDefault();
                  startNewLibraryEntry(event.currentTarget);
                }}
              >
                <div className="portfolio-upload-form-top">
                  <div>
                    <div className="section-title">Upload work</div>
                    <strong>Add a Spine animation portfolio project</strong>
                  </div>
                  {googleUser ? (
                    <span className="portfolio-upload-status" title={googleUser.email}>
                      Account connected
                    </span>
                  ) : (
                    <a href="/?login=google" onClick={(event) => { event.preventDefault(); void openGoogleSignIn(); }}>
                      Sign in
                    </a>
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
                    name="spine-files"
                    type="file"
                    multiple
                    accept=".json,.skel,.atlas,.txt,.docx,.png,.jpg,.jpeg,.webp"
                    aria-label="Upload Spine JSON SKEL atlas and texture files"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setIsDragging(true);
                    }}
                    onDrop={handleDrop}
                    onClick={clearFileInputBeforePick}
                    onChange={handleFileInputChange}
                    onInput={handleFileInputChange}
                  />
                  <Upload size={22} />
                  <strong>Choose files for portfolio</strong>
                  <span>JSON or SKEL, atlas, and textures become an editable public portfolio card.</span>
                </label>
                <p className="upload-agreement">
                  Upload agreement: by adding files here, you agree to the{" "}
                  <a href="/spine-link-manifesto.html">Spine-Link Manifesto</a>. Public works and uploaded animation
                  files may be analyzed by automated systems and used as learning, testing, and reference material for
                  AI animator agents. Personal account data is not sold or shared for unrelated marketing.
                </p>
                <div className="portfolio-upload-fields" aria-label="Portfolio upload fields">
                  <label>
                    <span>Account</span>
                    {googleUser ? (
                      <span className="portfolio-upload-status" title={googleUser.email}>
                        Signed in
                      </span>
                    ) : (
                      <a href="/?login=google" onClick={(event) => { event.preventDefault(); void openGoogleSignIn(); }}>
                        Google sign-in / registration
                      </a>
                    )}
                  </label>
                  <label>
                    <span>Profile</span>
                    <a href="/?portfolio=1" onClick={(event) => { event.preventDefault(); openLibrary(); }}>
                      Portfolio database
                    </a>
                  </label>
                  <label>
                    <span>Publish</span>
                    <button type="submit">Upload work</button>
                  </label>
                </div>
              </form>
            ) : null}

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
              <p className="link-note">
                {copyStatus || (googleUser ? "This work is stored in your portfolio database." : "Google sign-in stores the work in your portfolio database.")}
              </p>
              {currentLibraryEntry?.sourceProof?.proofHash && (
                <div className="link-proof-row">
                  <span>Origin proof</span>
                  <code>{shortHash(currentLibraryEntry.sourceProof.proofHash, 12, 10)}</code>
                  <a href={currentLibraryEntry.sourceProofUrl || currentLibraryEntry.sourceProof.proofUrl} target="_blank" rel="noreferrer">
                    source
                  </a>
                  {currentLibraryEntry.blockchainAnchor?.anchorUrl && (
                    <a href={currentLibraryEntry.blockchainAnchor.anchorUrl} target="_blank" rel="noreferrer">
                      {currentLibraryEntry.blockchainAnchor.blockchain?.status === "submitted" ? "on-chain" : "anchor"}
                    </a>
                  )}
                </div>
              )}
            </div>

            {preparedSpine && !isEditPage && (
              <div className="add-more-work-panel">
                <div className="add-more-work-top">
                  <div>
                    <div className="section-title">Add more work</div>
                    <strong>{extraSpineSets.length + 1}/10 players</strong>
                  </div>
                  <span>{extraSpineSets.length >= 9 ? "Limit reached" : "Add files"}</span>
                </div>
                <label className={`drop-zone add-more-work-drop ${isDragging ? "is-dragging" : ""} ${extraSpineSets.length >= 9 ? "is-disabled" : ""}`}>
                  <input
                    type="file"
                    multiple
                    disabled={extraSpineSets.length >= 9}
                    accept=".json,.skel,.atlas,.txt,.docx,.png,.jpg,.jpeg,.webp"
                    aria-label="Add more Spine work"
                    onClick={clearFileInputBeforePick}
                    onChange={handleFileInputChange}
                    onInput={handleFileInputChange}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setIsDragging(true);
                    }}
                    onDrop={handleDrop}
                  />
                  <Upload size={18} />
                  <strong>Add more work</strong>
                  <span>Drop another skeleton, atlas, and textures.</span>
                </label>
              </div>
            )}

            {isEditPage && (
              <div className="card-size-panel">
                <div className="section-title">Size</div>
                <div className="card-size-grid">
                  {libraryCardSizeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={selectedCardSize === option.value ? "is-selected" : ""}
                      onClick={() => setSelectedCardSize(option.value)}
                      aria-pressed={selectedCardSize === option.value}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.dimensions}</span>
                    </button>
                  ))}
                </div>
                <p className="link-note">
                  Save selected preview writes this size to the portfolio card. Auto uses the real WebM aspect ratio.
                </p>
              </div>
            )}

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
              <div className="animation-list-top">
                <div className="section-title">{isEditPage ? "select card preview/this video in Google Video Search shows" : "Animations"}</div>
                {isEditPage && (
                  <button
                    className="save-selected-preview-button"
                    type="button"
                    onClick={() => {
                      if (!preparedSpine || !animations.length || !activeAnimation) return;
                      void publishToGitHub(preparedSpine, animations, activeAnimation);
                    }}
                    disabled={!preparedSpine || !animations.length || !activeAnimation || isPublishingLink}
                  >
                    {isPublishingLink ? <Loader2 className="spin" size={15} /> : <LinkIcon size={15} />}
                    Save selected preview
                  </button>
                )}
              </div>
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
        <div className={`library-modal ${isPortfolioMode ? "is-portfolio-mode" : ""}`} role="dialog" aria-modal="true" aria-label="Portfolio">
          <div className="library-modal-top">
            <div>
              <div className="library-kicker">ACCOUNT DATABASE</div>
              <h2>{isPortfolioMode ? "Portfolio gallery" : "Portfolio database"}</h2>
              <p className="library-modal-subtitle">
                {googleUser
                  ? `Signed in as ${accountDisplayName || googleUser.email}${accountDisplayName ? ` · ${googleUser.email}` : ""}`
                  : "Browser account is active. Sign in with Google to register and merge uploads."}
              </p>
            </div>
            <div className="library-modal-actions">
              <button className="library-add-button" type="button" onClick={(event) => startNewLibraryEntry(event.currentTarget)} title="Add new animation card">
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
              <form
                className="account-name-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveAccountDisplayName();
                }}
              >
                <label htmlFor="spine-account-name">Account name</label>
                <input
                  id="spine-account-name"
                  type="text"
                  value={profileNameInput}
                  onChange={(event) => setProfileNameInput(event.currentTarget.value)}
                  placeholder="Spine creator"
                  maxLength={80}
                  autoComplete="name"
                />
                <button type="submit" disabled={isSavingProfileName || !cleanAccountDisplayName(profileNameInput)}>
                  {isSavingProfileName ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  {isSavingProfileName ? "Saving" : "Save"}
                </button>
              </form>
              {!isEditPage && <div className="section-title">{isPortfolioMode ? "Portfolio link" : "Library link"}</div>}
              <strong>{isPortfolioMode ? "Public portfolio link" : "Private library link"}</strong>
              <a href={publicLibraryUrl} target="_blank" rel="noreferrer">
                {publicLibraryUrl}
              </a>
              <span>
                {isPortfolioMode
                  ? "Public portfolio mode is indexable, has real likes and views, can appear in the showcase, and publishes visible works to World SPINE ARCHIVE."
                  : "Library mode is private by default: it stores uploaded works for the owner and is not listed through the site or Google like public portfolios."}
              </span>
              {profileVisibilityStatus && <em>{profileVisibilityStatus}</em>}
            </div>
            <div className="library-profile-settings-actions">
              <button
                className={`portfolio-mode-button ${isPortfolioMode ? "active" : ""}`}
                type="button"
                onClick={() => {
                  void updateOwnerPortfolioMode(!isPortfolioMode);
                }}
                aria-pressed={isPortfolioMode}
                title={isPortfolioMode ? "Switch to library mode" : "Switch to portfolio mode"}
              >
                {isPortfolioMode ? <FileArchive size={17} /> : <Layers size={17} />}
                <span className="action-label">{isPortfolioMode ? "Library" : "Portfolio"}</span>
              </button>
              <button type="button" onClick={copyPublicLibraryLink} title="Copy profile link">
                <Copy size={17} />
                <span className="action-label">Copy</span>
              </button>
              <button
                className={!showProfileOnSharedPages ? "active" : ""}
                type="button"
                onClick={() => void updateSharedProfileVisibility(!showProfileOnSharedPages)}
                aria-pressed={!showProfileOnSharedPages}
                title={showProfileOnSharedPages ? "Hide my name" : "Show my name"}
              >
                {showProfileOnSharedPages ? <EyeOff size={17} /> : <Eye size={17} />}
                <span className="action-label">{showProfileOnSharedPages ? "Hide name" : "Show name"}</span>
              </button>
            </div>
          </div>

          {isPortfolioMode && (
            <div className="portfolio-gallery-tools" aria-label="Portfolio gallery controls">
              <div className="portfolio-stat">
                <strong>{portfolioStats.total}</strong>
                <span>works</span>
              </div>
              <div className="portfolio-stat">
                <strong>{portfolioStats.visible}</strong>
                <span>public</span>
              </div>
              <div className="portfolio-stat">
                <strong>{portfolioStats.animations}</strong>
                <span>animations</span>
              </div>
              <input
                type="search"
                value={portfolioSearch}
                onChange={(event) => setPortfolioSearch(event.target.value)}
                placeholder="Search portfolio"
                aria-label="Search portfolio"
              />
              <select value={portfolioFilter} onChange={(event) => setPortfolioFilter(event.target.value as typeof portfolioFilter)} aria-label="Filter portfolio">
                <option value="all">All works</option>
                <option value="visible">Public only</option>
                <option value="hidden">Hidden only</option>
              </select>
              <select value={portfolioSort} onChange={(event) => setPortfolioSort(event.target.value as typeof portfolioSort)} aria-label="Sort portfolio">
                <option value="curated">Curated</option>
                <option value="newest">Newest</option>
                <option value="name">Name A-Z</option>
              </select>
            </div>
          )}

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
              {(isPortfolioMode ? visiblePortfolioEntries : libraryEntries).map((entry, index) => {
                const previewUrl = previewUrlForEntry(entry.id, entry.defaultAnimation);
                const editUrl = new URL(`/?edit=${encodeURIComponent(entry.id)}`, window.location.origin).toString();
                const uploadedDate = entry.uploadedAt ? new Date(entry.uploadedAt) : null;
                const webmPreviewUrl = isWebmPreview(entry.webmPreview || "")
                  ? withAssetVersion(normalizeAssetDomain(entry.webmPreview || ""), assetVersionForLibraryEntry(entry, "webm"))
                  : derivedLibraryAssetUrl(entry, [".webm"]) || generatedWebmUrlForEntry(entry);
                const safeThumbnail = withAssetVersion(safeLibraryAssetUrl(normalizeAssetDomain(entry.thumbnail || "")), assetVersionForLibraryEntry(entry, "thumbnail"));
                const safePoster =
                  withAssetVersion(safeLibraryAssetUrl(normalizeAssetDomain(entry.thumbnailPoster || "")), assetVersionForLibraryEntry(entry, "poster")) ||
                  generatedPosterUrlForEntry(entry) ||
                  derivedLibraryAssetUrl(entry, [".webp", ".png", ".jpg", ".jpeg"]);
                const isGifThumbnail = entry.thumbnailType === "gif" || /^data:image\/gif;base64,/i.test(entry.thumbnail || "");
                const thumbnailForCard = isGifThumbnail ? safePoster : safeThumbnail || safePoster;
                const entryMetric = entryMetrics[entry.id] ?? emptyEntryMetric();
                const likedEntry = Boolean(entryMetric.liked);
                const likeCount = entryMetric.likes;
                const shouldIgnoreCardOpen = (target: EventTarget | null) =>
                  target instanceof HTMLElement &&
                  Boolean(target.closest(".library-card-actions, .library-card-order-actions, .portfolio-like-button"));
                const openEntryEditor = () => {
                  window.location.href = editUrl;
                };
                return (
                  <div
                    className={`library-card-shell ${libraryCardSizeClass(entry, index)}${entry.hiddenFromPublicLibrary ? " is-hidden" : ""}`}
                    key={entry.id}
                    data-card-size-mode={entry.cardSize && entry.cardSize !== "auto" ? "manual" : "auto"}
                    style={{
                      "--library-card-offset": `${(index % 4) * 18}px`,
                      ...(thumbnailForCard ? { "--library-thumbnail": `url(${thumbnailForCard})` } : {}),
                    } as React.CSSProperties}
                  >
                    <div
                      className="library-card"
                    onClickCapture={(event) => {
                      if (shouldIgnoreCardOpen(event.target)) return;
                      event.preventDefault();
                      openEntryEditor();
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      if (shouldIgnoreCardOpen(event.target)) return;
                      event.preventDefault();
                      openEntryEditor();
                    }}
                    tabIndex={0}
                  >
                    {isPortfolioMode && (
                      <button
                        className={`portfolio-like-button ${likedEntry ? "is-liked" : ""}`}
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void toggleEntryLike(entry);
                        }}
                        aria-pressed={likedEntry}
                        title={likedEntry ? "Liked" : "Like"}
                      >
                        <Heart size={18} fill={likedEntry ? "currentColor" : "none"} />
                        <span>{likeCount}</span>
                      </button>
                    )}
                    <div className="library-card-link" role="link" aria-label={`Edit ${entry.title || entry.id}`}>
                    <div className="library-card-visual">
                      <ProgressiveMedia
                        className="library-card-webm"
                        videoSrc={webmPreviewUrl || undefined}
                        posterSrc={thumbnailForCard || undefined}
                        chunks={entry.webmChunks}
                        aria-hidden="true"
                        onLoadedMetadata={(event) => applyLibraryCardVideoAspect(event.currentTarget as unknown as HTMLVideoElement)}
                      />
                      <Layers size={24} />
                      <span>{entry.animations?.length ?? 0}</span>
                    </div>
                    <div className="library-card-body">
                      <div className="library-card-title-row">
                        <strong>{entry.title || entry.id}</strong>
                        <span className="library-card-date">
                          <Calendar size={13} />
                          {uploadedDate && !Number.isNaN(uploadedDate.getTime())
                            ? `${uploadedDate.toLocaleDateString()} ${uploadedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                            : "Saved"}
                        </span>
                      </div>
                      {isPortfolioMode && entry.note && <p>{entry.note}</p>}
                      <div className="library-card-meta">
                        <span>
                          <Eye size={13} />
                          {entryMetric.views} views
                        </span>
                        <span>{entry.files?.length ?? 0} files</span>
                      </div>
                    </div>
                    </div>
                    </div>
                    <div className="library-card-actions" aria-label={`${entry.title || entry.id} actions`}>
                      <a href={editUrl}>Edit</a>
                      <button type="button" onClick={() => void updateLibraryEntryVisibility(entry, !entry.hiddenFromPublicLibrary)}>
                        {entry.hiddenFromPublicLibrary ? "Show" : "Hide"}
                      </button>
                      <button type="button" onClick={() => void copyLibraryEntryLink(previewUrl)}>Link</button>
                      <button className="danger" type="button" onClick={() => void deleteLibraryEntry(entry)}>Delete</button>
                    </div>
                    <div className="library-card-order-actions" aria-label={`${entry.title || entry.id} order`}>
                      <button type="button" onClick={() => void moveLibraryEntry(entry, "up")} disabled={index === 0}>
                        Up
                      </button>
                      <button type="button" onClick={() => void moveLibraryEntry(entry, "down")} disabled={index === libraryEntries.length - 1}>
                        Down
                      </button>
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
