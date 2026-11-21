# Controls

Two camera modes, switched with the footer pill (or Settings → Camera):

- **Orbit** (default): **left-drag** turns around a point, **scroll** zooms,
  **right-drag** pans the view (moves the center point). Selecting an
  aircraft follows it; deselecting eases back to the view you had.
  The footer's **share** button copies a link to the selected aircraft;
  opening one zooms in on that aircraft.
- **Free**: **left-drag** looks around, **WASD** or the arrow keys fly
  relative to where you look, **R / F** (or PageUp / PageDown) go straight
  up and down, **Shift** is fast, **scroll** pushes along the line of sight.

In orbit mode the camera can come within about a mile of the point it
turns around, **scroll** zooms toward whatever is under the cursor (toward
the aircraft while one is followed), and the eye can skim just above the
ground. The free camera slows down as it gets low, so close inspection is
not a blur.

**Spin** in the footer starts a slow auto-orbit and opens a direction and
speed popover; once the hand is still for two seconds the controls fade so
only the orbit is left, and any movement brings them back. Spin is an
orbit, so starting it switches a free camera back to orbit, and switching
to the free camera stops it.

With **3D airspace** on, click an airspace's name label to frame it and
open its info card; `Esc` or the × closes the card.

On a phone the aircraft list and the settings panel each fill the screen,
so opening one closes the other.

| Key | Action |
|---|---|
| Arrow keys | Pan the view (orbit) or fly (free) |
| `R` | Recenter camera + clear selection (orbit); straight up (free) |
| `/` | Focus the list search box |
| `Esc` | Close settings panel, ACARS panel or a popover |

---

Back to the [README](../README.md) or the [documentation index](README.md).
