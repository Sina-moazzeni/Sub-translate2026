import { GoogleGenAI } from '@google/genai';
import { 
  getDatabase, 
  getAllProjects, 
  getProjectById, 
  updateProject, 
  getServerKeys, 
  getActiveKeyIndex, 
  rotateActiveKeyIndex, 
  saveDatabaseSync, 
  ServerSubtitleProject 
} from './database';

const FLASH_LITE_MODEL = 'gemini-3.1-flash-lite';
const BATCH_SIZE = 20;

let workerInterval: NodeJS.Timeout | null = null;
let isProcessingBatch = false;
let consecutiveKeyFailures = 0;

export interface WorkerStatus {
  isRunning: boolean;
  activeProjectId: string | null;
  activeProjectName: string | null;
  folderId: string | null;
  progressPercent: number;
  translatedCues: number;
  totalCues: number;
  currentKeyIndex: number;
  totalKeys: number;
  lastMessage: string;
}

let lastWorkerStatusMessage = 'موتور ترجمه پس‌زمینه آماده است.';

export function getWorkerStatus(): WorkerStatus {
  const allKeys = getServerKeys();
  const db = getDatabase();
  const activeProject = db.projects.find((p) => p.status === 'translating');

  if (activeProject) {
    const progressPercent = activeProject.totalCues > 0
      ? Math.round((activeProject.translatedCues / activeProject.totalCues) * 100)
      : 0;

    return {
      isRunning: true,
      activeProjectId: activeProject.id,
      activeProjectName: activeProject.name,
      folderId: activeProject.folderId,
      progressPercent,
      translatedCues: activeProject.translatedCues,
      totalCues: activeProject.totalCues,
      currentKeyIndex: getActiveKeyIndex() + 1,
      totalKeys: allKeys.length,
      lastMessage: lastWorkerStatusMessage,
    };
  }

  const queuedProject = db.projects.find((p) => p.status === 'queued');
  return {
    isRunning: Boolean(workerInterval),
    activeProjectId: queuedProject ? queuedProject.id : null,
    activeProjectName: queuedProject ? queuedProject.name : null,
    folderId: queuedProject ? queuedProject.folderId : null,
    progressPercent: 0,
    translatedCues: 0,
    totalCues: queuedProject ? queuedProject.totalCues : 0,
    currentKeyIndex: getActiveKeyIndex() + 1,
    totalKeys: allKeys.length,
    lastMessage: lastWorkerStatusMessage,
  };
}

/**
 * Initialize a GoogleGenAI instance with the specified key
 */
function createGenAI(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      baseUrl: process.env.GEMINI_BASE_URL?.trim() || undefined,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
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
 * Core Batch Translation with Multi-Key Auto-Rotation and Exponential Backoff Retry Loop
 * "هرگز رها نکند": Will rotate keys and retry until successful
 */
async function translateBatchWithRetry(
  items: Array<{ id: number; text: string }>,
  targetLanguage: string,
  tone: string,
  customPrompt?: string
): Promise<{
  translations: Array<{ id: number; text: string }>;
  tokens: { prompt: number; candidates: number; total: number };
}> {
  const { systemInstruction, userContent } = buildSubtitlePrompt(items, targetLanguage, tone, customPrompt);

  let attempt = 0;
  const maxAttempts = 12; // High retry budget across keys

  while (attempt < maxAttempts) {
    attempt++;
    const allKeys = getServerKeys();
    if (allKeys.length === 0) {
      throw new Error('هیچ کلید API جمینای برای سرور تنظیم نشده است. لطفاً کلید API را اضافه کنید.');
    }

    const keyIndex = getActiveKeyIndex() % allKeys.length;
    const currentKey = allKeys[keyIndex];

    try {
      const ai = createGenAI(currentKey);
      lastWorkerStatusMessage = `ترجمه بسته با کلید #${keyIndex + 1} از ${allKeys.length} (مدل: ${FLASH_LITE_MODEL})...`;

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
        consecutiveKeyFailures = 0;
        const usage = response.usageMetadata;
        return {
          translations: parsedJson.translations,
          tokens: {
            prompt: usage?.promptTokenCount || 0,
            candidates: usage?.candidatesTokenCount || 0,
            total: usage?.totalTokenCount || 0,
          },
        };
      } else {
        throw new Error('فرمت پاسخ مدل معتبر نبود یا ترجمه خالی بازگشت.');
      }
    } catch (err: any) {
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
        console.warn(`[BackgroundWorker] Key #${keyIndex + 1} encountered: ${msg.slice(0, 100)}. Switching to next key...`);
        rotateActiveKeyIndex();
        consecutiveKeyFailures++;

        // If we rotated through all keys, wait briefly before next attempt
        if (consecutiveKeyFailures >= allKeys.length) {
          const waitSec = Math.min(10 * Math.floor(consecutiveKeyFailures / allKeys.length), 45);
          lastWorkerStatusMessage = `سهمیه کلیدها به اتمام رسید. توقف موقت و تلاش مجدد پس از ${waitSec} ثانیه (هرگز متوقف نمی‌شود)...`;
          console.log(`[BackgroundWorker] All keys temporarily busy. Backing off for ${waitSec}s...`);
          await new Promise((r) => setTimeout(r, waitSec * 1000));
        } else {
          // Rapid switch to next key
          await new Promise((r) => setTimeout(r, 1000));
        }
      } else {
        // Other transient network errors
        console.warn(`[BackgroundWorker] Transient error on attempt ${attempt}: ${msg.slice(0, 100)}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  throw new Error('خطا در ترجمه بسته پس از تلاش‌های متوالی با تمامی کلیدها.');
}

/**
 * Worker tick: picks the next project and processes one batch
 */
async function processNextProjectBatch(): Promise<void> {
  if (isProcessingBatch) return;

  const db = getDatabase();
  // Find project currently in 'translating' status, or start the first 'queued' project
  let project = db.projects.find((p) => p.status === 'translating');

  if (!project) {
    const nextQueued = db.projects.find((p) => p.status === 'queued');
    if (nextQueued) {
      nextQueued.status = 'translating';
      saveDatabaseSync();
      project = nextQueued;
    }
  }

  if (!project) {
    // No work to do
    return;
  }

  // Find cues in this project that still need translation
  const untranslatedCues = project.items.filter((item) => !item.translatedText || !item.translatedText.trim());

  if (untranslatedCues.length === 0) {
    // All cues translated! Mark completed
    project.status = 'completed';
    project.completedAt = new Date().toISOString();
    project.translatedCues = project.totalCues;
    saveDatabaseSync();
    lastWorkerStatusMessage = `ترجمه فایل "${project.name}" با موفقیت ۱۰۰٪ پایان یافت.`;
    console.log(`[BackgroundWorker] Project ${project.name} (${project.id}) fully completed!`);
    return;
  }

  isProcessingBatch = true;
  const batchCues = untranslatedCues.slice(0, BATCH_SIZE);
  const simplifiedBatch = batchCues.map((c) => ({ id: c.id, text: c.originalText }));

  try {
    const result = await translateBatchWithRetry(
      simplifiedBatch,
      project.targetLanguage,
      project.tone,
      project.customPrompt
    );

    // Update translated items in memory (strictly preserving original timestamps!)
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

    // Immediately save to persistent database on disk!
    saveDatabaseSync();
  } catch (err: any) {
    console.error(`[BackgroundWorker] Batch failed for ${project.name}:`, err?.message || err);
    lastWorkerStatusMessage = `خطا در بسته: ${err?.message || 'خطای شبکه'}. تلاش مجدد در دور بعدی...`;
  } finally {
    isProcessingBatch = false;
  }
}

/**
 * Start the autonomous background loop
 */
export function startBackgroundWorker(): void {
  if (workerInterval) return;
  console.log('⚡ [BackgroundWorker] Subtitle Autonomous Background Translation Engine started.');
  workerInterval = setInterval(() => {
    void processNextProjectBatch().catch((err) => {
      console.error('[BackgroundWorker] Unhandled loop error:', err);
    });
  }, 2000);
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
    (p) => p.folderId === folderId && (p.status === 'translating' || p.status === 'queued')
  );

  folderProjects.forEach((p) => {
    p.status = 'paused';
  });

  saveDatabaseSync();
  return folderProjects.length;
}

/**
 * Queue a single project
 */
export function queueSingleProject(projectId: string): boolean {
  const project = getProjectById(projectId);
  if (!project) return false;
  project.status = 'queued';
  saveDatabaseSync();
  return true;
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
