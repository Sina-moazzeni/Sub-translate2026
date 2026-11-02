import fs from 'fs';
import path from 'path';
import { SubtitleItem } from '../types';

export interface ServerFolder {
  id: string;
  name: string;
  description?: string;
  tone?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'idle' | 'queued' | 'translating' | 'paused' | 'waiting_for_keys' | 'has_incomplete' | 'completed' | 'error';

export interface ServerSubtitleProject {
  id: string;
  folderId: string;
  name: string;
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'sub';
  rawHeader?: string;
  sourceLanguage: string;
  targetLanguage: string;
  tone: string;
  customPrompt?: string;
  status: ProjectStatus;
  totalCues: number;
  translatedCues: number;
  currentBatchIndex: number;
  totalBatches: number;
  errorMessage?: string;
  lastError?: string;
  failedCueIds?: number[];
  workerKeyUsed?: string;
  items: SubtitleItem[];
  tokenUsage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ServerConfig {
  allowedOrigin: string; // default '*'
  geminiBaseUrl: string; // default 'https://generativelanguage.googleapis.com'
  maxConcurrentProjects: number; // default 2
}

export interface SubtitlesDatabase {
  version: number;
  folders: ServerFolder[];
  projects: ServerSubtitleProject[];
  serverKeys: string[];
  activeKeyIndex: number;
  serverConfig?: ServerConfig;
  stats: {
    totalTranslations: number;
    totalTokensUsed: number;
  };
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'subtitles_db.json');
const DB_TMP_FILE = path.join(DATA_DIR, 'subtitles_db.json.tmp');

let inMemoryDb: SubtitlesDatabase | null = null;
let saveDebounceTimer: NodeJS.Timeout | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  allowedOrigin: process.env.ALLOWED_ORIGIN?.trim() || '*',
  geminiBaseUrl: process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com',
  maxConcurrentProjects: 2,
};

function loadDatabaseFromDisk(): SubtitlesDatabase {
  ensureDataDir();

  const defaultDb: SubtitlesDatabase = {
    version: 1,
    folders: [
      {
        id: 'folder_cosmic_disclosure_s01',
        name: 'افشای کیهانی فصل اول',
        description: 'پوشه پیش‌فرض زیرنویس‌های مستند افشای کیهانی (Cosmic Disclosure Season 1)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    projects: [],
    serverKeys: [],
    activeKeyIndex: 0,
    stats: {
      totalTranslations: 0,
      totalTokensUsed: 0,
    },
  };

  if (!fs.existsSync(DB_FILE)) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf-8');
    } catch (e) {
      console.error('[DB] Failed to create initial database file:', e);
    }
    return defaultDb;
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.folders || !Array.isArray(parsed.folders)) {
      parsed.folders = defaultDb.folders;
    }
    if (!parsed.projects || !Array.isArray(parsed.projects)) {
      parsed.projects = [];
    }
    if (!parsed.serverKeys || !Array.isArray(parsed.serverKeys)) {
      parsed.serverKeys = [];
    }
    if (parsed.activeKeyIndex === undefined) {
      parsed.activeKeyIndex = 0;
    }
    if (!parsed.stats) {
      parsed.stats = { totalTranslations: 0, totalTokensUsed: 0 };
    }
    if (!parsed.serverConfig) {
      parsed.serverConfig = { ...DEFAULT_SERVER_CONFIG };
    } else {
      parsed.serverConfig = {
        allowedOrigin: parsed.serverConfig.allowedOrigin ?? DEFAULT_SERVER_CONFIG.allowedOrigin,
        geminiBaseUrl: parsed.serverConfig.geminiBaseUrl ?? DEFAULT_SERVER_CONFIG.geminiBaseUrl,
        maxConcurrentProjects: Number(parsed.serverConfig.maxConcurrentProjects) || DEFAULT_SERVER_CONFIG.maxConcurrentProjects,
      };
    }
    return parsed;
  } catch (err) {
    console.error('[DB] Error parsing database file, returning default:', err);
    return defaultDb;
  }
}

export function getDatabase(): SubtitlesDatabase {
  if (!inMemoryDb) {
    inMemoryDb = loadDatabaseFromDisk();
  }
  return inMemoryDb;
}

export function saveDatabaseSync(): void {
  if (!inMemoryDb) return;
  ensureDataDir();
  try {
    const serialized = JSON.stringify(inMemoryDb, null, 2);
    fs.writeFileSync(DB_TMP_FILE, serialized, 'utf-8');
    fs.renameSync(DB_TMP_FILE, DB_FILE);
  } catch (err) {
    console.error('[DB] Error saving database synchronously:', err);
  }
}

export function scheduleSaveDatabase(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  saveDebounceTimer = setTimeout(() => {
    saveDatabaseSync();
    saveDebounceTimer = null;
  }, 1000);
}

// ─── Folder Operations ────────────────────────────────────────────────────────

export function getAllFolders(): (ServerFolder & { projectCount: number; completedCount: number })[] {
  const db = getDatabase();
  return db.folders.map((folder) => {
    const folderProjects = db.projects.filter((p) => p.folderId === folder.id);
    const completedCount = folderProjects.filter((p) => p.status === 'completed').length;
    return {
      ...folder,
      projectCount: folderProjects.length,
      completedCount,
    };
  });
}

export function getFolderById(id: string): ServerFolder | undefined {
  const db = getDatabase();
  return db.folders.find((f) => f.id === id);
}

export function createFolder(name: string, description?: string, tone?: string): ServerFolder {
  const db = getDatabase();
  const folder: ServerFolder = {
    id: 'folder_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
    name: name.trim(),
    description: description?.trim(),
    tone: tone?.trim() || 'cinematic',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.folders.push(folder);
  saveDatabaseSync();
  return folder;
}

export function updateFolder(id: string, updates: Partial<Pick<ServerFolder, 'name' | 'description' | 'tone'>>): ServerFolder | null {
  const db = getDatabase();
  const folder = db.folders.find((f) => f.id === id);
  if (!folder) return null;
  if (updates.name) folder.name = updates.name.trim();
  if (updates.description !== undefined) folder.description = updates.description.trim();
  if (updates.tone !== undefined) {
    folder.tone = updates.tone.trim();
    // Also propagate to all projects currently in this folder
    db.projects.forEach((p) => {
      if (p.folderId === id) {
        p.tone = folder.tone || 'cinematic';
      }
    });
  }
  folder.updatedAt = new Date().toISOString();
  saveDatabaseSync();
  return folder;
}

export function deleteFolder(id: string): boolean {
  const db = getDatabase();
  const initialLength = db.folders.length;
  db.folders = db.folders.filter((f) => f.id !== id);
  // Also remove all projects in this folder
  db.projects = db.projects.filter((p) => p.folderId !== id);
  if (db.folders.length !== initialLength) {
    saveDatabaseSync();
    return true;
  }
  return false;
}

export function batchReplaceInFolder(
  folderId: string,
  options: {
    findText: string;
    replaceText: string;
    scope?: 'translated' | 'both';
    matchCase?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
  }
): {
  totalReplacements: number;
  affectedFilesCount: number;
  fileDetails: Array<{ fileId: string; fileName: string; count: number }>;
} {
  const db = getDatabase();
  const projects = db.projects.filter((p) => p.folderId === folderId);
  const { findText, replaceText, scope = 'translated', matchCase = false, wholeWord = false, useRegex = false } = options;

  let pattern: RegExp;
  try {
    if (useRegex) {
      pattern = new RegExp(findText, matchCase ? 'g' : 'gi');
    } else {
      let escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) {
        escaped = `\\b${escaped}\\b`;
      }
      pattern = new RegExp(escaped, matchCase ? 'g' : 'gi');
    }
  } catch {
    return { totalReplacements: 0, affectedFilesCount: 0, fileDetails: [] };
  }

  let totalReplacements = 0;
  const fileDetails: Array<{ fileId: string; fileName: string; count: number }> = [];

  for (const project of projects) {
    let projectCount = 0;
    project.items = project.items.map((item) => {
      let modified = false;
      let newTranslated = item.translatedText;
      let newOriginal = item.originalText;

      if (scope === 'translated' || scope === 'both') {
        if (newTranslated) {
          const matches = newTranslated.match(pattern);
          if (matches) {
            projectCount += matches.length;
            newTranslated = newTranslated.replace(pattern, replaceText);
            modified = true;
          }
        }
      }

      if (scope === 'both') {
        if (newOriginal) {
          const matches = newOriginal.match(pattern);
          if (matches) {
            projectCount += matches.length;
            newOriginal = newOriginal.replace(pattern, replaceText);
            modified = true;
          }
        }
      }

      if (modified) {
        return {
          ...item,
          translatedText: newTranslated,
          originalText: newOriginal,
        };
      }
      return item;
    });

    if (projectCount > 0) {
      project.updatedAt = new Date().toISOString();
      totalReplacements += projectCount;
      fileDetails.push({
        fileId: project.id,
        fileName: project.name,
        count: projectCount,
      });
    }
  }

  if (totalReplacements > 0) {
    saveDatabaseSync();
  }

  return {
    totalReplacements,
    affectedFilesCount: fileDetails.length,
    fileDetails,
  };
}

// ─── Project Operations ───────────────────────────────────────────────────────

export function getProjectsByFolder(folderId: string): ServerSubtitleProject[] {
  const db = getDatabase();
  return db.projects.filter((p) => p.folderId === folderId);
}

export function getAllProjects(): ServerSubtitleProject[] {
  const db = getDatabase();
  return db.projects;
}

export function getProjectById(id: string): ServerSubtitleProject | undefined {
  const db = getDatabase();
  return db.projects.find((p) => p.id === id);
}

export function createProject(data: {
  folderId: string;
  name: string;
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'sub';
  rawHeader?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  tone?: string;
  customPrompt?: string;
  items: SubtitleItem[];
  autoQueue?: boolean;
}): ServerSubtitleProject {
  const db = getDatabase();
  const totalCues = data.items.length;
  const translatedCues = data.items.filter((i) => Boolean(i.translatedText && i.translatedText.trim())).length;

  const project: ServerSubtitleProject = {
    id: 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
    folderId: data.folderId,
    name: data.name,
    format: data.format,
    rawHeader: data.rawHeader,
    sourceLanguage: data.sourceLanguage || 'auto',
    targetLanguage: data.targetLanguage || 'fa',
    tone: data.tone || 'cinematic',
    customPrompt: data.customPrompt,
    status: data.autoQueue ? 'queued' : 'idle',
    totalCues,
    translatedCues,
    currentBatchIndex: 0,
    totalBatches: Math.ceil(totalCues / 25),
    items: data.items,
    tokenUsage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.projects.push(project);
  saveDatabaseSync();
  return project;
}

export function updateProject(id: string, updates: Partial<ServerSubtitleProject>): ServerSubtitleProject | null {
  const db = getDatabase();
  const project = db.projects.find((p) => p.id === id);
  if (!project) return null;

  Object.assign(project, updates);
  project.updatedAt = new Date().toISOString();
  scheduleSaveDatabase();
  return project;
}

export function deleteProject(id: string): boolean {
  const db = getDatabase();
  const initialLength = db.projects.length;
  db.projects = db.projects.filter((p) => p.id !== id);
  if (db.projects.length !== initialLength) {
    saveDatabaseSync();
    return true;
  }
  return false;
}

// ─── Server Configuration Operations ──────────────────────────────────────────

export function getServerConfig(): ServerConfig {
  const db = getDatabase();
  if (!db.serverConfig) {
    db.serverConfig = { ...DEFAULT_SERVER_CONFIG };
    saveDatabaseSync();
  }
  return db.serverConfig;
}

export function updateServerConfig(updates: Partial<ServerConfig>): ServerConfig {
  const db = getDatabase();
  if (!db.serverConfig) {
    db.serverConfig = { ...DEFAULT_SERVER_CONFIG };
  }
  if (updates.allowedOrigin !== undefined) {
    db.serverConfig.allowedOrigin = updates.allowedOrigin.trim() || '*';
  }
  if (updates.geminiBaseUrl !== undefined) {
    db.serverConfig.geminiBaseUrl = updates.geminiBaseUrl.trim() || 'https://generativelanguage.googleapis.com';
  }
  if (updates.maxConcurrentProjects !== undefined) {
    const val = Number(updates.maxConcurrentProjects);
    db.serverConfig.maxConcurrentProjects = Math.max(1, Math.min(val || 2, 8));
  }
  saveDatabaseSync();
  return db.serverConfig;
}

// ─── Server Key Pool Operations ──────────────────────────────────────────────

export function getServerKeys(): string[] {
  const db = getDatabase();
  const envKey = process.env.GEMINI_API_KEY?.trim();
  const set = new Set<string>();
  if (envKey) set.add(envKey);
  (db.serverKeys || []).forEach((k) => {
    if (k && k.trim()) set.add(k.trim());
  });
  return Array.from(set);
}

export function addServerKeys(newKeys: string[]): string[] {
  const db = getDatabase();
  const current = new Set(db.serverKeys);
  newKeys.forEach((k) => {
    const trimmed = k.trim();
    if (trimmed) current.add(trimmed);
  });
  db.serverKeys = Array.from(current);
  saveDatabaseSync();
  return getServerKeys();
}

export function setServerKeys(keys: string[]): string[] {
  const db = getDatabase();
  db.serverKeys = keys.map((k) => k.trim()).filter(Boolean);
  saveDatabaseSync();
  return getServerKeys();
}

export function updateSingleServerKey(index: number, newKey: string): string[] {
  const db = getDatabase();
  const trimmed = newKey.trim();
  if (!trimmed) {
    throw new Error('کلید جدید نمی‌تواند خالی باشد.');
  }
  if (index >= 0 && index < db.serverKeys.length) {
    db.serverKeys[index] = trimmed;
    saveDatabaseSync();
  } else {
    // If updating index equal to length, append
    db.serverKeys.push(trimmed);
    saveDatabaseSync();
  }
  return getServerKeys();
}

export function deleteSingleServerKey(index: number): string[] {
  const db = getDatabase();
  if (index >= 0 && index < db.serverKeys.length) {
    db.serverKeys.splice(index, 1);
    if (db.activeKeyIndex >= db.serverKeys.length) {
      db.activeKeyIndex = Math.max(0, db.serverKeys.length - 1);
    }
    saveDatabaseSync();
  }
  return getServerKeys();
}

export function getServerKeysWithDetails(): Array<{
  index: number;
  rawKey: string;
  maskedKey: string;
  isExhausted: boolean;
  cooldownRemainingSec: number;
}> {
  const allKeys = getServerKeys();
  const now = Date.now();
  return allKeys.map((k, index) => {
    const entry = exhaustedKeysMap.get(k);
    const isExhausted = entry ? (now - entry.timestamp <= KEY_EXHAUSTION_COOLDOWN_MS) : false;
    const cooldownRemainingSec = entry && isExhausted ? Math.max(0, Math.ceil((KEY_EXHAUSTION_COOLDOWN_MS - (now - entry.timestamp)) / 1000)) : 0;
    const len = k.length;
    const maskedKey = len > 8 ? k.substring(0, 4) + '...' + k.substring(len - 4) : '****';
    return {
      index,
      rawKey: k,
      maskedKey,
      isExhausted,
      cooldownRemainingSec,
    };
  });
}

export function getActiveKeyIndex(): number {
  const db = getDatabase();
  return db.activeKeyIndex || 0;
}

export function rotateActiveKeyIndex(): number {
  const db = getDatabase();
  const allKeys = getServerKeys();
  if (allKeys.length <= 1) return 0;
  db.activeKeyIndex = ((db.activeKeyIndex || 0) + 1) % allKeys.length;
  saveDatabaseSync();
  return db.activeKeyIndex;
}

// ─── Key Exhaustion & Cooldown Tracking ──────────────────────────────────────

const exhaustedKeysMap = new Map<string, { timestamp: number; reason: string }>();
const KEY_EXHAUSTION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes cooldown when token/quota depleted

export function markKeyAsExhausted(key: string, reason: string = 'Quota exhausted (429)'): void {
  exhaustedKeysMap.set(key, { timestamp: Date.now(), reason });
  console.log(`[KeyPool] Key marked as EXHAUSTED: ${key.slice(0, 6)}... (${reason}). Will not be queried until rotation cycle resets.`);
}

export function isKeyExhausted(key: string): boolean {
  const entry = exhaustedKeysMap.get(key);
  if (!entry) return false;
  if (Date.now() - entry.timestamp > KEY_EXHAUSTION_COOLDOWN_MS) {
    exhaustedKeysMap.delete(key);
    return false;
  }
  return true;
}

/**
 * Lease an available, non-exhausted key from the pool.
 * If excludeKeys is provided, avoids choosing a key currently locked by another parallel worker.
 */
export function leaseAvailableKey(excludeKeys: string[] = []): { key: string; index: number; total: number } | null {
  const allKeys = getServerKeys();
  if (allKeys.length === 0) return null;

  const excludedSet = new Set(excludeKeys);
  const startIdx = getActiveKeyIndex() % allKeys.length;

  // First pass: find key that is NOT exhausted and NOT in excludeKeys
  for (let i = 0; i < allKeys.length; i++) {
    const candidateIdx = (startIdx + i) % allKeys.length;
    const candidateKey = allKeys[candidateIdx];
    if (!isKeyExhausted(candidateKey) && !excludedSet.has(candidateKey)) {
      return { key: candidateKey, index: candidateIdx, total: allKeys.length };
    }
  }

  // Second pass: if all free keys are excluded, allow sharing if not exhausted
  for (let i = 0; i < allKeys.length; i++) {
    const candidateIdx = (startIdx + i) % allKeys.length;
    const candidateKey = allKeys[candidateIdx];
    if (!isKeyExhausted(candidateKey)) {
      return { key: candidateKey, index: candidateIdx, total: allKeys.length };
    }
  }

  // If ALL keys are exhausted, check cooldowns
  const anyNonExhausted = allKeys.some((k) => !isKeyExhausted(k));
  if (!anyNonExhausted) {
    console.warn('[KeyPool] All keys in pool are currently exhausted.');
    return null;
  }

  return { key: allKeys[startIdx], index: startIdx, total: allKeys.length };
}

export function getActiveAvailableKey(): { key: string; index: number; total: number } | null {
  return leaseAvailableKey([]);
}

export function getKeyExhaustionStatus(): Array<{ keyMasked: string; isExhausted: boolean; cooldownRemainingSec: number }> {
  const allKeys = getServerKeys();
  const now = Date.now();
  return allKeys.map((k) => {
    const entry = exhaustedKeysMap.get(k);
    const isExhausted = entry ? (now - entry.timestamp <= KEY_EXHAUSTION_COOLDOWN_MS) : false;
    const cooldownRemainingSec = entry && isExhausted ? Math.max(0, Math.ceil((KEY_EXHAUSTION_COOLDOWN_MS - (now - entry.timestamp)) / 1000)) : 0;
    const len = k.length;
    const keyMasked = len > 8 ? k.substring(0, 4) + '...' + k.substring(len - 4) : '****';
    return { keyMasked, isExhausted, cooldownRemainingSec };
  });
}

// ─── Project Retranslation & Incomplete Reset ────────────────────────────────

export function resetProjectTranslation(projectId: string, onlyIncomplete: boolean = false): ServerSubtitleProject | null {
  const db = getDatabase();
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) return null;

  if (onlyIncomplete) {
    // Keep already translated lines, just clear any failed states and queue project
    project.status = 'queued';
    project.errorMessage = undefined;
    project.lastError = undefined;
    project.failedCueIds = [];
    project.translatedCues = project.items.filter((i) => Boolean(i.translatedText && i.translatedText.trim())).length;
  } else {
    // Retranslate all from scratch
    project.status = 'queued';
    project.errorMessage = undefined;
    project.lastError = undefined;
    project.failedCueIds = [];
    project.currentBatchIndex = 0;
    project.translatedCues = 0;
    project.completedAt = undefined;
    project.items.forEach((item) => {
      item.translatedText = '';
    });
  }

  project.updatedAt = new Date().toISOString();
  saveDatabaseSync();
  return project;
}

// ─── Database Backup & Restore Operations ────────────────────────────────────

export function createBackupJson(): string {
  const db = getDatabase();
  const backup = {
    exportedAt: new Date().toISOString(),
    version: db.version,
    app: 'SubGame Lab',
    databaseFilePath: DB_FILE,
    folders: db.folders,
    projects: db.projects,
    stats: db.stats,
    serverKeysCount: db.serverKeys.length,
    serverKeys: db.serverKeys,
  };
  return JSON.stringify(backup, null, 2);
}

export function restoreBackupJson(jsonString: string): { success: boolean; foldersCount: number; projectsCount: number; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || !Array.isArray(parsed.folders) || !Array.isArray(parsed.projects)) {
      return { success: false, foldersCount: 0, projectsCount: 0, error: 'فرمت فایل پشتیبان نامعتبر است.' };
    }

    const db = getDatabase();
    db.folders = parsed.folders;
    db.projects = parsed.projects;
    if (parsed.stats) db.stats = parsed.stats;
    if (Array.isArray(parsed.serverKeys) && parsed.serverKeys.length > 0) {
      db.serverKeys = parsed.serverKeys;
    }
    saveDatabaseSync();
    return {
      success: true,
      foldersCount: db.folders.length,
      projectsCount: db.projects.length,
    };
  } catch (err: any) {
    return { success: false, foldersCount: 0, projectsCount: 0, error: err?.message || 'خطا در خواندن فایل پشتیبان' };
  }
}

export function getDatabaseFilePath(): string {
  return DB_FILE;
}

