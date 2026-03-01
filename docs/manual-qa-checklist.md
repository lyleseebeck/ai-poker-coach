# Manual QA Checklist (Unified Hand Capture V2)

Run this after meaningful UI changes.

## Core Manual Flow

- [ ] Create a manual hand, fill required fields, and save successfully.
- [ ] Enter manual narrative with clear info (for example: "folded from BB preflop"), click parse, and confirm required fields auto-fill.
- [ ] Enter ambiguous narrative and confirm save is blocked until required fields are completed.
- [ ] If AI suggestions appear, confirm they require explicit Apply/Dismiss before save.

## Import Flow

- [ ] Paste full Ignition hand, parse preview, and confirm shared fields are prefilled.
- [ ] Confirm imported `netBb` and `netChips` are both populated when blinds are known.
- [ ] If import reaches river, try saving with fewer than 5 board cards and confirm a blocking error.
- [ ] If import is preflop-only, confirm "Hand didn't reach flop" is enforced.
- [ ] If import text has no community cards, confirm existing manually selected board cards are preserved.

## Card Picker UX

- [ ] Click a specific slot, pick a card, and confirm target advances sequentially from that slot.
- [ ] Confirm only the active slot has green highlight after auto-advance.
- [ ] Use `Clear` on hero and board slots and confirm cards are removed.
- [ ] Try selecting duplicate cards and confirm duplicate card error appears.

## Saved Hand Rendering

- [ ] Saved card shows source badge (`Manual` or `Imported`).
- [ ] Saved card shows blinds, player count, and net result in BB (and chips when present).
- [ ] Saved card shows per-street actions with bet sizes when entered.
- [ ] Imported hand shows expandable action timeline rows.

## Storage / Compatibility

- [ ] Verify app lists only V2 hands.
- [ ] Confirm legacy/non-V2 records do not crash UI.
- [ ] Deleting a saved hand shows an "are you sure" confirmation first.
- [ ] Confirm deleted hand moves to Trash instead of disappearing permanently.
- [ ] Restore a trashed hand and confirm it returns to Saved hands.
- [ ] Use "Delete now" in Trash and confirm permanent removal.
