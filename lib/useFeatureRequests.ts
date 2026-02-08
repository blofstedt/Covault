import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

export interface FeatureRequest {
  id: number;
  created_at: string;
  user: string | null;
  request: string | null;
  status: string;
  voters: string[];
}

export function useFeatureRequests(userId: string | undefined) {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('feature_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      setRequests(data as FeatureRequest[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const submitRequest = useCallback(
    async (text: string) => {
      if (!userId || !text.trim()) return;
      const { error } = await supabase.from('feature_requests').insert({
        user: userId,
        request: text.trim(),
        status: 'requested',
        voters: [userId],
      });
      if (error) {
        console.error('Failed to submit feature request:', error.message);
        return;
      }
      await fetchRequests();
    },
    [userId, fetchRequests],
  );

  const toggleVote = useCallback(
    async (featureId: number) => {
      if (!userId) return;
      const feature = requests.find((r) => r.id === featureId);
      if (!feature) return;

      const alreadyVoted = feature.voters?.includes(userId);
      const newVoters = alreadyVoted
        ? feature.voters.filter((v) => v !== userId)
        : [...(feature.voters || []), userId];

      const { error } = await supabase
        .from('feature_requests')
        .update({ voters: newVoters })
        .eq('id', featureId);
      if (error) console.error('Failed to toggle vote:', error.message);
      await fetchRequests();
    },
    [userId, requests, fetchRequests],
  );

  const updateStatus = useCallback(
    async (featureId: number, status: string) => {
      const { error } = await supabase
        .from('feature_requests')
        .update({ status })
        .eq('id', featureId);
      if (error) console.error('Failed to update status:', error.message);
      await fetchRequests();
    },
    [fetchRequests],
  );

  const searchRequests = useCallback(
    (query: string): FeatureRequest[] => {
      if (!query.trim()) return [];
      const q = query.toLowerCase();
      return requests.filter(
        (r) =>
          r.status === 'requested' &&
          r.request?.toLowerCase().includes(q),
      );
    },
    [requests],
  );

  return {
    requests,
    loading,
    submitRequest,
    toggleVote,
    updateStatus,
    searchRequests,
    refetch: fetchRequests,
  };
}
