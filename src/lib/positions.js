/**
 * Positions by table size (number of players).
 * Order: BTN, SB, BB, then UTG and onward to CO.
 */
export const POSITIONS_BY_PLAYERS = {
  6: [
    { value: 'BTN', label: 'BTN' },
    { value: 'SB', label: 'SB' },
    { value: 'BB', label: 'BB' },
    { value: 'UTG', label: 'UTG' },
    { value: 'MP', label: 'MP' },
    { value: 'CO', label: 'CO' },
  ],
  8: [
    { value: 'BTN', label: 'BTN' },
    { value: 'SB', label: 'SB' },
    { value: 'BB', label: 'BB' },
    { value: 'UTG', label: 'UTG' },
    { value: 'UTG+1', label: 'UTG+1' },
    { value: 'MP', label: 'MP' },
    { value: 'HJ', label: 'HJ' },
    { value: 'CO', label: 'CO' },
  ],
  9: [
    { value: 'BTN', label: 'BTN' },
    { value: 'SB', label: 'SB' },
    { value: 'BB', label: 'BB' },
    { value: 'UTG', label: 'UTG' },
    { value: 'UTG+1', label: 'UTG+1' },
    { value: 'UTG+2', label: 'UTG+2' },
    { value: 'MP', label: 'MP' },
    { value: 'HJ', label: 'HJ' },
    { value: 'CO', label: 'CO' },
  ],
};

export const PLAYER_COUNTS = [6, 8, 9];
