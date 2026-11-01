import fs from 'fs';
import path from 'path';
import { SubtitleItem } from '../types';

export interface ServerFolder {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'idle' | 'queued' | 'translating' | 'paused' | 'completed' | 'error';

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

export interface SubtitlesDatabase {
  version: number;
  folders: ServerFolder[];
  projects: ServerSubtitleProject[];
  serverKeys: string[];
  activeKeyIndex: number;
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

export function createFolder(name: string, description?: string): ServerFolder {
  const db = getDatabase();
  const folder: ServerFolder = {
    id: 'folder_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
    name: name.trim(),
    description: description?.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.folders.push(folder);
  saveDatabaseSync();
  return folder;
}

export function updateFolder(id: string, updates: Partial<Pick<ServerFolder, 'name' | 'description'>>): ServerFolder | null {
  const db = getDatabase();
  const folder = db.folders.find((f) => f.id === id);
  if (!folder) return null;
  if (updates.name) folder.name = updates.name.trim();
  if (updates.description !== undefined) folder.description = updates.description.trim();
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
