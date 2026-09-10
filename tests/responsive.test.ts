import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import {
  boundActivityItems,
  useActivityMatrix,
  type ActivityItem,
  type ActivityPage,
} from "../src";
const item = (id: number): ActivityItem => ({
  id: String(id),
  cursor: String(id),
  order: String(id).padStart(5, "0"),
  label: `Read ${id}`,
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
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("responsive activity state", () => {
  it("does not show manual loading during refresh and discards cancelled results", async () => {
    const pending = deferred<ActivityPage<ActivityItem>>();
    const source = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce(page([5, 6], "5"))
        .mockImplementationOnce(() => pending.promise)
        .mockResolvedValueOnce(page([3, 4], "3", "4")),
      loadDetail: vi.fn(),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({ source, filters: {}, capacity: 2 });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    state.invalidate();
    expect(state.loading.value).toBe(false);
    expect(state.refreshing.value).toBe(true);
    await state.older();
    expect(source.loadPage.mock.calls[1][0].signal.aborted).toBe(true);
    pending.resolve(page([9, 10]));
    await flushPromises();
    expect(state.items.value.map((i) => i.id)).toEqual(["3", "4"]);
    expect(state.live.value).toBe(false);
    expect(state.refreshing.value).toBe(false);
    wrapper.unmount();
  });
  it("does not invent older history while an underfull live window grows", async () => {
    const source = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce(page([1]))
        .mockResolvedValueOnce(page([1, 2])),
      loadDetail: vi.fn(),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, unknown, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({ source, filters: {}, capacity: 8 });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    state.invalidate();
    await flushPromises();
    expect(state.items.value.map((i) => i.id)).toEqual(["1", "2"]);
    expect(state.hasOlder.value).toBe(false);
    wrapper.unmount();
  });
  it("refills resized history at its boundary and preserves selected details", async () => {
    const size = ref(2);
    const source = {
      loadPage: vi.fn(async (q) =>
        q.direction === "latest"
          ? page([5, 6], "5")
          : q.limit >= 4
            ? page([1, 2, 3, 4], null, "4")
            : page([3, 4], "3", "4"),
      ),
      loadDetail: vi.fn().mockResolvedValue("selected"),
    };
    let state!: ReturnType<
      typeof useActivityMatrix<ActivityItem, string, object>
    >;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useActivityMatrix({ source, filters: {}, capacity: size });
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    await state.older();
    await state.select(item(4));
    size.value = 4;
    await flushPromises();
    expect(source.loadPage.mock.calls.at(-1)?.[0]).toMatchObject({
      direction: "older",
      cursor: "5",
      limit: 4,
    });
    expect(state.items.value.map((i) => i.id)).toEqual(["1", "2", "3", "4"]);
    expect(state.hasOlder.value).toBe(false);
    expect(state.live.value).toBe(false);
    expect(state.selected.value?.id).toBe("4");
    expect(state.detail.value).toBe("selected");
    size.value = 2;
    await flushPromises();
    expect(state.items.value.map((i) => i.id)).toEqual(["3", "4"]);
    expect(state.hasOlder.value).toBe(true);
    wrapper.unmount();
  });
  it("fails closed on invalid standalone bounds", () => {
    for (const size of [0, -2, NaN, Infinity])
      expect(boundActivityItems([item(1)], size)).toEqual([]);
  });
});
