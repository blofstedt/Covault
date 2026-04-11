import React, { useState, useMemo } from 'react';
import { ThumbsUp } from 'lucide-react';
import { FeatureRequest } from '../../lib/hooks/useFeatureRequests';
import { CloseButton, Spinner } from '../shared';

const ADMIN_EMAIL = 'mostlydecentdev@gmail.com';

interface FeatureRequestModalProps {
  onClose: () => void;
  requests: FeatureRequest[];
  loading: boolean;
  userId: string | undefined;
  userEmail: string | undefined;
  onSubmit: (text: string) => void;
  onToggleVote: (featureId: number) => void;
  onUpdateStatus: (featureId: number, status: string) => void;
  searchRequests: (query: string) => FeatureRequest[];
}

const FeatureRequestModal: React.FC<FeatureRequestModalProps> = ({
  onClose,
  requests,
  loading,
  userId,
  userEmail,
  onSubmit,
  onToggleVote,
  onUpdateStatus,
  searchRequests,
}) => {
  const [activeTab, setActiveTab] = useState<'requested' | 'implemented'>('requested');
  const [newRequest, setNewRequest] = useState('');

  const isAdmin = userEmail === ADMIN_EMAIL;

  // Deduplicated search results
  const similar = useMemo(
    () => (newRequest.length >= 3 ? searchRequests(newRequest) : []),
    [newRequest, searchRequests],
  );

  const requestedItems = useMemo(
    () =>
      requests
        .filter((r) => r.status === 'requested')
        .sort((a, b) => (b.voters?.length || 0) - (a.voters?.length || 0)),
    [requests],
  );

  const implementedItems = useMemo(
    () => requests.filter((r) => r.status === 'implemented'),
    [requests],
  );

  const handleSubmit = () => {
    if (!newRequest.trim()) return;
    onSubmit(newRequest);
    setNewRequest('');
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-lg flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-500 max-h-[85vh] flex flex-col border border-slate-100 dark:border-slate-800/60 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-lg font-bold text-slate-700 dark:text-slate-100 tracking-tight">
            Feature Requests
          </h2>
          <CloseButton onClick={onClose} size="sm" />
        </div>

        {/* Tabs */}
        <div className="flex mx-6 mb-4 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('requested')}
            className={`flex-1 text-[11px] font-semibold tracking-wide py-2.5 rounded-lg transition-all ${
              activeTab === 'requested'
                ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            Requested
          </button>
          <button
            onClick={() => setActiveTab('implemented')}
            className={`flex-1 text-[11px] font-semibold tracking-wide py-2.5 rounded-lg transition-all ${
              activeTab === 'implemented'
                ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            Implemented
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-2 no-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          ) : activeTab === 'requested' ? (
            <div className="space-y-2">
              {requestedItems.length === 0 && (
                <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-8">
                  No requests yet. Be the first!
                </p>
              )}
              {requestedItems.map((item, index) => {
                const voted = userId ? item.voters?.includes(userId) : false;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-700/50"
                  >
                    <span className="text-[10px] font-black text-slate-300 dark:text-slate-600 w-5 text-center">
                      {index + 1}
                    </span>
                    <p className="flex-1 text-sm text-slate-600 dark:text-slate-300 leading-snug">
                      {item.request}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isAdmin && (
                        <button
                          onClick={() => onUpdateStatus(item.id, 'implemented')}
                          className="text-[9px] font-semibold text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-lg tracking-wide hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                        >
                          ✓ Done
                        </button>
                      )}
                      <button
                        onClick={() => onToggleVote(item.id)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 active:scale-[0.97] ${
                          voted
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 hover:text-emerald-500'
                        }`}
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                        <span>{item.voters?.length || 0}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {implementedItems.length === 0 && (
                <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-8">
                  No implemented features yet.
                </p>
              )}
              {implementedItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3.5 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-800/30"
                >
                  <span className="text-emerald-500 text-sm">✓</span>
                  <p className="flex-1 text-sm text-slate-600 dark:text-slate-300 leading-snug">
                    {item.request}
                  </p>
                  {isAdmin && (
                    <button
                      onClick={() => onUpdateStatus(item.id, 'requested')}
                      className="text-[9px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg tracking-wide hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      Undo
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New Request Input */}
        {activeTab === 'requested' && (
          <div className="p-6 pt-3 border-t border-slate-100 dark:border-slate-800">
            {similar.length > 0 && (
              <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200/60 dark:border-amber-800/30">
                <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 tracking-wide mb-1.5">
                  Someone already suggested this!
                </p>
                {similar.slice(0, 2).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onToggleVote(s.id);
                      setNewRequest('');
                    }}
                    className="w-full text-left text-xs text-amber-700 dark:text-amber-300 p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                  >
                    &quot;{s.request}&quot; — Click to vote ↑
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newRequest}
                onChange={(e) => setNewRequest(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Suggest a feature..."
                className="flex-1 px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
              />
              <button
                onClick={handleSubmit}
                disabled={!newRequest.trim()}
                className="px-4 py-3 bg-emerald-500 text-white text-xs font-semibold rounded-xl hover:bg-emerald-600 active:scale-[0.97] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed tracking-wide"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FeatureRequestModal;
