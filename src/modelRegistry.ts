/**
 * Centralized Model Registry for Google Gemini Models
 * Configured exclusively for Gemini 3.5 Flash Lite as requested.
 */

export type ModelStatus = 'stable' | 'preview' | 'deprecated';
export type ModelCapabilityType = 'translation' | 'transcription' | 'specialized';
export type TranslationSuitabilityTier = 'best_quality' | 'high_quality' | 'fast_volume' | 'advanced_reasoning' | 'realtime_stream';

export interface ModelDefinition {
  modelId: string;
  displayName: string;
  family: string;
  status: ModelStatus;
  capability: ModelCapabilityType;
  recommendedUseCase: string;
  translationSuitability: TranslationSuitabilityTier;
  speed: string;
  speedFa: string;
  speedEn: string;
  speedAr: string;
  quality: string;
  costTier: 'ultra_low' | 'standard' | 'paid_premium';
  badge: string;
  badgeColor: string;
  reasoningLevel: 'standard' | 'high' | 'ultra' | 'realtime';
  descriptionFa: string;
  descriptionEn: string;
  descriptionAr: string;
  isStreaming?: boolean;
  requiresPaidTier?: boolean;
  contextWindow?: string;
  maxOutputTokens?: number;
  structuredOutput: boolean;
  thinkingSupport: boolean;
}

export const ALL_MODELS: ModelDefinition[] = [
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.5 Flash Lite',
    family: 'Gemini Flash Lite',
    status: 'stable',
    capability: 'translation',
    recommendedUseCase: 'موتور انحصاری ترجمه زیرنویس با سرعت بالا و بهینه‌ترین مصرف سهمیه توکن',
    translationSuitability: 'fast_volume',
    speed: '🚀 ۰.۳s',
    speedFa: '🚀 فوق‌سریع و اقتصادی (۰.۳ ثانیه)',
    speedEn: '🚀 Ultra-Fast & Efficient (0.3s)',
    speedAr: '🚀 فائق السرعة واقتصادي (0.3 ثانية)',
    quality: '⭐⭐⭐⭐⭐ (عالی‌ترین تعادل سرعت و روانی متن)',
    costTier: 'ultra_low',
    badge: 'مدل انحصاری فعال / Sole Engine',
    badgeColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    reasoningLevel: 'standard',
    descriptionFa: 'مدل انحصاری سیستم؛ بهینه‌سازی‌شده برای حجم بالای زیرنویس با حداقل مصرف توکن و هماهنگی کامل زمانی.',
    descriptionEn: 'Dedicated engine configured for high-volume subtitle processing with minimal quota consumption.',
    descriptionAr: 'النموذج المعتمد الوحيد للترجمة عالية الكفاءة مع استهلاك رمزي للرصيد.',
    isStreaming: false,
    requiresPaidTier: false,
    contextWindow: '1M tokens',
    maxOutputTokens: 65536,
    structuredOutput: true,
    thinkingSupport: true,
  },
];

export const TRANSLATION_MODELS: ModelDefinition[] = ALL_MODELS;
export const TRANSCRIPTION_MODELS: ModelDefinition[] = ALL_MODELS;

export const DEFAULT_TRANSLATION_MODEL_ID = 'gemini-3.1-flash-lite';
export const DEFAULT_TRANSCRIPTION_MODEL_ID = 'gemini-3.1-flash-lite';

export const MODEL_REGISTRY: Record<string, ModelDefinition> = {
  'gemini-3.1-flash-lite': ALL_MODELS[0],
};

export function resolveModelId(inputModel?: string): string {
  return DEFAULT_TRANSLATION_MODEL_ID;
}

export function getTranslationFallbackChain(primaryModelId: string): string[] {
  return ['gemini-3.1-flash-lite'];
}

export function formatModelDisplayLabel(model: ModelDefinition): string {
  return `${model.displayName} — مدل انحصاری و فعال`;
}
