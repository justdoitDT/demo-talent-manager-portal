// frontend/src/pane/utils.ts

import React from 'react';

/**
 * A shared placeholder for empty values.
 */
export const NONE: React.ReactNode = React.createElement(
  'em',
  { style: { color: '#999' } },
  'None'
);
