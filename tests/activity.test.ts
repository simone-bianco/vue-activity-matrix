import { createSSRApp, defineComponent, h, ref } from "vue";
import { renderToString } from "@vue/server-renderer";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import {
  ActivityMatrix,
  boundActivityItems,
  useActivityMatrix,
  type ActivityItem,
  type ActivityPage,
  type ActivitySource,
} from "../src";

const item = (n: number): ActivityItem => ({
  id: String(n),
  order: String(n).padStart(5, "0"),
  label: `Agent read ${n}`,
  occurredAt: "2026-09-10T12:00:00Z",
  operation: "read",
  tone: "success",
});
const page = (
  ids: number[],
  olderCursor: string | null = null,
  newerCursor: string | null = null,
): ActivityPage<ActivityItem> => ({
  items: ids.map(item),
  olderCursor,
  newerCursor,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("activity source window", () => {
  it("replaces live outcomes while retaining selection and leaves historical windows untouched", async () => {
    const source = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce(page([3, 4], "before-3"))
        .mockResolvedValueOnce(page([4, 5], "before-4"))
        .mockResolvedValueOnce(page([1, 2], null, "after-2"))
        .mockResolvedValueOnce({ ...page([5, 6]), pendingCount: 2 }),
      loadDetail: vi.fn().mockResolvedValue({ error: "timeout" }),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({
            source,
            filters: {},
            capacity: 2,
            liveUpdate: "replace",
          });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    await state.select(state.items.value[0]);
    state.invalidate();
    expect(state.loading.value).toBe(false);
    await flushPromises();
    expect(state.items.value.map((entry) => entry.id)).toEqual(["4", "5"]);
    expect(state.selected.value?.id).toBe("3");
    expect(state.detail.value).toEqual({ error: "timeout" });
    expect(state.animateChanges.value).toBe(false);
    await state.older();
    state.invalidate();
    await flushPromises();
    expect(state.items.value.map((entry) => entry.id)).toEqual(["1", "2"]);
    expect(state.pendingCount.value).toBe(2);
    expect(state.live.value).toBe(false);
    wrapper.unmount();
  });
  it("animates only newly keyed rows when a replacing live feed opts in", async () => {
    const source = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce(page([3, 4]))
        .mockResolvedValueOnce(page([4, 5]))
        .mockResolvedValueOnce(page([4, 5])),
      loadDetail: vi.fn(),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({
            source,
            filters: {},
            capacity: 2,
            liveUpdate: "replace",
            animateLiveAdditions: true,
          });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    expect(state.animateChanges.value).toBe(false);
    state.invalidate();
    await flushPromises();
    expect(state.items.value.map((entry) => entry.id)).toEqual(["4", "5"]);
    expect(state.animateChanges.value).toBe(true);
    state.invalidate();
    await flushPromises();
    expect(state.animateChanges.value).toBe(false);
    wrapper.unmount();
  });
  it("retries a failed history invalidation without replacing the inspected window", async () => {
    const source = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce(page([3, 4], "before-3"))
        .mockResolvedValueOnce(page([1, 2], null, "after-2"))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ ...page([5, 6]), pendingCount: 2 }),
      loadDetail: vi.fn(),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({ source, filters: {} });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    expect(state.animateChanges.value).toBe(false);
    await state.older();
    state.invalidate();
    await flushPromises();
    expect(state.error.value).toBe(true);
    await state.retry();
    expect(state.items.value.map((item) => item.id)).toEqual(["1", "2"]);
    expect(state.pendingCount.value).toBe(2);
    expect(state.live.value).toBe(false);
    expect(state.animateChanges.value).toBe(false);
    wrapper.unmount();
  });
  it("keeps older navigation truthful on an under-capacity live refresh", async () => {
    const source = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce(page([1, 2]))
        .mockResolvedValueOnce(page([1, 2, 3])),
      loadDetail: vi.fn(),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({
            source,
            filters: {},
            capacity: 6,
            columnSize: 2,
          });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    expect(state.hasOlder.value).toBe(false);
    state.invalidate();
    await flushPromises();
    expect(state.items.value.map((entry) => entry.id)).toEqual(["1", "2", "3"]);
    expect(state.hasOlder.value).toBe(false);
    wrapper.unmount();
  });
  it("keeps foreground navigation stable during a background invalidation", async () => {
    const refresh = deferred<ActivityPage<ActivityItem>>();
    const source = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce(page([1, 2], "before-1"))
        .mockImplementationOnce(() => refresh.promise),
      loadDetail: vi.fn(),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({ source, filters: {}, capacity: 6 });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    expect(state.hasOlder.value).toBe(true);
    state.invalidate();
    expect(state.loading.value).toBe(false);
    expect(state.refreshing.value).toBe(true);
    expect(state.hasOlder.value).toBe(true);
    refresh.resolve(page([1, 2, 3], "before-1"));
    await flushPromises();
    expect(state.refreshing.value).toBe(false);
    expect(state.hasOlder.value).toBe(true);
    wrapper.unmount();
  });
  it("evicts complete oldest columns and never reintroduces dropped rows on refresh", async () => {
    const source = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce(page([1, 2, 3, 4, 5, 6]))
        .mockResolvedValueOnce(page([2, 3, 4, 5, 6, 7]))
        .mockResolvedValueOnce(page([3, 4, 5, 6, 7, 8])),
      loadDetail: vi.fn(),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({
            source,
            filters: {},
            capacity: 6,
            columnSize: 2,
          });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    state.invalidate();
    await flushPromises();
    expect(state.items.value.map((item) => item.id)).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    state.invalidate();
    await flushPromises();
    expect(state.items.value.map((item) => item.id)).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    wrapper.unmount();
  });
  it("coalesces reconnect invalidations during an in-flight read", async () => {
    const pending = deferred<ActivityPage<ActivityItem>>();
    const source = {
      loadPage: vi
        .fn()
        .mockImplementationOnce(() => pending.promise)
        .mockResolvedValue(page([2, 3])),
      loadDetail: vi.fn(),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({ source, filters: {} });
          return () => h("div");
        },
      }),
    );
    state.invalidate();
    state.invalidate();
    state.invalidate();
    expect(source.loadPage).toHaveBeenCalledTimes(1);
    pending.resolve(page([1, 2]));
    await flushPromises();
    expect(source.loadPage).toHaveBeenCalledTimes(2);
    expect(state.items.value.map((item) => item.id)).toEqual(["1", "2", "3"]);
    wrapper.unmount();
  });
  it("orders, deduplicates and bounds delivered data", () => {
    expect(
      boundActivityItems([item(3), item(1), item(3), item(2)], 2).map(
        (i) => i.id,
      ),
    ).toEqual(["2", "3"]);
  });
  it("cancels stale filters/details and preserves history while counting pending events", async () => {
    const old = deferred<ActivityPage<ActivityItem>>();
    const details = deferred<{ body: string }>();
    const filters = ref({ agent: "a" });
    let invalidation = () => {};
    const unsubscribe = vi.fn();
    const source: ActivitySource<
      ActivityItem,
      { body: string },
      { agent: string }
    > = {
      loadPage: vi
        .fn()
        .mockImplementationOnce(() => old.promise)
        .mockResolvedValueOnce(page([3, 4], "before-3"))
        .mockResolvedValueOnce(page([1, 2], null, "after-2"))
        .mockResolvedValueOnce({ ...page([5, 6]), pendingCount: 2 })
        .mockResolvedValueOnce(page([5, 6], "before-5")),
      loadDetail: vi
        .fn()
        .mockImplementationOnce(() => details.promise)
        .mockResolvedValue({ body: "new" }),
      subscribe: (cb) => {
        invalidation = cb;
        return unsubscribe;
      },
    };
    let state!: ReturnType<
      typeof useActivityMatrix<
        ActivityItem,
        { body: string },
        { agent: string }
      >
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({ source, filters, capacity: 2 });
          return () => h("div");
        },
      }),
    );
    filters.value = { agent: "b" };
    await flushPromises();
    expect(vi.mocked(source.loadPage).mock.calls[0][0].signal.aborted).toBe(
      true,
    );
    old.resolve(page([90, 91]));
    await flushPromises();
    expect(state.items.value.map((i) => i.id)).toEqual(["3", "4"]);
    await state.older();
    invalidation();
    await flushPromises();
    expect(state.items.value.map((i) => i.id)).toEqual(["1", "2"]);
    expect(state.pendingCount.value).toBe(2);
    expect(state.live.value).toBe(false);
    void state.select(item(1));
    await state.select(item(2));
    details.resolve({ body: "stale" });
    await flushPromises();
    expect(state.detail.value).toEqual({ body: "new" });
    await state.returnLive();
    expect(state.items.value.map((i) => i.id)).toEqual(["5", "6"]);
    expect(state.pendingCount.value).toBe(0);
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("retries a failed request and ignores responses after unmount", async () => {
    const late = deferred<ActivityPage<ActivityItem>>();
    const source = {
      loadPage: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(page([1], "before-1"))
        .mockImplementationOnce(() => late.promise),
      loadDetail: vi.fn(),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({ source, filters: {} });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    expect(state.error.value).toBe(true);
    await state.retry();
    expect(state.error.value).toBe(false);
    void state.older();
    wrapper.unmount();
    late.resolve(page([99]));
    await flushPromises();
    expect(state.items.value[0].id).toBe("1");
    expect(source.loadPage.mock.calls[2][0].signal.aborted).toBe(true);
  });
});

describe("activity matrix presentation", () => {
  it("bounds DOM, emits selection, uses roving keyboard focus and lazy edge navigation", async () => {
    const wrapper = mount(ActivityMatrix, {
      attachTo: document.body,
      props: {
        items: [1, 2, 3, 4, 5].map(item),
        rows: 2,
        columns: 2,
        hasOlder: true,
        hasNewer: true,
        selectedId: "4",
      },
    });
    expect(wrapper.findAll(".activity-matrix__cell")).toHaveLength(4);
    await wrapper.get('[data-activity-id="4"]').trigger("click");
    expect(wrapper.emitted("select")?.[0][0]).toEqual(item(4));
    await wrapper
      .get('[data-activity-id="5"]')
      .trigger("keydown", { key: "ArrowLeft" });
    expect(document.activeElement?.getAttribute("data-activity-id")).toBe("3");
    await wrapper
      .get('[data-activity-id="3"]')
      .trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.emitted("older")).toHaveLength(1);
    await wrapper.setProps({ items: [10, 11].map(item) });
    await flushPromises();
    expect(document.activeElement?.getAttribute("data-activity-id")).toBe("11");
    await wrapper
      .get('[data-activity-id="11"]')
      .trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("newer")).toHaveLength(1);
    wrapper.unmount();
  });
  it("renders SSR without starting loaders and escapes labels/details", async () => {
    const loadPage = vi.fn();
    const app = createSSRApp(
      defineComponent({
        setup() {
          useActivityMatrix({
            source: { loadPage, loadDetail: vi.fn() },
            filters: {},
          });
          return () =>
            h(
              ActivityMatrix,
              { items: [{ ...item(1), label: "<script>unsafe</script>" }] },
              { details: () => "<img src=x onerror=alert(1)>" },
            );
        },
      }),
    );
    const html = await renderToString(app);
    expect(loadPage).not.toHaveBeenCalled();
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });
  it("exposes loading, empty, retry and history count states", async () => {
    const wrapper = mount(ActivityMatrix, {
      props: { items: [], loading: true },
    });
    expect(wrapper.text()).toContain("Loading activity");
    await wrapper.setProps({ loading: false });
    expect(wrapper.text()).toContain("No events match");
    await wrapper.setProps({ error: true, live: false, pendingCount: 12 });
    expect(wrapper.text()).toContain("12 new events");
    await wrapper.get(".activity-matrix__message button").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });
});
