const taxonomyVersion = '2026-05-02';
const domainEnum = ['gamedev'];

const assetCategoryEnum = [
  'character', 'creature', 'animal', 'monster', 'npc', 'boss',
  'object', 'prop', 'item', 'collectible',
  'weapon', 'tool',
  'environment', 'background', 'decor', 'architecture', 'foliage',
  'vehicle', 'mech', 'robot',
  'ui', 'ux', 'icon', 'hud',
  'fx', 'vfx', 'particles', 'magic', 'weather',
  'cinematic', 'cutscene',
  'emote',
  'pet', 'companion', 'mount',
];

const animationTypeEnum = [
  'character', 'creature', 'object', 'environment', 'vehicle',
  'ui', 'fx', 'cinematic',
  'abstract', 'typography', 'logo',
  'weapon', 'mechanical', 'nature',
  'crowd',
  'overlay', 'transition', 'loader',
  'icon', 'background',
  'pet',
];

const skeletonTypeEnum = [
  'humanoid', 'quadruped',
  'bird', 'fish', 'insect', 'snake', 'spider',
  'dragon', 'creature', 'monster',
  'robot', 'mech', 'mechanical', 'modular',
  'weapon', 'gun', 'sword',
  'vehicle', 'car', 'bike', 'tank', 'aircraft', 'spaceship',
  'prop', 'object', 'item',
  'plant', 'tree', 'foliage',
  'ui', 'icon', 'cursor',
  'fx', 'magic', 'fire', 'smoke', 'liquid', 'electricity',
  'environment', 'architecture', 'background',
  'logo', 'typography',
  'crowd', 'npc', 'boss',
];

const contentTypeEnum = [
  'character', 'creature', 'object', 'environment',
  'ui', 'fx', 'vehicle', 'weapon',
  'architecture',
  'typography', 'logo',
  'cinematic',
  'pet',
  'overlay', 'abstract',
  'background', 'icon',
  'transition', 'loader',
  'crowd',
  'mechanical',
];

const tagGroups = [
  'style', 'theme', 'mood', 'gameplay_role', 'rarity', 'state', 'action',
  'direction', 'perspective', 'animation_state', 'loop_type',
  'interaction_type', 'material', 'element', 'biome', 'faction', 'emotion',
  'age_group', 'body_type', 'color_scheme', 'quality_level', 'platform',
  'resolution', 'rig_type', 'physics_type',
];

const classifierRules = [
  {
    when: ['button', 'panel', 'window', 'popup', 'modal', 'menu', 'hud', 'screen', 'tab', 'badge'],
    asset_category: 'ui',
    animation_type: 'ui',
    skeleton_type: 'ui',
    content_type: 'ui',
    taxonomy: { category: 'ui', class: 'interface', type: 'panel' },
    tags: { gameplay_role: ['interface'], interaction_type: ['clickable', 'state'], style: ['game-ui'] },
  },
  {
    when: ['icon', 'cursor'],
    asset_category: 'icon',
    animation_type: 'icon',
    skeleton_type: 'icon',
    content_type: 'icon',
    taxonomy: { category: 'ui', class: 'icon', type: 'icon-animation' },
    tags: { gameplay_role: ['interface'], style: ['icon'], loop_type: ['short-loop'] },
  },
  {
    when: ['logo', 'brand'],
    asset_category: 'ui',
    animation_type: 'logo',
    skeleton_type: 'logo',
    content_type: 'logo',
    taxonomy: { category: 'branding', class: 'logo', type: 'logo-animation' },
    tags: { gameplay_role: ['branding'], style: ['logo'] },
  },
  {
    when: ['loader', 'loading', 'spinner', 'progress'],
    asset_category: 'ui',
    animation_type: 'loader',
    skeleton_type: 'ui',
    content_type: 'loader',
    taxonomy: { category: 'ui', class: 'feedback', type: 'loader' },
    tags: { gameplay_role: ['loading-feedback'], loop_type: ['loop'] },
  },
  {
    when: ['fx', 'vfx', 'effect', 'particle', 'particles', 'spark', 'glow', 'aura', 'impact', 'hit', 'blast', 'explosion'],
    asset_category: 'fx',
    animation_type: 'fx',
    skeleton_type: 'fx',
    content_type: 'fx',
    taxonomy: { category: 'effects', class: 'vfx', type: 'effect' },
    tags: { gameplay_role: ['feedback'], element: ['energy'], loop_type: ['effect'] },
  },
  {
    when: ['magic', 'spell'],
    asset_category: 'magic',
    animation_type: 'fx',
    skeleton_type: 'magic',
    content_type: 'fx',
    taxonomy: { category: 'effects', class: 'magic', type: 'magic-fx' },
    tags: { element: ['magic'], gameplay_role: ['skill-feedback'] },
  },
  {
    when: ['fire', 'flame'],
    asset_category: 'fx',
    animation_type: 'fx',
    skeleton_type: 'fire',
    content_type: 'fx',
    taxonomy: { category: 'effects', class: 'elemental', type: 'fire' },
    tags: { element: ['fire'], loop_type: ['effect'] },
  },
  {
    when: ['smoke', 'dust'],
    asset_category: 'fx',
    animation_type: 'fx',
    skeleton_type: 'smoke',
    content_type: 'fx',
    taxonomy: { category: 'effects', class: 'elemental', type: 'smoke' },
    tags: { element: ['smoke'], loop_type: ['effect'] },
  },
  {
    when: ['rain', 'snow', 'wind', 'weather', 'cloud'],
    asset_category: 'weather',
    animation_type: 'nature',
    skeleton_type: 'environment',
    content_type: 'fx',
    taxonomy: { category: 'environment', class: 'weather', type: 'weather-fx' },
    tags: { element: ['weather'], biome: ['outdoor'] },
  },
  {
    when: ['background', 'backdrop', 'bg', 'sky', 'landscape'],
    asset_category: 'background',
    animation_type: 'background',
    skeleton_type: 'background',
    content_type: 'background',
    taxonomy: { category: 'environment', class: 'background', type: 'animated-background' },
    tags: { gameplay_role: ['scene-background'], perspective: ['2d'] },
  },
  {
    when: ['building', 'architecture', 'room', 'wall', 'floor'],
    asset_category: 'architecture',
    animation_type: 'environment',
    skeleton_type: 'architecture',
    content_type: 'architecture',
    taxonomy: { category: 'environment', class: 'architecture', type: 'set-piece' },
    tags: { gameplay_role: ['environment'], perspective: ['2d'] },
  },
  {
    when: ['tree', 'plant', 'foliage', 'flower'],
    asset_category: 'foliage',
    animation_type: 'nature',
    skeleton_type: 'foliage',
    content_type: 'environment',
    taxonomy: { category: 'environment', class: 'foliage', type: 'decor' },
    tags: { biome: ['nature'], gameplay_role: ['decoration'] },
  },
  {
    when: ['weapon', 'gun', 'sword', 'bow', 'axe'],
    asset_category: 'weapon',
    animation_type: 'weapon',
    skeleton_type: 'weapon',
    content_type: 'weapon',
    taxonomy: { category: 'equipment', class: 'weapon', type: 'animated-weapon' },
    tags: { gameplay_role: ['equipment'], interaction_type: ['combat'] },
  },
  {
    when: ['robot', 'mech', 'mechanical', 'machine'],
    asset_category: 'robot',
    animation_type: 'mechanical',
    skeleton_type: 'robot',
    content_type: 'mechanical',
    taxonomy: { category: 'character', class: 'mechanical', type: 'robot' },
    tags: { rig_type: ['mechanical'], material: ['metal'] },
  },
  {
    when: ['vehicle', 'car', 'bike', 'tank', 'aircraft', 'ship', 'spaceship'],
    asset_category: 'vehicle',
    animation_type: 'vehicle',
    skeleton_type: 'vehicle',
    content_type: 'vehicle',
    taxonomy: { category: 'vehicle', class: 'transport', type: 'vehicle' },
    tags: { gameplay_role: ['transport'], rig_type: ['mechanical'] },
  },
  {
    when: ['monster', 'boss', 'enemy', 'demon'],
    asset_category: 'monster',
    animation_type: 'creature',
    skeleton_type: 'monster',
    content_type: 'creature',
    taxonomy: { category: 'character', class: 'enemy', type: 'monster' },
    tags: { gameplay_role: ['enemy'], state: ['combat-capable'] },
  },
  {
    when: ['pet', 'companion'],
    asset_category: 'pet',
    animation_type: 'pet',
    skeleton_type: 'creature',
    content_type: 'pet',
    taxonomy: { category: 'character', class: 'companion', type: 'pet' },
    tags: { gameplay_role: ['companion'] },
  },
  {
    when: ['mount', 'ride'],
    asset_category: 'mount',
    animation_type: 'creature',
    skeleton_type: 'creature',
    content_type: 'pet',
    taxonomy: { category: 'character', class: 'mount', type: 'rideable' },
    tags: { gameplay_role: ['mount'], interaction_type: ['ride'] },
  },
  {
    when: ['character', 'char', 'humanoid', 'human', 'hero', 'girl', 'boy', 'man', 'woman', 'npc'],
    asset_category: 'character',
    animation_type: 'character',
    skeleton_type: 'humanoid',
    content_type: 'character',
    taxonomy: { category: 'character', class: 'humanoid', type: 'character' },
    tags: { gameplay_role: ['avatar'], rig_type: ['skeletal-2d'] },
  },
  {
    when: ['animal', 'creature', 'dragon', 'bird', 'fish', 'snake', 'spider'],
    asset_category: 'creature',
    animation_type: 'creature',
    skeleton_type: 'creature',
    content_type: 'creature',
    taxonomy: { category: 'character', class: 'creature', type: 'creature' },
    tags: { gameplay_role: ['creature'], rig_type: ['skeletal-2d'] },
  },
  {
    when: ['cutscene', 'cinematic', 'intro', 'outro'],
    asset_category: 'cinematic',
    animation_type: 'cinematic',
    skeleton_type: 'object',
    content_type: 'cinematic',
    taxonomy: { category: 'cinematic', class: 'sequence', type: 'cutscene' },
    tags: { gameplay_role: ['storytelling'], loop_type: ['one-shot'] },
  },
  {
    when: ['transition', 'wipe', 'fade'],
    asset_category: 'ui',
    animation_type: 'transition',
    skeleton_type: 'ui',
    content_type: 'transition',
    taxonomy: { category: 'ui', class: 'transition', type: 'screen-transition' },
    tags: { gameplay_role: ['screen-transition'], loop_type: ['one-shot'] },
  },
  {
    when: ['prop', 'object', 'item', 'collectible', 'coin', 'gem', 'reward', 'bonus', 'clover', 'win', 'slot', 'reel', 'chest'],
    asset_category: 'object',
    animation_type: 'object',
    skeleton_type: 'object',
    content_type: 'object',
    taxonomy: { category: 'object', class: 'game-object', type: 'prop' },
    tags: { gameplay_role: ['game-object'], interaction_type: ['collectible'] },
  },
];

const animationTagRules = [
  { group: 'animation_state', tag: 'idle', words: ['idle', 'stand', 'wait'] },
  { group: 'action', tag: 'walk', words: ['walk'] },
  { group: 'action', tag: 'run', words: ['run'] },
  { group: 'action', tag: 'attack', words: ['attack', 'hit', 'shoot', 'cast', 'punch'] },
  { group: 'state', tag: 'win', words: ['win', 'victory', 'success'] },
  { group: 'state', tag: 'lose', words: ['lose', 'fail', 'death', 'dead'] },
  { group: 'interaction_type', tag: 'open-close', words: ['open', 'close', 'show', 'hide'] },
  { group: 'loop_type', tag: 'loop', words: ['idle', 'loop', 'pulse', 'glow', 'spin'] },
  { group: 'loop_type', tag: 'one-shot', words: ['attack', 'hit', 'open', 'close', 'win', 'lose', 'transition'] },
  { group: 'direction', tag: 'left', words: ['left'] },
  { group: 'direction', tag: 'right', words: ['right'] },
  { group: 'direction', tag: 'up', words: ['up', 'top'] },
  { group: 'direction', tag: 'down', words: ['down', 'bottom'] },
];

function normalizeWords(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_./\\-]+/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeTags(base = {}, addition = {}) {
  const next = { ...base };
  for (const [key, value] of Object.entries(addition)) {
    if (Array.isArray(value)) next[key] = unique([...(next[key] || []), ...value]);
  }
  return next;
}

function extensionOf(name) {
  const value = String(name || '').toLowerCase();
  if (value.endsWith('.atlas.txt')) return 'atlas.txt';
  const match = value.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function roleForFile(name) {
  const extension = extensionOf(name);
  if (extension === 'json' || extension === 'skel') return 'skeleton';
  if (extension === 'atlas' || extension === 'atlas.txt') return 'atlas';
  if (['png', 'webp', 'jpg', 'jpeg'].includes(extension)) return 'texture';
  if (extension === 'html') return 'preview';
  return 'support';
}

function scoreRules(words) {
  return classifierRules
    .map((rule) => {
      const matched = rule.when.filter((keyword) => words.includes(keyword));
      return { rule, matched, score: matched.length };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);
}

function defaultClassification() {
  return {
    asset_category: 'object',
    animation_type: 'object',
    skeleton_type: 'object',
    content_type: 'object',
    taxonomy: { category: 'object', class: 'game-object', type: 'prop' },
    tags: { gameplay_role: ['game-object'], rig_type: ['skeletal-2d'], quality_level: ['unreviewed'] },
  };
}

function applyAnimationTags(tags, words) {
  let nextTags = { ...tags };
  for (const rule of animationTagRules) {
    if (!rule.words.some((word) => words.includes(word))) continue;
    nextTags = mergeTags(nextTags, { [rule.group]: [rule.tag] });
  }
  return nextTags;
}

function applyFileTags(tags, fileSpecs) {
  const textureFormats = unique(fileSpecs.filter((file) => file.role === 'texture').map((file) => file.format));
  const skeletonFormats = unique(fileSpecs.filter((file) => file.role === 'skeleton').map((file) => file.format));
  const atlasFormats = unique(fileSpecs.filter((file) => file.role === 'atlas').map((file) => file.format));
  return mergeTags(tags, {
    platform: ['web'],
    resolution: textureFormats.map((format) => `texture-${format}`),
    rig_type: skeletonFormats.map((format) => `spine-${format}`),
    quality_level: ['auto-tagged'],
    material: atlasFormats.length ? ['atlas-mapped'] : [],
  });
}

function validateEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function animationAssetJsonSchema() {
  const stringArray = { type: 'array', items: { type: 'string' } };
  const tagProperties = Object.fromEntries(tagGroups.map((group) => [group, stringArray]));
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'AnimationAsset',
    type: 'object',
    required: ['id', 'domain', 'asset_category', 'animation_type', 'skeleton_type', 'content_type', 'taxonomy', 'tags'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      domain: { type: 'string', enum: domainEnum },
      asset_category: { type: 'string', enum: assetCategoryEnum },
      animation_type: { type: 'string', enum: animationTypeEnum },
      skeleton_type: { type: 'string', enum: skeletonTypeEnum },
      content_type: { type: 'string', enum: contentTypeEnum },
      taxonomy: {
        type: 'object',
        required: ['category'],
        properties: {
          category: { type: 'string' },
          class: { type: 'string' },
          type: { type: 'string' },
          group: { type: 'string' },
          tags: stringArray,
        },
        additionalProperties: false,
      },
      tags: {
        type: 'object',
        properties: {
          ...tagProperties,
          bone_count: { type: 'array', items: { type: 'number' } },
          procedural: { type: 'boolean' },
          modular: { type: 'boolean' },
          runtime_capable: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
}

function animationAssetZodSource() {
  return `import { z } from "zod";

const stringArray = z.array(z.string());

export const AnimationAssetSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  domain: z.enum(${JSON.stringify(domainEnum)}),
  asset_category: z.enum(${JSON.stringify(assetCategoryEnum)}),
  animation_type: z.enum(${JSON.stringify(animationTypeEnum)}),
  skeleton_type: z.enum(${JSON.stringify(skeletonTypeEnum)}),
  content_type: z.enum(${JSON.stringify(contentTypeEnum)}),
  taxonomy: z.object({
    category: z.string(),
    class: z.string().optional(),
    type: z.string().optional(),
    group: z.string().optional(),
    tags: stringArray.optional()
  }),
  tags: z.object({
    ${tagGroups.map((group) => `${group}: stringArray.optional(),`).join('\n    ')}
    bone_count: z.array(z.number()).optional(),
    procedural: z.boolean().optional(),
    modular: z.boolean().optional(),
    runtime_capable: z.boolean().optional()
  })
});`;
}

function inferDataScienceMetadata(entry, settings = {}) {
  const animations = Array.isArray(entry?.animations) ? entry.animations.map(String) : [];
  const files = Array.isArray(entry?.files) ? entry.files.map(String) : [];
  const textures = Array.isArray(entry?.textures) ? entry.textures.map(String) : [];
  const words = normalizeWords([
    entry?.id,
    entry?.title,
    entry?.skeleton,
    entry?.atlas,
    entry?.defaultAnimation,
    ...animations,
    ...files,
    ...textures,
  ].join(' '));
  const fileSpecs = files.map((fileName) => ({
    path: `${entry?.previewPath || ''}/${fileName}`.replace(/\/+/g, '/').replace(/^\//, ''),
    name: fileName,
    role: roleForFile(fileName),
    format: extensionOf(fileName) || 'unknown',
  }));
  const [bestMatch] = scoreRules(words);
  const base = bestMatch?.rule || defaultClassification();
  const taxonomyTags = unique([...(base.taxonomy.tags || []), ...(bestMatch?.matched || [])]);
  const tags = applyFileTags(applyAnimationTags(mergeTags(base.tags, {
    animation_state: animations.length ? animations.map((animation) => animation.toLowerCase()) : [],
    loop_type: animations.some((animation) => /idle|loop|pulse|glow/i.test(animation)) ? ['loop-candidate'] : [],
    state: entry?.defaultAnimation ? [`default-${String(entry.defaultAnimation).toLowerCase()}`] : [],
  }), words), fileSpecs);
  const animationAsset = {
    id: String(entry?.id || ''),
    ...(entry?.title || entry?.id ? { name: String(entry?.title || entry?.id) } : {}),
    domain: 'gamedev',
    asset_category: validateEnum(base.asset_category, assetCategoryEnum, 'object'),
    animation_type: validateEnum(base.animation_type, animationTypeEnum, 'object'),
    skeleton_type: validateEnum(base.skeleton_type, skeletonTypeEnum, 'object'),
    content_type: validateEnum(base.content_type, contentTypeEnum, 'object'),
    taxonomy: {
      category: base.taxonomy.category,
      ...(base.taxonomy.class ? { class: base.taxonomy.class } : {}),
      ...(base.taxonomy.type ? { type: base.taxonomy.type } : {}),
      ...(base.taxonomy.group ? { group: base.taxonomy.group } : {}),
      ...(taxonomyTags.length ? { tags: taxonomyTags } : {}),
    },
    tags: {
      ...tags,
      procedural: false,
      modular: words.includes('modular') || words.includes('parts'),
      runtime_capable: true,
    },
  };

  return {
    schemaVersion: 'spine-link-data-science-v1',
    taxonomyVersion,
    createdAt: entry?.uploadedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    animation_asset: animationAsset,
    source: {
      storage: 'github',
      repository: `${settings.owner || ''}/${settings.repo || ''}`,
      branch: settings.branch || '',
      previewPath: entry?.previewPath || '',
      manifestPath: entry?.previewPath ? `${entry.previewPath}/manifest.json` : '',
      files: fileSpecs,
    },
    spine_spec: {
      skeleton: entry?.skeleton || '',
      atlas: entry?.atlas || '',
      textures,
      animationCount: animations.length,
      animationNames: animations,
      defaultAnimation: entry?.defaultAnimation || animations[0] || '',
      fileCount: files.length,
      skeletonCount: fileSpecs.filter((file) => file.role === 'skeleton').length,
      atlasCount: fileSpecs.filter((file) => file.role === 'atlas').length,
      textureCount: fileSpecs.filter((file) => file.role === 'texture').length,
    },
    inference: {
      method: 'filename-animation-keyword-rules',
      matchedKeywords: bestMatch?.matched || [],
      confidence: bestMatch ? Number(Math.min(0.95, 0.45 + bestMatch.score / 10).toFixed(2)) : 0.35,
      needsHumanReview: !bestMatch || bestMatch.score < 2,
    },
    privacy: {
      public: false,
      ownerScoped: false,
      ownerFieldsRemoved: true,
      exposeInSitemap: false,
      exposeInProfile: false,
      note: 'Internal data-science catalog entry. Do not expose through public pages, sitemap, or profile libraries.',
    },
  };
}

function dataScienceSchema() {
  return {
    schemaVersion: 'spine-link-data-science-v1',
    taxonomyVersion,
    animationAsset: animationAssetJsonSchema(),
    zodSource: animationAssetZodSource(),
    privacy: {
      public: false,
      ownerScoped: false,
      ownerFieldsRemoved: true,
      storageOnly: true,
    },
  };
}

export {
  dataScienceSchema,
  inferDataScienceMetadata,
};
