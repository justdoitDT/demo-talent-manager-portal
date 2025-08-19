// frontend/src/types/react-resizable.d.ts

declare module 'react-resizable' {
  import * as React from 'react';
  export interface ResizeCallbackData { size: { width: number; height: number } }
  export interface ResizableBoxProps extends React.HTMLAttributes<HTMLElement> {
    width: number;
    height: number;
    axis?: 'x' | 'y' | 'both';
    minConstraints?: [number, number];
    maxConstraints?: [number, number];
    resizeHandles?: Array<'n'|'s'|'e'|'w'|'ne'|'se'|'sw'|'nw'>;
    onResizeStop?: (event: React.SyntheticEvent, data: ResizeCallbackData) => void;
    handle?: React.ReactElement;
  }
  export const ResizableBox: React.FC<ResizableBoxProps>;
}
