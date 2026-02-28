'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from './page-layout.js';
import { GitPullRequestIcon, SpinnerIcon, RefreshIcon } from './icons.js';
import { getPullRequests } from '../actions.js';

function timeAgo(ts) {
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function PullRequestsPage({ session }) {
  const [pullRequests, setPullRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPRs = useCallback(async () => {
    try {
      const result = await getPullRequests();
      setPullRequests(result);
    } catch (err) {
      console.error('Failed to load pull requests:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => { fetchPRs(); }, [fetchPRs]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchPRs(), 60000);
    return () => clearInterval(interval);
  }, [fetchPRs]);

  return (
    <PageLayout session={session}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Pull Requests</h1>
        {!loading && (
          <button
            onClick={() => { setRefreshing(true); fetchPRs(); }}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
          >
            {refreshing ? (
              <><SpinnerIcon size={14} /> Refreshing...</>
            ) : (
              <><RefreshIcon size={14} /> Refresh</>
            )}
          </button>
        )}
      </div>

      {/* Count */}
      <p className="text-sm text-muted-foreground mb-4">
        {pullRequests.length} open {pullRequests.length === 1 ? 'pull request' : 'pull requests'}
      </p>

      {/* PR list */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-border/50" />
          ))}
        </div>
      ) : pullRequests.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No open pull requests.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {pullRequests.map((pr) => (
            <a
              key={pr.id}
              href={pr.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-4 border border-border rounded-lg hover:bg-accent transition-colors no-underline text-inherit"
            >
              <div className="mt-0.5 shrink-0 text-muted-foreground">
                <GitPullRequestIcon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  #{pr.number} {pr.title}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {pr.head_branch} &rarr; {pr.base_branch} &middot; opened by {pr.user} &middot; {timeAgo(pr.created_at)}
                </div>
              </div>
              <span className="text-xs text-blue-500 shrink-0 mt-1">
                View &rarr;
              </span>
            </a>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
