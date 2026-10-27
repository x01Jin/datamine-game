# Controls

This page is the full key and pointer reference. The build list, inspector and Settings expose the same actions where they apply.

## Keys

| Key       | Action                                                            |
| --------- | ----------------------------------------------------------------- |
| `P`       | Pause or resume                                                   |
| `M`       | Mute or unmute                                                    |
| `H`       | Fit the network                                                   |
| `B` / `C` | Open the build list / the codex                                   |
| `G`       | Toggle grid snap                                                  |
| `R`       | Turn the selected machine, or the armed placement, a quarter turn |
| `+` / `-` | Zoom in / out                                                     |
| `Esc`     | Cancel placement, drawing or selection                            |
| `Delete`  | Dismantle the selected machine, cut a wire, remove an anchor      |

Keys are ignored while a text field has focus and while a modal or Settings is open. `Esc` closes a modal or Settings first, then clears the armed build and any wire draft, then deselects.

`R` turns extractors and processors. The vault and wires do not rotate. An extractor has no inputs, so turning it only moves its output face.

## Placement

Click a build card to arm it. The ghost follows the pointer and snaps to the grid.

- **Click** the board to place one machine. The card disarms.
- **Shift-click** places and keeps the card armed with the same rotation, so a row of identical machines takes one arming.
- **`R`** turns an armed extractor or processor a quarter turn. The ghost moves its input and output markers and redraws the direction chevron to match.
- **Right-click** cancels the armed purchase. The board checks for an armed build before it looks for a wire draft or an anchor, so right-click cancels placement rather than editing the board.
- **`Esc`** cancels the armed purchase and any wire draft.
- **Click the armed card again** to disarm it.

Arming a card resets the rotation to 0. A placed machine keeps the rotation it was built with, and wires attach to the ports on the new faces.

## Mouse

Drag to pan, hold `Space` and drag to pan anywhere, scroll to zoom. Double-click a wire to add a route point, drag the point to move it, right-click it to remove it. Right-click cancels an armed build first; while wiring it drops the last point, otherwise it removes the anchor under the pointer.

## Touch

Tap selects or places. Drag pans, pinch zooms. Tapping the armed card again cancels it.

Rotation during placement is not reachable on touch: `R` and right-click are desktop-only, and there is no tap equivalent for either. A machine can be turned after it is placed, from the `Turn 90°` button in its inspector.
