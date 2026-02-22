/**
 * Positions by table size (number of players).
 * Ring order: SB, BB, UTG, ... through CO, finishing with BTN.
 */
export const POSITIONS_BY_PLAYERS = {
  6: [
    { value: 'SB', label: 'SB' },
    { value: 'BB', label: 'BB' },
    { value: 'UTG', label: 'UTG' },
    { value: 'MP', label: 'MP' },
    { value: 'CO', label: 'CO' },
    { value: 'BTN', label: 'BTN' },
  ],
  8: [
    { value: 'SB', label: 'SB' },
    { value: 'BB', label: 'BB' },
    { value: 'UTG', label: 'UTG' },
    { value: 'UTG+1', label: 'UTG+1' },
    { value: 'MP', label: 'MP' },
    { value: 'HJ', label: 'HJ' },
    { value: 'CO', label: 'CO' },
    { value: 'BTN', label: 'BTN' },
  ],
  9: [
    { value: 'SB', label: 'SB' },
    { value: 'BB', label: 'BB' },
    { value: 'UTG', label: 'UTG' },
    { value: 'UTG+1', label: 'UTG+1' },
    { value: 'UTG+2', label: 'UTG+2' },
    { value: 'MP', label: 'MP' },
    { value: 'HJ', label: 'HJ' },
    { value: 'CO', label: 'CO' },
    { value: 'BTN', label: 'BTN' },
  ],
};

export const PLAYER_COUNTS = [6, 8, 9];
