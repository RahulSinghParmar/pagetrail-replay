// SPDX-License-Identifier: AGPL-3.0-or-later
import type { RecordedAction } from "./visual-store";
// Runs in a named isolated world in every engine-accessible document, including OOPIFs.
// No input values, keystrokes, cookies or authentication state are read.
export const OBSERVER_WORLD = "pagetrail-visual-observer";
export const OBSERVER_BINDING = "__pagetrail_visual_changed__";
export const OBSERVER_SOURCE = `(()=>{
if(globalThis.__ptVisualStop)return;let timer,hard;
function emit(action){try{globalThis.${OBSERVER_BINDING}(JSON.stringify(action||{}))}catch{}}
function flush(){clearTimeout(timer);clearTimeout(hard);timer=hard=undefined;emit()}
function changed(){clearTimeout(timer);timer=setTimeout(flush,350);hard ||=setTimeout(flush,1500)}
const observer=new MutationObserver(changed);
function start(){observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['src','class','style','hidden','aria-expanded']});emit()}
function click(e){const n=e.target.closest('a,button,[role="button"],summary');if(!n)return;const path=[];let v=n;while(v&&v.nodeType===1){let i=1,s=v.previousElementSibling;while(s){if(s.localName===v.localName)i++;s=s.previousElementSibling}path.unshift(v.localName+':nth-of-type('+i+')');v=v.parentElement}emit({frame:location.href,selector:path.join('>'),label:(n.textContent||'').trim().slice(0,120)})}
document.addEventListener('click',click,true);document.addEventListener('scroll',changed,true);document.addEventListener('load',changed,true);
if(document.documentElement)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
globalThis.__ptVisualStop=()=>{observer.disconnect();clearTimeout(timer);clearTimeout(hard);document.removeEventListener('click',click,true);document.removeEventListener('scroll',changed,true);document.removeEventListener('load',changed,true);document.removeEventListener('DOMContentLoaded',start);delete globalThis.__ptVisualStop}
})()`;
type Action = Omit<RecordedAction, "from">;
export function captureLoop(deps: {
  capture: (action?: Action) => Promise<void>;
  error: (error: unknown) => Promise<void>;
  delay?: number;
  maxDelay?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined,
    hard: ReturnType<typeof setTimeout> | undefined,
    pending: Promise<void> = Promise.resolve(),
    active = true,
    busy = false,
    dirty = false,
    action: Action | undefined;
  const clear = () => {
    clearTimeout(timer);
    clearTimeout(hard);
    timer = hard = undefined;
  };
  const run = () => {
    clear();
    if (!active) return pending;
    if (busy) {
      dirty = true;
      return pending;
    }
    busy = true;
    dirty = false;
    const selected = action;
    action = undefined;
    pending = pending
      .then(() => deps.capture(selected))
      .catch(deps.error)
      .finally(() => {
        busy = false;
        if (active && dirty) {
          timer = setTimeout(() => {
            void run();
          }, deps.delay ?? 600);
        }
      });
    return pending;
  };
  return {
    changed(next?: Action) {
      if (!active) return;
      if (next) action = next;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void run();
      }, deps.delay ?? 600);
      hard ||= setTimeout(() => {
        void run();
      }, deps.maxDelay ?? 2000);
    },
    async stop(final: boolean) {
      clear();
      // Stop accepting changes first; serialize one final capture before recorder detach.
      active = false;
      await pending;
      if (final) await deps.capture(action).catch(deps.error);
    },
  };
}
