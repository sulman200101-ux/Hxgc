import React, { useEffect, useState } from 'react';
export function PdfExportProgress() {
  const [state,setState]=useState<{done:number;total:number}|null>(null);
  useEffect(()=>{const onProgress=(event:Event)=>setState((event as CustomEvent).detail);window.addEventListener('asmo-pdf-progress',onProgress);return()=>window.removeEventListener('asmo-pdf-progress',onProgress);},[]);
  if(!state)return null;
  return <div role="status" className="fixed bottom-4 inset-x-4 z-[120] bg-stone-900 border border-amber-500 rounded-xl p-4 text-white" dir="rtl">جارٍ تجهيز PDF: {state.done.toLocaleString()} / {state.total.toLocaleString()}<progress className="block w-full mt-2" max={Math.max(state.total,1)} value={state.done} /></div>;
}
