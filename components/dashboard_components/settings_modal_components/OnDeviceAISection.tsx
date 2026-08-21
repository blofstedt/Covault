import React from 'react';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';
import { formatBytes, type AIModelReport } from '../../../lib/aiModelStore';

interface OnDeviceAISectionProps {
  report: AIModelReport | null;
  downloading: boolean;
  onDownload: () => void;
}

/**
 * What the reading model is doing on this phone, and whether it is here.
 *
 * The model reads the alerts the plain-text parser cannot, and it used to be
 * fetched at the moment it was needed — mid-capture, on whatever connection
 * was to hand. It is kept on the phone now, and this says so in the only terms
 * that mean anything: is it here, and how much of the phone is it using. The
 * numbers are read from the store itself rather than from a "downloaded" flag,
 * because the phone can reclaim that space and a flag would go on lying.
 */
const OnDeviceAISection: React.FC<OnDeviceAISectionProps> = ({
  report,
  downloading,
  onDownload,
}) => {
  const state = report?.state ?? 'absent';
  const ready = state === 'ready';
  const unsupported = state === 'unsupported';

  const headline = downloading
    ? 'Downloading…'
    : ready
      ? 'Ready on this phone'
      : unsupported
        ? 'Not available on this device'
        : state === 'partial'
          ? 'Partly downloaded'
          : 'Not downloaded yet';

  const detail = downloading
    ? 'Fetching the reading model. It only happens once.'
    : ready
      ? `${formatBytes(report?.bytes || 0)} stored here — it reads alerts with no connection.`
      : unsupported
        ? 'This device has no room to keep the model, so it is fetched when needed.'
        : state === 'partial'
          ? 'Some of it is here. Finishing the download makes it work offline.'
          : 'It downloads on its own over Wi-Fi, or you can fetch it now.';

  return (
    <SettingsCard>
      <SectionHeader
        title="Reading Model"
        subtitle="Reads the bank alerts the simple rules can't"
      />

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                downloading
                  ? 'bg-amber-400 animate-pulse'
                  : ready
                    ? 'bg-emerald-500'
                    : 'bg-slate-300 dark:bg-slate-600'
              }`}
            />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-300 tracking-wide">
              {headline}
            </p>
          </div>
          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
            {detail}
          </p>
        </div>

        {!ready && !unsupported && (
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            className="shrink-0 px-3 py-2 rounded-xl text-[11px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-wait"
          >
            {downloading ? 'Downloading…' : 'Download now'}
          </button>
        )}
      </div>
    </SettingsCard>
  );
};

export default OnDeviceAISection;
