import React from 'react';
import { UILanguage, TRANSLATIONS } from '../lib/i18n';
import { AI_MODELS } from '../constants';
import { AI_PROVIDERS_CONFIG } from '../lib/providersConfig';
import { AIModelId, AIProvider, CustomProviderConfig, TokenUsageStats } from '../types';
import { 
  Pause, 
  Play, 
  XCircle, 
  Loader2, 
  Zap, 
  Radio, 
  BrainCircuit, 
  Sparkles, 
  Flame,
  Gauge,
  ShieldAlert,
  Clock,
  Server,
  Coins,
  Layers,
  ShieldCheck,
  ArrowRightLeft
} from 'lucide-react';

interface TranslationProgressProps {
  currentBatch: number;
  totalBatches: number;
  translatedLines: number;
  totalLines: number;
  isPaused: boolean;
  onPauseToggle: () => void;
  onCancel: () => void;
  retryInfo?: { batch: number; attempt: number; maxRetries: number } | null;
  uiLang: UILanguage;
  selectedModel?: string;
  activeProvider?: AIProvider;
  customProviderConfig?: CustomProviderConfig;
  isFallbackActive?: boolean;
  rateLimitPacing?: boolean;
  pacingRemainingSec?: number | null;
  tokenUsage?: TokenUsageStats;
  activeKeyIndex?: number;
  totalKeysCount?: number;
}

export const TranslationProgress: React.FC<TranslationProgressProps> = ({
  currentBatch,
  totalBatches,
  translatedLines,
  totalLines,
  isPaused,
  onPauseToggle,
  onCancel,
  retryInfo,
  uiLang,
  selectedModel = 'gemini-3.6-flash',
  activeProvider = 'gemini',
  customProviderConfig,
  isFallbackActive = false,
  rateLimitPacing = false,
  pacingRemainingSec = null,
  tokenUsage,
  activeKeyIndex = 0,
  totalKeysCount = 1,
}) => {
  const percentage = totalLines > 0 ? Math.min(100, Math.round((translatedLines / totalLines) * 100)) : 0;
  const t = TRANSLATIONS[uiLang];

  const isNonGemini = activeProvider !== 'gemini';
  const providerDef = activeProvider ? AI_PROVIDERS_CONFIG[activeProvider] : undefined;
  const customModelName = customProviderConfig?.model?.trim() || selectedModel || 'Custom Model';

  let modelDisplayName = '';
  let modelBadge = '';
  let modelBadgeColor = '';

  if (isNonGemini && !isFallbackActive) {
    modelDisplayName = `${providerDef ? providerDef.name.split(' ')[0] : 'AI'} (${customModelName})`;
    modelBadge = providerDef?.name || customProviderConfig?.name || (uiLang === 'en' ? 'AI Provider' : 'سرویس‌دهنده هوش مصنوعی');
    modelBadgeColor = providerDef?.badgeColor || 'bg-purple-500/20 text-purple-300 border-purple-500/40';
  } else {
    const foundModel = AI_MODELS.find((m) => m.id === selectedModel) || AI_MODELS[0];
    modelDisplayName = foundModel.name;
    modelBadge = foundModel.badge;
    modelBadgeColor = foundModel.badgeColor;
  }

  const getModelIcon = (id?: string) => {
    if (isNonGemini && !isFallbackActive) {
      return <Server className="w-5 h-5 text-purple-400" />;
    }
    switch (id) {
      case 'gemini-live-stream':
        return <Radio className="w-5 h-5 text-rose-400 animate-pulse" />;
      case 'gemini-3.1-pro-preview':
      case 'gemini-3.1-pro':
      case 'gemini-2.5-pro':
        return <BrainCircuit className="w-5 h-5 text-purple-400" />;
      case 'gemini-3.8-flash':
        return <Sparkles className="w-5 h-5 text-emerald-400" />;
      case 'gemini-3.7-flash':
        return <Zap className="w-5 h-5 text-teal-400" />;
      case 'gemini-3.1-flash-lite':
        return <Gauge className="w-5 h-5 text-amber-400" />;
      case 'gemini-3.5-flash':
        return <Flame className="w-5 h-5 text-cyan-400" />;
      case 'gemini-3.6-flash':
      default:
        return <Zap className="w-5 h-5 text-emerald-400" />;
    }
  };

  const getPausedNotice = () => {
    if (uiLang === 'en') return 'Translation paused. Click "Resume" to continue.';
    if (uiLang === 'ar') return 'تم إيقاف الترجمة مؤقتًا. انقر على "استئناف" للمتابعة.';
    return 'ترجمه به صورت موقت متوقف شده است. روی «ادامه» کلیک کنید.';
  };

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-indigo-500/40 p-5 shadow-2xl shadow-indigo-950/40 backdrop-blur-md flex flex-col gap-4">
      
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
            {isPaused ? <Pause className="w-5 h-5 text-amber-400" /> : getModelIcon(selectedModel)}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                <span>{t.translatingProgress} {modelDisplayName}</span>
              </h3>
              {isFallbackActive && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {uiLang === 'en' ? '(Fallback Active)' : uiLang === 'ar' ? '(محرك احتياطي نشط)' : '(موتور پشتیبان فعال)'}
                </span>
              )}
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${modelBadgeColor}`}>
                {modelBadge}
              </span>
              <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                {percentage}%
              </span>
              {rateLimitPacing && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-amber-400" />
                  {t.rateLimitPacingBadge}
                </span>
              )}
              {retryInfo && retryInfo.attempt > 1 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                  {t.retryAttempt} {retryInfo.attempt}/{retryInfo.maxRetries}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {t.batch} <strong className="text-white font-mono">{currentBatch}</strong> {t.of} <strong className="text-white font-mono">{totalBatches}</strong> •{' '}
              <strong className="text-emerald-400 font-mono">{translatedLines}</strong> {t.of} <strong className="text-slate-300 font-mono">{totalLines}</strong> {t.linesCount}
            </p>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={onPauseToggle}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
          >
            {isPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t.resume}</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>{t.pause}</span>
              </>
            )}
          </button>

          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>{t.cancel}</span>
          </button>
        </div>
      </div>

      {/* Progress Bar Container */}
      <div className="w-full bg-slate-950 rounded-full h-3 border border-slate-800 p-0.5 overflow-hidden">
        <div
          className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-500 h-full rounded-full transition-all duration-300 relative"
          style={{ width: `${percentage}%` }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.3)_50%,transparent_100%)] animate-shimmer" />
        </div>
      </div>

      {/* Real-time Token Usage & Remaining Quota Monitor */}
      {tokenUsage && tokenUsage.sessionTotalTokens > 0 && (
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs font-bold text-slate-200">
                {uiLang === 'en' ? 'Token Usage & Remaining Quota' : 'محاسبه توکن‌های مصرفی و سهمیه مانده'}
              </span>
            </div>

            {totalKeysCount && totalKeysCount > 1 ? (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-indigo-950/70 text-indigo-300 border border-indigo-800 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>
                  {uiLang === 'en'
                    ? `Key #${(activeKeyIndex ?? 0) + 1} of ${totalKeysCount} (Auto-failover active)`
                    : `کلید #${(activeKeyIndex ?? 0) + 1} از ${totalKeysCount} (چرخش خودکار در صورت اتمام توکن)`}
                </span>
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {/* Batch Tokens */}
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col">
              <span className="text-[10px] text-slate-400">
                {uiLang === 'en' ? 'Current Batch Tokens' : 'توکن این دسته'}
              </span>
              <span className="text-sm font-bold font-mono text-indigo-300 mt-0.5">
                {tokenUsage.totalTokens.toLocaleString()}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {uiLang === 'en'
                  ? `In: ${tokenUsage.promptTokens} | Out: ${tokenUsage.candidatesTokens}`
                  : `ورودی: ${tokenUsage.promptTokens} | خروجی: ${tokenUsage.candidatesTokens}`}
              </span>
            </div>

            {/* Session Total Used */}
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col">
              <span className="text-[10px] text-slate-400">
                {uiLang === 'en' ? 'Session Total Used' : 'کل توکن مصرفی'}
              </span>
              <span className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
                {tokenUsage.sessionTotalTokens.toLocaleString()}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {uiLang === 'en'
                  ? `Prompt: ${tokenUsage.sessionPromptTokens}`
                  : `ورودی کل: ${tokenUsage.sessionPromptTokens}`}
              </span>
            </div>

            {/* Remaining Context */}
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col">
              <span className="text-[10px] text-slate-400">
                {uiLang === 'en' ? 'Remaining Context Window' : 'ظرفیت مانده در کانتکست'}
              </span>
              <span className="text-sm font-bold font-mono text-cyan-300 mt-0.5">
                {tokenUsage.remainingTokensInContext.toLocaleString()}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {uiLang === 'en'
                  ? `Limit: ${(tokenUsage.contextLimit / 1000).toFixed(0)}k`
                  : `سقف: ${(tokenUsage.contextLimit / 1000).toFixed(0)} هزار`}
              </span>
            </div>

            {/* Estimated Remaining Quota (TPM) */}
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col">
              <span className="text-[10px] text-slate-400">
                {uiLang === 'en' ? 'Est. Quota Remaining (TPM)' : 'سهمیه مانده در دقیقه (TPM)'}
              </span>
              <span className="text-sm font-bold font-mono text-purple-300 mt-0.5">
                {tokenUsage.estimatedTpmRemaining.toLocaleString()}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {uiLang === 'en' ? '1M TPM Tier' : 'سقف ۱ میلیون در دقیقه'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Pacing Cooldown Feedback Notification */}
      {pacingRemainingSec !== null && pacingRemainingSec > 0 && !isPaused && (
        <div className="text-center text-xs text-amber-300 bg-amber-500/15 border border-amber-500/30 py-1.5 px-3 rounded-lg font-medium flex items-center justify-center gap-2 animate-pulse">
          <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>{t.pacingWaitingDelay.replace('{seconds}', String(pacingRemainingSec))}</span>
        </div>
      )}

      {isPaused && (
        <div className="text-center text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 py-1.5 rounded-lg font-medium">
          {getPausedNotice()}
        </div>
      )}

    </div>
  );
};

