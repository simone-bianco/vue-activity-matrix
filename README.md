# Vue Activity Matrix

Generic Vue 3 / TypeScript activity window with bounded lazy history, live insertion animation, accessible navigation and injectable detail loaders. Requires Vue >=3.5 and the framework-neutral `@simone-bianco/vue-ui-components` peer. There is no application, router, HTTP, Laravel or realtime-vendor dependency. The pure controller only imports Vue.

Import `@simone-bianco/vue-activity-matrix/style.css` once. Configure/theme the shared UI package as usual in the host; this stylesheet provides matrix geometry and colors, not the shared Button/Tooltip theme. Optional `--ui-*` RGB tokens have standalone matrix defaults.

## Controlled presentation

`ActivityMatrix` accepts ascending `items`, `rows`, `columns`, selection, manual loading, error and history/live state. Handle `select`, `older`, `newer`, `live`, `retry` and `capacity`. Optional `filters`, `item`, `badge`, `legend` and `details` slots provide consumer-owned UI. `detailTargetId` links cells to an external persistent details card; omit the details slot when the application composes that card itself.

Defaults are 18 rows, at most 20 columns, 24-pixel squares and 4-pixel gaps. Enable `adaptive` to measure available width and reduce columns. `cellSize` and `gap` are bounded props; rendering never exceeds 1000 cells. The board fits its parent without an internal scrollbar or clipped cells. A responsive application can place the board beside a detail card and use taller geometry rather than spreading across the page. The component does not set the host page's column proportions.

Cells are column-major, filling each column from bottom to top; newer columns extend right. A small consumer-supplied `badge: { src, label }` represents actor identity separately from `icon` and outcome `tone`. Supply trusted local/approved asset URLs, never infer a provider from arbitrary content. Operation/icon mapping and domain legends belong to the consumer. Text is escaped; never render untrusted HTML through consumer slots.

## Controller and loader contract

`useActivityMatrix({ source, filters, capacity, columnSize })` retains one bounded window and one selected detail. `capacity` and `columnSize` accept numbers, refs or getters; set columnSize to rendered rows for complete-column eviction. Default controller capacity is 80, maximum 1000. Bind the component's `capacity` event back to the capacity ref when using adaptive geometry.

Set reactive `liveShiftColumns` to shift that many oldest columns left as soon as the live window reaches capacity, leaving blank columns on the right. It defaults to 0 (disabled) and is clamped to retain at least one visible column; one-column boards cannot shift. Initial/latest loads also shift when full. Replacement refreshes keep the discarded order boundary so older rows cannot refill the blank space, while superseded outcomes still disappear. History stays fully populated and accessible through the first retained item's cursor. Returning live, filtering or resizing establishes a fresh window; selected detail survives shifting and resizing.

`ActivitySource.loadPage` receives `{ direction, cursor, limit, filters, since, signal }`. Return `{ items, olderCursor, newerCursor, pendingCount? }`. Items have stable unique IDs and lexically sortable ascending `order` keys with a unique tie-breaker. Cursor strings are opaque; do not parse database BIGINT IDs as JavaScript numbers. Return null when that side of history is exhausted. A selected item's own `cursor` anchors history after complete columns are evicted.

An optional `subscribe(invalidate)` returns an unsubscribe callback. It signals invalidation or reconnection, never authoritative socket rows. The application may instead call controller `invalidate()` from its existing realtime subscription. Do not add a second subscription or polling loop. Provide the exact filtered `pendingCount` for `since` when events may arrive faster than one page can contain; the fallback only counts newer items in the returned page.

Loaders start after mount, receive AbortSignal, and must preserve server authorization. Obsolete responses are ignored after filter changes, navigation, resize or unmount. Filters clear the window and detail. A source/entity change should remount with an entity key. Changing capacity refills history at its original keyset boundary without clearing the selection or inventing older history.

`loading` is manual navigation/initial loading; `refreshing` is background invalidation or resize. Only the former should disable navigation. History mode keeps visible events and selected details stable, updating pending count only. Returning live replaces the page. Background invalidations coalesce with one trailing read. Errors preserve usable current data and expose retry functions.

Use `liveUpdate: "replace"` for server outcome feeds that remove superseded states. Invalidations replace the live window in place while preserving keyed cells and the independently selected detail. Replacement feeds do not animate by default; opt into `animateLiveAdditions` to animate only genuinely new keys, never retained rows. History remains anchored with a pending count. The default `"append"` retains journal insertion and whole-column eviction. Never key a mounted explorer by its data revision; signal `invalidate()` instead.

Bind `animated` to the user's motion preference AND controller `animateChanges`. Initial loads, filters, history and resize do not replay animation. Only live arrivals fall into place; complete oldest columns leave left, with their history still available by cursor. The shared Tooltip wraps each native semantic cell inside a stable keyed animation root; there is no native title tooltip.

## Accessibility and verification

Arrow keys move through the matrix; left/right at a history boundary request another page. Home/End move inside the window and Ctrl/Meta+End returns live. Enter/Space selects. One cell is a tab stop, focus is restored after history paging/eviction, hover and keyboard focus use the shared Tooltip, and reduced-motion disables movement. Mode/status remain textually available alongside color.

Run `npm test`, `npm run typecheck` and `npm run build` in this workspace. Tests cover ordering/deduplication/bounds, whole-column eviction, cancellation and stale responses, live/history pending behavior, resize selection retention, underfull cursor exhaustion, independent background state, retry, SSR and keyboard navigation. Host integration still requires real browser geometry, theme, tooltip, source authorization and realtime/reconnect QA.
