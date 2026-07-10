# PRD: Ad Photos — Upload, Ordering, and Submission-Failure UX

**Status:** Draft

## Introduction

The land marketplaces require photos on listings, but today the pipeline has a gap: the posting scripts already upload any images found in `workers/workspace/outputs/<taskId>/photos/` (see `workers/posting/post-common.ts` `listPhotos()`), yet there is no UI or API to get photos into that directory — a human must place files on disk by hand.

This feature adds photo upload to the Ad Builder page (`dashboard/app/ad-builder/page.tsx`): users attach at least one photo when creating an ad request, arrange the order via drag-and-drop, and star one image as primary. Photos are uploaded as part of the submission flow. It also hardens failure handling in two places: photo-upload failures in the form, and richer surfacing of marketplace posting failures (building on the existing `PostingChips` red chip + Retry).

**Key design decision (keeps the poster unchanged):** uploaded files are written to `workers/workspace/outputs/<taskId>/photos/` with an order-prefixed name — the primary image gets prefix `00_`, the rest `01_`, `02_`, … in gallery order. `listPhotos()` sorts by filename and `setInputFiles()` preserves array order, so the primary image lands first on every marketplace with zero changes to `post-landmodo.ts` / `post-land_com.ts` upload logic.

## Goals

- Ad Builder form accepts image files (jpg/jpeg/png/webp/gif — the same set `listPhotos()` reads), requires at least 1, and uploads them into `workers/workspace/outputs/<taskId>/photos/` during submission
- Users can reorder photos by drag-and-drop and mark one as primary (defaults to the first)
- Photo order and primary choice are durably encoded in filenames so the existing poster consumes them correctly with no changes
- Upload failures never silently lose photos: per-file errors, per-file retry, and the worker is not triggered until all uploads succeed
- Posting failures are easier to act on: full error detail on demand, and a page-level indicator when any posting has permanently failed

## User Stories

### US-001: Photo upload API endpoint
**Description:** As the Ad Builder form, I need an API that accepts an image file and writes it into the task's photos directory, so photos end up where the poster already looks.

**Acceptance Criteria:**
- [x] New route `POST /api/tasks/[id]/photos` accepts `multipart/form-data` with a single `file` field per request (the form calls it once per photo)
- [x] Returns 404 if the task id does not exist (checked via the existing data layer)
- [x] Writes the file to `workers/workspace/outputs/<taskId>/photos/`, creating the directory if needed
- [x] Saves under the client-supplied `filename` form field after sanitizing to a safe basename (no path separators or `..`; result must match `/^[0-9]{2}_[\w.-]+$/`) — reject with 400 otherwise
- [x] Rejects with 400: extensions outside jpg/jpeg/png/webp/gif, and files larger than 15 MB
- [x] On success returns `{ "filename": string, "size": number }` as JSON
- [x] Verified with `curl` against a dev server (`npx next dev -p 3001`): valid upload lands on disk; bad extension, oversize, traversal filename, and unknown task each return the correct error status
- [x] Typecheck passes (`npx tsc --noEmit` in `dashboard/`)

### US-002: Photo picker on the Ad Builder form
**Description:** As a user creating an ad, I want to attach photos on the request form so my listing can include images.

**Acceptance Criteria:**
- [x] New client component `dashboard/components/PhotoPicker.tsx` rendered in the Ad Builder form between the existing fields and the submit button
- [x] "Add photos" control opens a file dialog (`accept="image/jpeg,image/png,image/webp,image/gif"`, `multiple`); selected files render as a thumbnail grid using object URLs (revoked on removal/unmount)
- [x] Each thumbnail shows the filename and a remove (×) button
- [x] Files with a disallowed extension or over 15 MB are rejected at selection time with an inline message naming the file and the reason
- [x] Submit is disabled with a visible "At least 1 photo is required" hint until one or more photos are attached
- [x] Typecheck passes
- [x] Verify changes work in browser

### US-003: Drag-and-drop ordering and primary star
**Description:** As a user, I want to control photo order and pick the primary image, because the first photo becomes the listing's cover on the marketplaces.

**Acceptance Criteria:**
- [x] Thumbnails in `PhotoPicker` can be reordered by drag-and-drop (HTML5 drag events; no new dependency)
- [x] Each thumbnail has a star toggle; exactly one photo is primary at all times, defaulting to the first added
- [x] The primary thumbnail is visually distinct (filled star + "Primary" badge)
- [x] Removing the primary photo promotes the first remaining photo to primary
- [x] Ordering state and primary choice are exposed to the form (ordered `File[]` with a primary index)
- [x] Typecheck passes
- [x] Verify changes work in browser

### US-004: Submission uploads photos in order
**Description:** As a user, when I submit the ad request I want my photos uploaded automatically in my chosen order, so the poster can use them without any manual file copying.

**Acceptance Criteria:**
- [ ] Ad Builder submit flow becomes: create task via `POST /api/tasks` → upload photos sequentially via `POST /api/tasks/[id]/photos` → fire `POST /api/run-worker` → redirect to `/tasks?focus=<id>` (worker trigger and redirect happen only after every upload succeeds)
- [ ] Upload filenames encode order: primary gets prefix `00_`, remaining photos `01_`, `02_`, … in gallery order, followed by the sanitized original filename
- [ ] During upload the form shows progress ("Uploading photo 2 of 5…") and the submit button stays disabled
- [ ] After submission, `workers/workspace/outputs/<taskId>/photos/` contains all files in prefix order with the starred photo as `00_*`
- [ ] `task.metadata` gains `photoCount: number` and `primaryPhoto: string` (the saved filename) for display/debugging
- [ ] Typecheck passes
- [ ] Verify changes work in browser (submit a real request with 3+ photos, confirm files and order on disk)

### US-005: Upload failure handling in the form
**Description:** As a user, if a photo fails to upload I want to see which one failed and retry it, so a flaky upload doesn't strand my ad request in a half-built state.

**Acceptance Criteria:**
- [ ] A failed upload marks that thumbnail with an error state (red border + short error message); remaining queued photos still attempt
- [ ] When any upload fails, the worker is NOT triggered and no redirect happens; the form shows a summary ("2 of 5 photos failed to upload") with a "Retry failed uploads" button that re-attempts only the failed files
- [ ] User can alternatively remove a failed photo and proceed, as long as at least 1 photo uploaded successfully
- [ ] If `POST /api/tasks` itself fails, an inline error is shown and no uploads are attempted
- [ ] Network failure is simulated in verification (e.g. stop the dev server or block the route) to confirm the error and retry path render
- [ ] Typecheck passes
- [ ] Verify changes work in browser

### US-006: Poster fails fast when photos are missing
**Description:** As the operator, I want a posting attempt on a task without photos to fail immediately with a clear message, so legacy or hand-edited tasks don't burn retries inside Playwright with a confusing site error.

**Acceptance Criteria:**
- [ ] `workers/posting/post.ts` (or `post-common.ts`) checks `listPhotos()` before launching the browser; if empty/missing, it exits non-zero with the message `No photos found in outputs/<taskId>/photos — upload photos and Retry`
- [ ] That message flows through `run-poster.sh` into the posting's `lastError` unchanged (verify by running the poster against a photo-less test task)
- [ ] Tasks with photos post exactly as before
- [ ] Typecheck passes

### US-007: Posting failure detail popover
**Description:** As a reviewer, I want to click a failed posting chip and see the full error, attempt count, and proof screenshot, so I can diagnose the failure instead of squinting at a truncated tooltip.

**Acceptance Criteria:**
- [ ] In `PostingChips.tsx`, clicking a `Failed` chip opens a popover (closes on outside click / Escape) instead of relying on the title tooltip
- [ ] Popover shows: full `lastError` text (scrollable if long), `attempts` of 3, and a link to the screenshot via the existing `/api/files` route when `screenshotPath` is set
- [ ] The existing Retry button moves into the popover and keeps its current behavior (reset to `queued`, `attempts: 0`, fire `POST /api/run-poster`)
- [ ] Queued/Posting/Posted chips are unchanged
- [ ] Typecheck passes
- [ ] Verify changes work in browser

### US-008: Permanently-failed postings banner on the tasks page
**Description:** As an operator, I want the tasks page to tell me when any ad has given up posting, so failures don't sit unnoticed inside a collapsed card.

**Acceptance Criteria:**
- [ ] The tasks page shows a dismissible amber banner when any task has a posting with `status === 'failed'` and `attempts >= 3`: "N posting(s) need attention" with the affected task titles as links (`/tasks?focus=<id>`)
- [ ] Banner count updates with the existing task-list refresh cycle and disappears when no permanently failed postings remain
- [ ] Dismissal lasts for the session (e.g. `sessionStorage`) and the banner reappears if a NEW posting permanently fails after dismissal
- [ ] No banner when there are no failed postings
- [ ] Typecheck passes
- [ ] Verify changes work in browser

## Non-Goals

- No adding, removing, or reordering photos after the ad request is submitted (no photo management on task cards) — v1 is create-time only; the workaround remains editing `outputs/<taskId>/photos/` on disk
- No image processing: no resizing, compression, EXIF stripping, or format conversion
- No per-platform photo rules (min/max counts, aspect ratios) — one global requirement of ≥1 photo
- No changes to the four disabled platforms or to the posting scripts' upload mechanics beyond the US-006 preflight
- No cloud/object storage — photos live on the local filesystem like everything else in this project
- No changes to the ad copy generation workflow (`generate-ad.md`, worker prompt building)

## Technical Considerations

- **Order/primary contract is filename-based:** `listPhotos()` in `workers/posting/post-common.ts` sorts by name and both posters pass the array to `setInputFiles()` in order — the `00_`/`01_`/… prefix scheme is the entire ordering mechanism. Do not add a parallel ordering field to the task record.
- **Uploads go through a new dedicated route**, not the existing `files/[...path]` API — that route is GET/PUT-text only and deliberately restricted; keep it that way. The new route must never write outside `workers/workspace/outputs/<taskId>/photos/`.
- **Task record writes stay on the API** (`dashboard/lib/data.ts` atomic-write chain); the upload route touches only the filesystem photos dir plus one `PATCH`-equivalent metadata update via `updateTask`.
- **Next.js route handlers** support `await request.formData()` for multipart; no extra dependency needed. Check body-size limits for the route (15 MB files) and raise the route config if required.
- **Dev verification:** port 3000 serves stale production code — always verify against `npx next dev -p 3001`, then kill it. No test framework in `dashboard/`; verify API behavior with `curl` (create temp task → exercise → DELETE it).
- **Reuse:** thumbnail/badge styling from existing components (`StatusBadge.tsx`), chip patterns from `PostingChips.tsx`, detached-spawn and refresh patterns already in place.
