import React from 'react';
import { createRoot } from 'react-dom/client';
import { SortableTree } from './features/info-panel/components/testing/sortable-tree';

function Demo() {
  return (
    <div style={{ maxWidth: 600, margin: '5% auto', padding: 10 }}>
      <SortableTree collapsible indicator removable />
    </div>
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('root element missing');
createRoot(el).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>
);
