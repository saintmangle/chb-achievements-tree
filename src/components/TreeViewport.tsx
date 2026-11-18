import type { ReactNode } from 'react';
export function TreeViewport({children}:{children:ReactNode}) {
 return <div className="tree-window tree-static"><div className="tree-static-stage">{children}</div></div>;
}
