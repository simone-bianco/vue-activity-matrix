<script setup lang="ts" generic="T extends ActivityItem">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import {
  Button,
  EmptyState,
  StatusDot,
  Tooltip,
} from "@simone-bianco/vue-ui-components";
import type { ActivityItem } from "./types";

const props = withDefaults(
  defineProps<{
    items: readonly T[];
    rows?: number;
    columns?: number;
    adaptive?: boolean;
    cellSize?: number;
    gap?: number;
    selectedId?: string | null;
    loading?: boolean;
    error?: boolean;
    live?: boolean;
    pendingCount?: number;
    hasOlder?: boolean;
    hasNewer?: boolean;
    animated?: boolean;
    label?: string;
    detailTargetId?: string;
  }>(),
  {
    rows: 18,
    columns: 20,
    adaptive: false,
    cellSize: 24,
    gap: 4,
    selectedId: null,
    loading: false,
    error: false,
    live: true,
    pendingCount: 0,
    hasOlder: false,
    hasNewer: false,
    animated: true,
    label: "Activity matrix",
  },
);
const emit = defineEmits<{
  select: [item: T];
  older: [];
  newer: [];
  live: [];
  retry: [];
  capacity: [value: number];
}>();
defineSlots<{
  filters?(): unknown;
  item?(props: { item: T }): unknown;
  badge?(props: { item: T }): unknown;
  details?(): unknown;
  legend?(): unknown;
}>();
const bounded = (value: number, minimum: number, maximum: number) =>
  Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(value)))
    : minimum;
const rowCount = computed(() => bounded(props.rows, 1, 40));
const cellSize = computed(() => bounded(props.cellSize, 20, 64));
const cellGap = computed(() => bounded(props.gap, 2, 16));
const measuredColumns = ref<number | null>(null);
const columnCount = computed(() =>
  Math.min(
    bounded(props.columns, 1, 50),
    Math.floor(1000 / rowCount.value),
    measuredColumns.value ?? bounded(props.columns, 1, 50),
  ),
);
const capacity = computed(() => rowCount.value * columnCount.value);
const visibleItems = computed(() => props.items.slice(-capacity.value));
const root = ref<HTMLElement | null>(null);
const viewport = ref<HTMLElement | null>(null);
const detailsId = useId();
const focusId = ref<string | null>(null);
const activeId = computed(() =>
  visibleItems.value.some((item) => item.id === focusId.value)
    ? focusId.value
    : visibleItems.value.at(-1)?.id,
);
let observer: ResizeObserver | null = null;
let boundaryFocus: "first" | "last" | null = null;
function measure() {
  if (!props.adaptive || !viewport.value) {
    measuredColumns.value = null;
    return;
  }
  const width = viewport.value.getBoundingClientRect().width - 16;
  if (width > 0)
    measuredColumns.value = Math.max(
      1,
      Math.floor((width + cellGap.value) / (cellSize.value + cellGap.value)),
    );
}
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined" && viewport.value) {
    observer = new ResizeObserver(measure);
    observer.observe(viewport.value);
  }
  window.addEventListener("resize", measure);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  if (typeof window !== "undefined")
    window.removeEventListener("resize", measure);
});
watch([() => props.adaptive, cellSize, cellGap], measure);
watch(capacity, (value) => emit("capacity", value), { immediate: true });
function cellPosition(index: number) {
  return {
    gridColumn: Math.floor(index / rowCount.value) + 1,
    gridRow: rowCount.value - (index % rowCount.value),
  };
}
async function focus(index: number) {
  focusId.value = visibleItems.value[index]?.id ?? null;
  await nextTick();
  root.value
    ?.querySelector<HTMLButtonElement>(".activity-matrix__cell[tabindex='0']")
    ?.focus();
}
function keyboard(event: KeyboardEvent, index: number) {
  const offsets: Record<string, number> = {
    ArrowLeft: -rowCount.value,
    ArrowRight: rowCount.value,
    ArrowUp: 1,
    ArrowDown: -1,
  };
  if (event.key === "End" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    emit("live");
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    void focus(event.key === "Home" ? 0 : visibleItems.value.length - 1);
    return;
  }
  const offset = offsets[event.key];
  if (offset === undefined) return;
  event.preventDefault();
  if (
    (event.key === "ArrowUp" &&
      index % rowCount.value === rowCount.value - 1) ||
    (event.key === "ArrowDown" && index % rowCount.value === 0)
  )
    return;
  const target = index + offset;
  if (
    target < 0 &&
    event.key === "ArrowLeft" &&
    props.hasOlder &&
    !props.loading
  ) {
    boundaryFocus = "last";
    emit("older");
  } else if (
    target >= visibleItems.value.length &&
    event.key === "ArrowRight" &&
    props.hasNewer &&
    !props.loading
  ) {
    boundaryFocus = "first";
    emit("newer");
  } else if (target >= 0 && target < visibleItems.value.length)
    void focus(target);
}
watch(
  () => props.items,
  () => {
    if (boundaryFocus) {
      void focus(boundaryFocus === "first" ? 0 : visibleItems.value.length - 1);
      boundaryFocus = null;
    } else if (
      typeof document !== "undefined" &&
      document.activeElement?.classList.contains("activity-matrix__cell") &&
      root.value?.contains(document.activeElement) &&
      !visibleItems.value.some((item) => item.id === focusId.value)
    )
      void focus(0);
  },
);
</script>
<template>
  <section
    ref="root"
    class="activity-matrix"
    :class="{ 'activity-matrix--animated': animated && live }"
    :aria-label="label"
    :aria-busy="loading"
  >
    <div class="activity-matrix__toolbar">
      <div>
        <h3 class="activity-matrix__title">{{ label }}</h3>
        <p class="activity-matrix__status" role="status" aria-live="polite">
          {{
            live
              ? "Live · newest events on the right"
              : "History · live view paused"
          }}<span v-if="!live && pendingCount">
            · {{ pendingCount }} new events</span
          >
        </p>
      </div>
      <nav class="activity-matrix__navigation" aria-label="Activity history">
        <Button
          type="button"
          variant="secondary"
          compact
          :disabled="loading || !hasOlder"
          aria-label="Older events"
          @click="emit('older')"
          ><span aria-hidden="true">←</span> Older</Button
        >
        <Button
          type="button"
          variant="secondary"
          compact
          :disabled="loading || !hasNewer"
          aria-label="Newer events"
          @click="emit('newer')"
          >Newer <span aria-hidden="true">→</span></Button
        >
        <Button
          type="button"
          variant="secondary"
          compact
          :disabled="loading"
          :aria-pressed="live"
          aria-label="Return to live activity"
          @click="emit('live')"
          ><StatusDot
            :color="live ? 'success' : 'neutral'"
            size="sm"
            aria-hidden="true"
          />
          Live<span v-if="!live && pendingCount">
            ({{ pendingCount }})</span
          ></Button
        >
      </nav>
    </div>
    <slot name="filters" />
    <div class="activity-matrix__layout">
      <div class="activity-matrix__main">
        <div v-if="error" class="activity-matrix__message" role="alert">
          Unable to load activity.
          <Button
            type="button"
            variant="secondary"
            compact
            @click="emit('retry')"
            >Try again</Button
          >
        </div>
        <p
          v-else-if="loading && !visibleItems.length"
          class="activity-matrix__message"
          role="status"
        >
          Loading activity…
        </p>
        <EmptyState
          v-else-if="!visibleItems.length"
          title="No events match these filters."
          :bordered="false"
          compact
        />
        <div
          ref="viewport"
          class="activity-matrix__viewport"
          aria-label="Activity timeline. Use arrow keys between events; left and right at an edge load history."
        >
          <div
            class="activity-matrix__board"
            :style="{
              '--activity-rows': rowCount,
              '--activity-columns': columnCount,
              '--activity-cell-size': `${cellSize}px`,
              '--activity-cell-gap': `${cellGap}px`,
            }"
          >
            <span
              v-for="index in capacity"
              :key="`empty-${index}`"
              class="activity-matrix__empty"
              :style="cellPosition(index - 1)"
              aria-hidden="true"
            />
            <TransitionGroup :name="animated && live ? 'activity-cell' : ''">
              <div
                v-for="(item, index) in visibleItems"
                :key="item.id"
                class="activity-matrix__entry"
                :style="cellPosition(index)"
              >
                <Tooltip :text="item.label" :delay="200">
                  <button
                    type="button"
                    class="activity-matrix__cell"
                    :class="`activity-matrix__cell--${item.tone}`"
                    :data-activity-id="item.id"
                    :tabindex="activeId === item.id ? 0 : -1"
                    :aria-label="item.label"
                    :aria-pressed="selectedId === item.id"
                    :aria-controls="
                      detailTargetId ?? ($slots.details ? detailsId : undefined)
                    "
                    @focus="focusId = item.id"
                    @keydown="keyboard($event, index)"
                    @click="emit('select', item)"
                  >
                    <slot name="item" :item="item"
                      ><component
                        :is="item.icon"
                        v-if="item.icon"
                        aria-hidden="true"
                      /><span v-else aria-hidden="true">{{
                        item.operation.slice(0, 1).toUpperCase()
                      }}</span></slot
                    >
                    <span
                      v-if="item.badge || $slots.badge"
                      class="activity-matrix__badge"
                      ><slot name="badge" :item="item"
                        ><img
                          v-if="item.badge"
                          :src="item.badge.src"
                          :alt="item.badge.label"
                          width="12"
                          height="12"
                          draggable="false" /></slot
                    ></span>
                  </button>
                </Tooltip>
              </div>
            </TransitionGroup>
          </div>
        </div>
        <div class="activity-matrix__legend">
          <slot name="legend"
            ><span>Oldest ←</span
            ><span>{{ visibleItems.length }} / {{ capacity }} events</span
            ><span>→ Newest</span></slot
          >
        </div>
      </div>
      <aside
        v-if="$slots.details"
        :id="detailsId"
        class="activity-matrix__details"
        aria-label="Activity details"
      >
        <slot name="details" />
      </aside>
    </div>
  </section>
</template>
