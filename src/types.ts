import type { Component } from "vue";

export type ActivityTone = "neutral" | "info" | "success" | "warning" | "error";
export interface ActivityItem {
  id: string;
  /** Opaque cursor anchored at this item, used when complete columns leave live view. */
  cursor?: string;
  /** Stable ascending, lexically sortable key, including a unique tie-breaker. */
  order: string;
  label: string;
  occurredAt: string;
  operation: string;
  tone: ActivityTone;
  icon?: Component;
  /** Consumer-owned safe image identity, rendered as a small cell overlay. */
  badge?: { src: string; label: string };
}
export type ActivityDirection = "latest" | "older" | "newer";
export interface ActivityQuery<F> {
  direction: ActivityDirection;
  cursor: string | null;
  limit: number;
  filters: F;
  /** Latest visible ID when leaving live mode; loader may return an exact pending count. */
  since: string | null;
  signal: AbortSignal;
}
export interface ActivityPage<T extends ActivityItem> {
  items: readonly T[];
  olderCursor: string | null;
  newerCursor: string | null;
  pendingCount?: number;
}
export interface ActivitySource<T extends ActivityItem, D, F> {
  loadPage(query: ActivityQuery<F>): Promise<ActivityPage<T>>;
  loadDetail(item: T, signal: AbortSignal): Promise<D>;
  /** Optional invalidation/reconnect notifications; never authoritative socket rows. */
  subscribe?(invalidate: () => void): () => void;
}
