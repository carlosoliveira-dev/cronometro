# Stopwatch

Mobile-first stopwatch with millisecond precision. The Go server renders the
page with `html/template`, Tailwind CSS handles the interface, and all the
counting happens on the client using the monotonic clock of `performance.now()`,
which avoids drift even with the screen locked or the tab in the background.

## Requirements

- Go 1.26 or newer
- Node.js 20 or newer (only to compile the CSS)

## How to run

```bash
npm install       # first time only, installs @tailwindcss/cli
npm run build:css # generates static/dist/app.css
go run .
```

Open `http://localhost:8080`. To change the port or the directories:

```bash
go run . -addr :3000 -v
```

The compiled CSS is committed to the repository, so `go run .` works without
`npm install` as long as `static/dist/app.css` exists.

### While developing

Open two terminals at the project root:

```bash
npm run watch:css   # terminal 1: recompiles the CSS whenever the template changes
go run . -v         # terminal 2: the server
```

## Features

- `mm:ss.mmm` display with the seconds highlighted in the accent colour; the
  minutes and milliseconds stay dimmed so the seconds dominate the reading. The
  milliseconds change every frame (60 or 120 Hz) and the seconds pulse on every
  rollover.
- Start, pause, resume and reset, with keyboard shortcuts.
- Laps with the lap time (split), the running total, and best/worst badges.
- Editing of a recorded lap: the adjustment is redistributed across the other
  laps so the session total stays the same, and it never produces a negative
  split.
- Keep the screen awake through the Wake Lock API, re-requested when the tab
  becomes visible again.
- Sound (WebAudio, no audio files) and vibration on start, stop and laps, each
  with its own toggle.
- Light and dark themes, following the system preference on the first visit.
- Laps and preferences persisted in `localStorage`; a session in progress comes
  back paused at the last recorded time.

### Shortcuts

| Key      | Action                 |
| -------- | ---------------------- |
| `Space`  | start, pause, resume   |
| `L`      | record a lap           |
| `R`      | reset                  |
| `Esc`    | close the lap editor   |

## Layout

```
main.go               server, routes and graceful shutdown
main_test.go          request level tests for the server
templates/index.html  single page with the display and the edit dialog
static/css/input.css  Tailwind source, with the theme and the custom animations
static/dist/app.css   compiled CSS (committed)
static/js/timer.js    pure logic: time, formatting and lap arithmetic
static/js/app.js      DOM, events, persistence, audio and wake lock
tests/timer.test.js   tests for the pure logic using the native Node runner
tests/css.test.js     checks that every class used is present in the CSS
```

The stored lap limit comes from the server (`maxLaps` in `main.go`, 5000 by
default). The interface renders at most the 200 most recent laps so a phone
browser stays responsive; the totals, best and worst consider every lap.

## Tests

```bash
go test ./...   # server and headers
npm test        # stopwatch and lap logic
gofmt -l .      # should print nothing
go vet ./...
```

## Implementation notes

- The clock state is `accumulated + (performance.now() - mark)`, so pausing,
  reloading the page or leaving the phone idle never makes the time jump or
  lag.
- The display only writes the groups whose value changed, which avoids
  recalculating layout on every frame.
- Rendering happens in `requestAnimationFrame` and is rescheduled when the tab
  becomes visible, which keeps the value correct with no background work.
- Editing or deleting laps does not affect the clock: the list is a record
  edited separately, and only the sum of the splits is recomputed.
- Wake Lock is only requested after a user gesture; browsers without support
  (iOS Safari) hide the toggle.
- The page body uses `min-height: 100svh` and the lap list uses
  `max-height: 42svh`. With only `min-height` the list grows with the content
  and the whole page starts scrolling; with the cap on the list the scrolling
  stays inside it, and the body only grows when the screen is too short for
  everything to fit, in which case the buttons remain reachable.
- The display sizes use `clamp` with `min(vw, vh)`, so the seconds shrink in
  landscape (short screen) and in narrow desktop windows without needing
  per-breakpoint media queries.
- On screens shorter than 520px the best/worst summary is hidden, and those
  badges stay visible on each list row.
- The asset `Cache-Control` is `no-cache`: Go's `http.FileServer` sends
  `Last-Modified`, so the browser revalidates and gets a 304 when nothing
  changed, without ever serving a stale JavaScript during development.
- The theme is applied by a small inline script before the first paint, reading
  the same `localStorage` key, so a reload never flashes the wrong theme.

## Verification performed

- `go test ./...`: routes, headers, favicon redirect and blocked method.
- `npm test`: 30 tests for the time and lap logic, plus a check that every class
  used in the template exists in the compiled CSS.
- Full browser flow (headless Edge over CDP): start, pause, resume, record
  laps, best and worst badges, editing with validation, deletion, `localStorage`
  persistence, theme switching and keyboard shortcuts, with no console errors.
- Layout audit across 6 viewports (320x568, 360x640, 390x844, 1280x800, 844x390
  and 420x520): no horizontal overflow, no block collisions, buttons of 44px or
  more, typographic hierarchy on the seconds and a scrollable list.
