import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  toValue,
  type MaybeRefOrGetter,
} from "vue";
import type {
  ActivityDirection,
  ActivityItem,
  ActivityPage,
  ActivitySource,
} from "./types";

export function boundActivityItems<T extends ActivityItem>(
  items: readonly T[],
  limit: number,
): T[] {
  const count = Number.isFinite(limit)
    ? Math.max(0, Math.min(2000, Math.trunc(limit)))
    : 0;
  if (count === 0) return [];
  const unique = new Map(items.map((item) => [item.id, item]));
  return [...unique.values()]
    .sort((a, b) =>
      a.order < b.order ? -1 : a.order > b.order ? 1 : a.id.localeCompare(b.id),
    )
    .slice(-count);
}

/** Bounded history with a single cancellable read owner and independent background state. */
export function useActivityMatrix<T extends ActivityItem, D, F>(options: {
  source: ActivitySource<T, D, F>;
  filters: MaybeRefOrGetter<F>;
  capacity?: MaybeRefOrGetter<number>;
  columnSize?: MaybeRefOrGetter<number>;
}) {
  const capacity = computed(() => {
    const value = toValue(options.capacity ?? 80);
    return Number.isFinite(value)
      ? Math.max(1, Math.min(1000, Math.trunc(value)))
      : 80;
  });
  const columnSize = computed(() => {
    const value = toValue(options.columnSize ?? 1);
    return Number.isFinite(value)
      ? Math.max(1, Math.min(capacity.value, Math.trunc(value)))
      : 1;
  });
  const items = shallowRef<readonly T[]>([]);
  const selected = shallowRef<T | null>(null);
  const detail = shallowRef<D | null>(null);
  const loading = ref(false);
  const refreshing = ref(false);
  const detailLoading = ref(false);
  const error = ref(false);
  const detailError = ref(false);
  const live = ref(true);
  const pendingCount = ref(0);
  const animateChanges = ref(false);
  const olderCursor = ref<string | null>(null);
  const newerCursor = ref<string | null>(null);
  let mounted = false;
  let pageAbort: AbortController | null = null;
  let detailAbort: AbortController | null = null;
  let revision = 0;
  let detailRevision = 0;
  let liveAnchor: string | null = null;
  let liveAnchorOrder: string | null = null;
  let refreshPending = false;
  let unsubscribe = () => {};
  let lastRequest: [ActivityDirection, string | null, boolean, boolean] = [
    "latest",
    null,
    false,
    false,
  ];
  // Keep the original keyset boundary while a responsive resize refills history.
  let windowRequest: [ActivityDirection, string | null] = ["latest", null];

  function accept(page: ActivityPage<T>) {
    items.value = boundActivityItems(page.items, capacity.value);
    olderCursor.value = page.olderCursor;
    newerCursor.value = page.newerCursor;
  }

  async function load(
    direction: ActivityDirection = "latest",
    cursor: string | null = null,
    background = false,
    replaceWindow = false,
  ) {
    if (!mounted) return;
    if (background && !replaceWindow && (loading.value || refreshing.value)) {
      refreshPending = true;
      return;
    }
    pageAbort?.abort();
    const controller = new AbortController();
    pageAbort = controller;
    const current = ++revision;
    loading.value = !background;
    refreshing.value = background;
    if (!background) error.value = false;
    lastRequest = [direction, cursor, background, replaceWindow];
    if (!background || replaceWindow) windowRequest = [direction, cursor];
    try {
      const page = await options.source.loadPage({
        direction,
        cursor,
        limit: capacity.value,
        filters: toValue(options.filters),
        since: liveAnchor,
        signal: controller.signal,
      });
      if (!mounted || current !== revision || controller.signal.aborted) return;
      error.value = false;
      animateChanges.value = background && !replaceWindow && live.value;
      if (background && !replaceWindow && !live.value) {
        pendingCount.value = Math.max(
          0,
          page.pendingCount ??
            page.items.filter(
              (item) =>
                liveAnchor !== null &&
                item.id !== liveAnchor &&
                item.order > (liveAnchorOrder ?? ""),
            ).length,
        );
      } else {
        if (background && !replaceWindow && live.value && items.value.length) {
          const newest = items.value.at(-1)!.order;
          const incoming = page.items.filter((item) => item.order > newest);
          if (incoming.length) {
            const merged = boundActivityItems(
              [...items.value, ...incoming],
              capacity.value * 2,
            );
            const excess = Math.max(0, merged.length - capacity.value);
            const removed =
              Math.ceil(excess / columnSize.value) * columnSize.value;
            items.value = merged.slice(removed);
            olderCursor.value =
              removed > 0
                ? (items.value[0]?.cursor ?? page.olderCursor)
                : (olderCursor.value ?? page.olderCursor);
            newerCursor.value = null;
          }
        } else {
          accept(page);
          windowRequest = [direction, cursor];
        }
        live.value = direction === "latest";
        if (live.value) {
          liveAnchor = items.value.at(-1)?.id ?? null;
          liveAnchorOrder = items.value.at(-1)?.order ?? null;
          pendingCount.value = 0;
        }
      }
    } catch {
      if (mounted && current === revision && !controller.signal.aborted)
        error.value = true;
    } finally {
      if (mounted && current === revision) {
        pageAbort = null;
        loading.value = false;
        refreshing.value = false;
        if (refreshPending) {
          refreshPending = false;
          void load("latest", null, true);
        }
      }
    }
  }

  async function select(item: T | null) {
    detailAbort?.abort();
    const current = ++detailRevision;
    selected.value = item;
    detail.value = null;
    detailError.value = false;
    detailLoading.value = false;
    if (!item || !mounted) return;
    const controller = new AbortController();
    detailAbort = controller;
    detailLoading.value = true;
    try {
      const result = await options.source.loadDetail(item, controller.signal);
      if (mounted && current === detailRevision && !controller.signal.aborted)
        detail.value = result;
    } catch {
      if (mounted && current === detailRevision && !controller.signal.aborted)
        detailError.value = true;
    } finally {
      if (mounted && current === detailRevision) detailLoading.value = false;
    }
  }

  function invalidate() {
    void load("latest", null, true);
  }
  function reset() {
    pageAbort?.abort();
    ++revision;
    refreshPending = false;
    items.value = [];
    olderCursor.value = newerCursor.value = null;
    liveAnchor = liveAnchorOrder = null;
    windowRequest = ["latest", null];
    live.value = true;
    pendingCount.value = 0;
    animateChanges.value = false;
    void select(null);
    void load();
  }
  watch(() => toValue(options.filters), reset, { deep: true });
  watch(capacity, () => {
    animateChanges.value = false;
    if (mounted) void load(windowRequest[0], windowRequest[1], true, true);
  });
  onMounted(() => {
    mounted = true;
    unsubscribe = options.source.subscribe?.(invalidate) ?? (() => {});
    void load();
  });
  onBeforeUnmount(() => {
    mounted = false;
    ++revision;
    ++detailRevision;
    pageAbort?.abort();
    detailAbort?.abort();
    unsubscribe();
  });
  return {
    items,
    selected,
    detail,
    loading,
    refreshing,
    detailLoading,
    error,
    detailError,
    live,
    pendingCount,
    animateChanges,
    hasOlder: computed(() => olderCursor.value !== null),
    hasNewer: computed(() => newerCursor.value !== null),
    older: () => {
      if (olderCursor.value && !loading.value)
        return load("older", olderCursor.value);
    },
    newer: () => {
      if (newerCursor.value && !loading.value)
        return load("newer", newerCursor.value);
    },
    returnLive: () => load(),
    retry: () => load(...lastRequest),
    invalidate,
    select,
    retryDetail: () => select(selected.value),
  };
}
