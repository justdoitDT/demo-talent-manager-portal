// frontend/src/pane/SlidingPane.tsx

import React, { CSSProperties, SyntheticEvent, useEffect, useState } from 'react';
import { animated, useTransition } from '@react-spring/web';
import { ResizableBox, ResizeCallbackData } from 'react-resizable';
import 'react-resizable/css/styles.css';
import { usePane } from './PaneContext';
import { useZItem } from '../ui/ZStack';

import CreativePane from './panes/CreativePane';
import ProjectPane from './panes/ProjectPane';
import ExecutivePane from './panes/ExecutivePane';
import ManagerPane from './panes/ManagerPane';
import WritingSamplePane from './panes/WritingSamplePane';
import SubPane from './panes/SubPane';
import MandatePane from './panes/MandatePane';
import ExternalRepPane from './panes/ExternalRepPane';
import CompanyPane from './panes/CompanyPane';



export default function SlidingPane() {
  // const { payload, close, width, setWidth } = usePane();
  const { payload, width, setWidth } = usePane();
  const [paneTop, setPaneTop] = useState(0);
  const { zIndex, focus } = useZItem('pane');

  // Recompute top edge so it hugs the bottom of the .nav bar, or 0 if scrolled past
  useEffect(() => {
    const updateTop = () => {
      const nav = document.querySelector<HTMLElement>('.nav');
      if (nav) {
        const bottom = nav.getBoundingClientRect().bottom;
        setPaneTop(bottom > 0 ? bottom + 0 : 0);
      }
    };
    updateTop();
    window.addEventListener('scroll', updateTop);
    window.addEventListener('resize', updateTop);
    return () => {
      window.removeEventListener('scroll', updateTop);
      window.removeEventListener('resize', updateTop);
    };
  }, []);

  const transitions = useTransition(payload, {
    from:   { transform: 'translateX(100%)' },
    enter:  { transform: 'translateX(0%)'    },
    leave:  { transform: 'translateX(100%)'  },
    config: { tension: 300, friction: 25      },
  });

  return transitions(
    (style, pl) =>
      pl && (
        <animated.div
          onPointerDown={focus}
          style={{
            ...style,
            position: 'fixed',
            top: paneTop,
            right: 0,
            bottom: 0,
            zIndex,
          }}
        >
          <ResizableBox
            width={width}
            height={window.innerHeight - paneTop}
            minConstraints={[320, 100]}
            maxConstraints={[window.innerWidth, window.innerHeight - paneTop]}
            axis="x"
            resizeHandles={['w']}
            onResizeStop={(_e: SyntheticEvent, data: ResizeCallbackData) =>
              setWidth(data.size.width)
            }
            handle={<div style={gripCSS} />}
          >
            <div style={paneCSS}>
              {/* visible handle indicator */}
              <div style={handleIndicatorCSS} />

              {pl.kind === 'creative'      && <CreativePane       id={pl.id} />}
              {pl.kind === 'project'       && <ProjectPane        id={pl.id} />}
              {pl.kind === 'executive'     && <ExecutivePane      id={pl.id} />}
              {pl.kind === 'manager'       && <ManagerPane        id={pl.id} />}
              {pl.kind === 'writingSample' && <WritingSamplePane  id={pl.id} />}
              {pl.kind === 'sub'           && <SubPane            id={pl.id} />}
              {pl.kind === 'mandate'       && <MandatePane        id={pl.id} />}
              {pl.kind === 'externalRep'   && <ExternalRepPane    id={pl.id} />}
              {pl.kind === 'company'       && <CompanyPane    id={pl.id} />}
            </div>
          </ResizableBox>
        </animated.div>
      )
  );
}

const paneCSS: CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  background: '#fff',
  borderLeft: '1px solid #ccc',
  boxShadow: '-2px 0 6px rgba(0,0,0,.15)',
};

const gripCSS: CSSProperties = {
  position: 'absolute',
  left: -6,
  top: 0,
  bottom: 0,
  width: 12,
  cursor: 'ew-resize',
  background: 'transparent',
};

const handleIndicatorCSS: CSSProperties = {
  position: 'absolute',
  left: -4,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 8,
  height: 40,
  background: '#ccc',
  borderRadius: 4,
  pointerEvents: 'none',
};

// const closeCSS: CSSProperties = {
//   position: 'absolute',
//   left: 8,
//   top: 8,
//   border: 'none',
//   background: 'none',
//   fontSize: 24,
//   cursor: 'pointer',
// };
