import { GoogleGenAI } from '@google/genai';
import { 
  getDatabase, 
  getAllProjects, 
  getProjectById, 
  updateProject, 
  getServerKeys, 
  getActiveKeyIndex, 
  rotateActiveKeyIndex,
  leaseAvailableKey,
  markKeyAsExhausted,
  isKeyExhausted,
  saveDatabaseSync, 
  getServerConfig,
  resetProjectTranslation,
  ServerSubtitleProject 
} from './database';

const FLASH_LITE_MODEL = 'gemini-3.1-flash-lite';
const BATCH_SIZE = 20;

// Rate limiting & RPM pacing (minimum gap between requests on the same key ensures <15 RPM without hitting 429)
const lastKeyCallTime = new Map<string, number>();
const MIN_CALL_GAP_PER_KEY_MS = 4200; // 4.2 seconds minimum gap per key

let workerInterval: NodeJS.Timeout | null = null;
const activeProjectJobIds = new Set<string>();
const busyKeys = new Set<string>();

export interface ActiveProjectSummary {
  id: string;
  name: string;
  folderId: string;
  progressPercent: number;
  translatedCues: number;
  totalCues: number;
  keyMasked: string;
}

export interface WorkerStatus {
  isRunning: boolean;
  activeProjectCount: number;
  maxConcurrentProjects: number;
  activeProjects: ActiveProjectSummary[];
  // Backwards compatibility single-project properties
  activeProjectId: string | null;
  activeProjectName: string | null;
  folderId: string | null;
  progressPercent: number;
  translatedCues: number;
  totalCues: number;
  currentKeyIndex: number;
  totalKeys: number;
  activeKeys: number;
  exhaustedKeys: number;
  lastMessage: string;
}

let lastWorkerStatusMessage = 'موتور ترجمه چندمسیره پس‌زمینه آماده است (مدل: Gemini 3.5 Flash Lite).';

export function getWorkerStatus(): WorkerStatus {
  const allKeys = getServerKeys();
  const db = getDatabase();
  const config = getServerConfig();

  const translatingProjects = db.projects.filter(
    (p) => p.status === 'translating' || activeProjectJobIds.has(p.id)
  );

  const activeProjectsSummaries: ActiveProjectSummary[] = translatingProjects.map((p) => {
    const pct = p.totalCues > 0 ? Math.round((p.translatedCues / p.totalCues) * 100) : 0;
    const workerKey = p.workerKeyUsed || '';
    const keyMasked = workerKey.length > 8 ? workerKey.substring(0, 4) + '...' + workerKey.substring(workerKey.length - 4) : 'کلید سرور';
    return {
      id: p.id,
      name: p.name,
      folderId: p.folderId,
      progressPercent: pct,
      translatedCues: p.translatedCues,
      totalCues: p.totalCues,
      keyMasked,
    };
  });

  const firstActive = translatingProjects[0];
  const queuedProject = db.projects.find((p) => p.status === 'queued');

  const exhaustedCount = allKeys.filter((k) => isKeyExhausted(k)).length;
  const activeKeysCount = Math.max(0, allKeys.length - exhaustedCount);

  return {
    isRunning: Boolean(workerInterval),
    activeProjectCount: translatingProjects.length,
    maxConcurrentProjects: config.maxConcurrentProjects || 2,
    activeProjects: activeProjectsSummaries,
    activeProjectId: firstActive ? firstActive.id : (queuedProject ? queuedProject.id : null),
    activeProjectName: firstActive ? firstActive.name : (queuedProject ? queuedProject.name : null),
    folderId: firstActive ? firstActive.folderId : (queuedProject ? queuedProject.folderId : null),
    progressPercent: firstActive && firstActive.totalCues > 0 ? Math.round((firstActive.translatedCues / firstActive.totalCues) * 100) : 0,
    translatedCues: firstActive ? firstActive.translatedCues : 0,
    totalCues: firstActive ? firstActive.totalCues : (queuedProject ? queuedProject.totalCues : 0),
    currentKeyIndex: getActiveKeyIndex() + 1,
    totalKeys: allKeys.length,
    activeKeys: activeKeysCount,
    exhaustedKeys: exhaustedCount,
    lastMessage: lastWorkerStatusMessage,
  };
}

/**
 * Initialize a GoogleGenAI instance with the specified key and configurable baseUrl
 */
function createGenAI(apiKey: string, customBaseUrl?: string): GoogleGenAI {
  const config = getServerConfig();
  const rawBaseUrl = customBaseUrl?.trim() || config.geminiBaseUrl?.trim() || process.env.GEMINI_BASE_URL?.trim() || '';
  
  // Normalize baseUrl if provided
  let normalizedBaseUrl: string | undefined = undefined;
  if (rawBaseUrl && rawBaseUrl !== 'https://generativelanguage.googleapis.com') {
    normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, '');
  }

  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      baseUrl: normalizedBaseUrl,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Server-Side API Key Verification (runs 100% on server, completely independent of user's browser)
 */
export async function testServerKey(apiKey: string): Promise<{
  success: boolean;
  latencyMs: number;
  message: string;
  error?: string;
}> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { success: false, latencyMs: 0, message: 'کلید API خالی است.' };
  }

  const start = Date.now();
  try {
    const ai = createGenAI(cleanKey);
    const res = await ai.models.generateContent({
      model: FLASH_LITE_MODEL,
      contents: 'Ping',
      config: {
        maxOutputTokens: 5,
      },
    });

    const latencyMs = Date.now() - start;
    if (res.text !== undefined) {
      return {
        success: true,
        latencyMs,
        message: `اتصال موفق و کلید معتبر است (پاسخ در ${latencyMs}ms با Gemini 3.5 Flash Lite).`,
      };
    }
    return {
      success: false,
      latencyMs,
      message: 'پاسخ نامعتبر از سرور جمینای دریافت شد.',
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const msg = String(err?.message || err);
    let userMsg = `خطا در تست کلید: ${msg}`;
    if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('resource_exhausted')) {
      userMsg = 'سهمیه این کلید موقتاً به اتمام رسیده است (429 Quota Exhausted). سرور از کلید بعدی استفاده خواهد کرد.';
    } else if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('invalid api key')) {
      userMsg = 'کلید API نامعتبر است (Authentication / API Key Invalid).';
    }
    return {
      success: false,
      latencyMs,
      message: userMsg,
      error: msg,
    };
  }
}

/**
 * High-quality Subtitle System Prompt
 */
function buildSubtitlePrompt(
  items: Array<{ id: number; text: string }>,
  targetLanguage: string,
  tone: string,
  customPrompt?: string
): { systemInstruction: string; userContent: string } {
  const toneMap: Record<string, string> = {
    cinematic: 'سینمایی، فاخر و دراماتیک (لحن شیوا و متناسب با فیلم‌ها و مستندهای برجسته)',
    conversational: 'محاوره‌ای، روان و عامیانه (زبان صمیمی، اصطلاحات روزمره و طبیعی)',
    formal: 'رسمی، کتابی و علمی (وفاداری کامل به واژگان معیار و علمی)',
    epic: 'حماسی، افسانه‌ای و پرشور (مناسب متون تاریخی، کیهانی و علمی-تخیلی)',
    humorous: 'طنز، شاداب و طعنه‌آمیز با حفظ اصطلاحات طنز فرهنگ مقصد',
  };

  const selectedTone = toneMap[tone] || toneMap.cinematic;

  const systemInstruction = `شما یک مترجم ارشد زیرنویس‌های سینمایی، مستندهای علمی و سریال‌های تلویزیونی هستید.
زبان مقصد: ${targetLanguage === 'fa' ? 'فارسی (Persian)' : targetLanguage}
لحن ترجمه: ${selectedTone}
${customPrompt ? `دستورالعمل ویژه کاربر: "${customPrompt}"` : ''}

قوانین حیاتی ترجمه زیرنویس:
۱. هماهنگی و یکدستی لحن: جملات باید با جریان طبیعی مکالمات فیلم هماهنگ باشند. از ترجمه ماشینی کلمه‌به‌کلمه اکیداً خودداری کرده و مفهوم اصطلاحات را به زیباترین و شیواترین شکل برگردانید.
۲. حفظ تگ‌ها و کاراکترهای فنی: تگ‌های HTML نظیر <i>, </i>, <b>, </b> و کدهای زیرنویس نظیر {\\an8} یا \\n را دقیقاً در جای مناسب نگه دارید و دست‌نخورده بازگردانید.
۳. تایم‌بندی و شناسه‌ها: هر آیتم دارای یک شناسه (id) مشخص است. ترجمه دقیق هر آیتم باید فقط در فیلد text بازگردانده شود. هیچ آیتمی نباید ادغام، حذف یا جا انداخته شود.
۴. فرمت پاسخ: فقط و فقط یک آبجکت JSON معتبر به فرمت زیر بدون هیچ متن یا توضیحات اضافی بازگردانید:
{
  "translations": [
    { "id": 1, "text": "متن ترجمه شده" }
  ]
}`;

  const userContent = JSON.stringify(items);

  return { systemInstruction, userContent };
}

/**
 * Execute translation of a single batch using a leased API key with auto-fallback to alternate keys
 */
async function translateBatchWithDedicatedKey(
  items: Array<{ id: number; text: string }>,
  targetLanguage: string,
  tone: string,
  customPrompt: string | undefined,
  primaryKey: string,
  candidateKeys: string[]
): Promise<{
  translations: Array<{ id: number; text: string }>;
  tokens: { prompt: number; candidates: number; total: number };
  keyUsed: string;
}> {
  const { systemInstruction, userContent } = buildSubtitlePrompt(items, targetLanguage, tone, customPrompt);

  const keysQueue = [primaryKey, ...candidateKeys.filter((k) => k !== primaryKey)];

  let lastErr: any = null;

  for (let kIdx = 0; kIdx < keysQueue.length; kIdx++) {
    const currentKey = keysQueue[kIdx];
    if (isKeyExhausted(currentKey) && keysQueue.length > 1) {
      continue;
    }

    // RPM Pacing: ensure minimum 4.2 seconds elapsed since last call on this specific key
    const lastCall = lastKeyCallTime.get(currentKey) || 0;
    const elapsedSinceLastCall = Date.now() - lastCall;
    if (elapsedSinceLastCall < MIN_CALL_GAP_PER_KEY_MS) {
      const waitMs = MIN_CALL_GAP_PER_KEY_MS - elapsedSinceLastCall;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    lastKeyCallTime.set(currentKey, Date.now());

    try {
      const ai = createGenAI(currentKey);
      const response = await ai.models.generateContent({
        model: FLASH_LITE_MODEL,
        contents: userContent,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        },
      });

      const rawText = response.text || '';
      let parsedJson: any = null;

      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedJson = JSON.parse(jsonMatch[0]);
        }
      }

      if (parsedJson && Array.isArray(parsedJson.translations) && parsedJson.translations.length > 0) {
        const usage = response.usageMetadata;
        return {
          translations: parsedJson.translations,
          tokens: {
            prompt: usage?.promptTokenCount || 0,
            candidates: usage?.candidatesTokenCount || 0,
            total: usage?.totalTokenCount || 0,
          },
          keyUsed: currentKey,
        };
      } else {
        throw new Error('پاسخ مدل نامعتبر بود یا ترجمه خالی بازگشت.');
      }
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err);
      const isRateLimit =
        msg.includes('429') ||
        msg.toLowerCase().includes('quota') ||
        msg.toLowerCase().includes('resource_exhausted') ||
        msg.toLowerCase().includes('tokens');

      const isAuthError =
        msg.includes('401') ||
        msg.includes('403') ||
        msg.toLowerCase().includes('invalid api key') ||
        msg.toLowerCase().includes('permission_denied');

      if (isRateLimit || isAuthError) {
        markKeyAsExhausted(currentKey, isRateLimit ? 'اتمام توکن/سهمیه (429)' : 'کلید نامعتبر');
        console.warn(`[BackgroundWorker] Key exhausted (${isRateLimit ? '429 RateLimit' : 'Auth'}). Switching to next available key...`);
        // Proceed to next key in queue
        continue;
      } else {
        console.warn(`[BackgroundWorker] Non-rate-limit error: ${msg.slice(0, 120)}`);
        // Short pause and try next key
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }

  throw lastErr || new Error('خطا در ترجمه بسته پس از بررسی تمام کلیدهای فعال.');
}

/**
 * Process a single project batch inside a dedicated worker slot
 */
async function processSingleProjectBatch(projectId: string): Promise<void> {
  const project = getProjectById(projectId);
  if (!project) return;

  // Find cues in this project that still need translation
  const untranslatedCues = project.items.filter((item) => !item.translatedText || !item.translatedText.trim());

  if (untranslatedCues.length === 0) {
    project.status = 'completed';
    project.completedAt = new Date().toISOString();
    project.translatedCues = project.totalCues;
    project.errorMessage = undefined;
    project.lastError = undefined;
    saveDatabaseSync();
    lastWorkerStatusMessage = `ترجمه فایل "${project.name}" با موفقیت ۱۰۰٪ پایان یافت.`;
    console.log(`[BackgroundWorker] Project ${project.name} (${project.id}) fully completed!`);
    return;
  }

  // Lease a key from pool that is not locked by another concurrent worker
  const allKeys = getServerKeys();
  if (allKeys.length === 0) {
    project.status = 'waiting_for_keys';
    project.lastError = 'کلید API جمینای در سرور تنظیم نشده است. لطفاً در پنل مدیریت، کلیدهای Gemini را وارد کنید.';
    project.errorMessage = project.lastError;
    saveDatabaseSync();
    return;
  }

  const keyInfo = leaseAvailableKey(Array.from(busyKeys));
  if (!keyInfo) {
    // All keys in the pool are exhausted or locked
    project.status = 'waiting_for_keys';
    project.lastError = 'تمامی کلیدهای سرور موقتاً سهمیه خود را تمام کرده‌اند (429). ترجمه به طور خودکار به محض آزادسازی کلید یا افزودن کلید جدید ادامه خواهد یافت (تمام سطرهای قبلی ذخیره شده‌اند).';
    project.errorMessage = project.lastError;
    saveDatabaseSync();
    lastWorkerStatusMessage = 'تمامی کلیدهای سرور در وضعیت خنک‌سازی هستند. سطرها ذخیره شده و منتظر بازیابی سهمیه...';
    return;
  }

  const leasedKey = keyInfo.key;
  busyKeys.add(leasedKey);
  project.workerKeyUsed = leasedKey;
  project.status = 'translating';

  const batchCues = untranslatedCues.slice(0, BATCH_SIZE);
  const simplifiedBatch = batchCues.map((c) => ({ id: c.id, text: c.originalText }));

  try {
    const result = await translateBatchWithDedicatedKey(
      simplifiedBatch,
      project.targetLanguage,
      project.tone,
      project.customPrompt,
      leasedKey,
      allKeys
    );

    // Update translated items in memory (strictly preserving original timestamps and cue ordering)
    const resultMap = new Map<number, string>();
    result.translations.forEach((t) => {
      if (t && typeof t.id === 'number' && t.text) {
        resultMap.set(t.id, t.text.trim());
      }
    });

    for (const item of project.items) {
      if (resultMap.has(item.id)) {
        item.translatedText = resultMap.get(item.id)!;
      }
    }

    // Update counts & token stats
    project.translatedCues = project.items.filter((i) => Boolean(i.translatedText && i.translatedText.trim())).length;
    project.tokenUsage.promptTokens += result.tokens.prompt;
    project.tokenUsage.candidatesTokens += result.tokens.candidates;
    project.tokenUsage.totalTokens += result.tokens.total;
    project.currentBatchIndex++;
    project.totalBatches = Math.ceil(project.totalCues / BATCH_SIZE);
    project.lastError = undefined;
    project.errorMessage = undefined;

    const db = getDatabase();
    db.stats.totalTokensUsed += result.tokens.total;
    db.stats.totalTranslations++;

    if (project.translatedCues >= project.totalCues) {
      project.status = 'completed';
      project.completedAt = new Date().toISOString();
      lastWorkerStatusMessage = `ترجمه فایل "${project.name}" با موفقیت تکمیل شد.`;
    } else {
      const pct = Math.round((project.translatedCues / project.totalCues) * 100);
      lastWorkerStatusMessage = `فایل "${project.name}": ترجمه ${project.translatedCues} از ${project.totalCues} سطر (${pct}%)`;
    }

    // Save progress to persistent JSON disk storage immediately!
    saveDatabaseSync();
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`[BackgroundWorker] Batch error for ${project.name}:`, errMsg);

    const isAllExhausted = allKeys.every((k) => isKeyExhausted(k));
    if (isAllExhausted) {
      project.status = 'waiting_for_keys';
      project.lastError = 'سهمیه کلیدهای سرور تمام شد. ترجمه بدون از دست رفتن سطرها متوقف و منتظر بازیابی سهمیه است.';
      project.errorMessage = project.lastError;
    } else {
      project.status = 'has_incomplete';
      project.lastError = `خطا در ترجمه دسته سطرهای اخیر: ${errMsg}`;
      project.errorMessage = project.lastError;
      project.failedCueIds = batchCues.map((c) => c.id);
    }

    saveDatabaseSync();
    lastWorkerStatusMessage = `خطا در ترجمه "${project.name}": ${errMsg.slice(0, 80)}`;
  } finally {
    busyKeys.delete(leasedKey);
  }
}

/**
 * Main Worker Tick: Dispatches parallel project jobs up to maxConcurrentProjects
 */
async function processTick(): Promise<void> {
  const db = getDatabase();
  const config = getServerConfig();
  const allKeys = getServerKeys();

  // If no keys configured, do not dispatch
  if (allKeys.length === 0) return;

  const maxWorkers = Math.max(1, Math.min(config.maxConcurrentProjects || 2, Math.max(1, allKeys.length)));

  // Check how many worker slots are open
  const availableSlots = maxWorkers - activeProjectJobIds.size;
  if (availableSlots <= 0) return;

  // Find candidate projects needing work:
  // 1. Projects already marked 'translating'
  // 2. Projects in 'queued' status
  // 3. Projects in 'waiting_for_keys' (if non-exhausted keys are now available)
  const candidateProjects = db.projects.filter((p) => {
    if (activeProjectJobIds.has(p.id)) return false;
    if (p.status === 'translating') return true;
    if (p.status === 'queued') return true;
    if (p.status === 'waiting_for_keys') {
      // Check if any non-exhausted keys are now available
      return allKeys.some((k) => !isKeyExhausted(k));
    }
    return false;
  });

  const projectsToDispatch = candidateProjects.slice(0, availableSlots);

  for (const project of projectsToDispatch) {
    activeProjectJobIds.add(project.id);
    project.status = 'translating';
    saveDatabaseSync();

    // Run each project batch concurrently
    void (async () => {
      try {
        await processSingleProjectBatch(project.id);
      } catch (e) {
        console.error(`[BackgroundWorker] Unexpected error in worker for ${project.id}:`, e);
      } finally {
        activeProjectJobIds.delete(project.id);
      }
    })();
  }
}

/**
 * Start the autonomous background loop
 */
export function startBackgroundWorker(): void {
  if (workerInterval) return;
  console.log('⚡ [BackgroundWorker] Subtitle Autonomous Parallel Translation Engine started.');
  workerInterval = setInterval(() => {
    void processTick().catch((err) => {
      console.error('[BackgroundWorker] Unhandled loop error:', err);
    });
  }, 1800);
}

/**
 * Stop background worker loop
 */
export function stopBackgroundWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[BackgroundWorker] Background worker stopped.');
  }
}

/**
 * Queue all pending projects in a folder
 */
export function queueFolderForTranslation(folderId: string): number {
  const db = getDatabase();
  const folderProjects = db.projects.filter(
    (p) => p.folderId === folderId && p.status !== 'completed' && p.status !== 'translating'
  );

  folderProjects.forEach((p) => {
    p.status = 'queued';
    p.lastError = undefined;
    p.errorMessage = undefined;
  });

  saveDatabaseSync();
  return folderProjects.length;
}

/**
 * Pause all translating or queued projects in a folder
 */
export function pauseFolderTranslation(folderId: string): number {
  const db = getDatabase();
  const folderProjects = db.projects.filter(
    (p) => p.folderId === folderId && (p.status === 'translating' || p.status === 'queued' || p.status === 'waiting_for_keys')
  );

  folderProjects.forEach((p) => {
    p.status = 'paused';
  });

  saveDatabaseSync();
  return folderProjects.length;
}

/**
 * Resume a single project
 */
export function resumeSingleProject(projectId: string): boolean {
  const project = getProjectById(projectId);
  if (!project) return false;
  project.status = 'queued';
  project.lastError = undefined;
  project.errorMessage = undefined;
  saveDatabaseSync();
  return true;
}

/**
 * Restart translation for a project (optionally only incomplete lines or all)
 */
export function restartProject(projectId: string, onlyIncomplete: boolean = false): boolean {
  const updated = resetProjectTranslation(projectId, onlyIncomplete);
  return Boolean(updated);
}

/**
 * Queue a single project
 */
export function queueSingleProject(projectId: string): boolean {
  return resumeSingleProject(projectId);
}

/**
 * Pause a single project
 */
export function pauseSingleProject(projectId: string): boolean {
  const project = getProjectById(projectId);
  if (!project) return false;
  project.status = 'paused';
  saveDatabaseSync();
  return true;
}
