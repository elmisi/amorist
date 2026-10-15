(function (root) {
  "use strict";
  function create(options) {
    const now=options.now||Date.now;
    const later=options.setTimeout||setTimeout, cancelTimer=options.clearTimeout||clearTimeout;
    const idle=options.idleMs??2000, maximum=options.maximumMs??5000;
    let timer=null, pending=null, busy=false, generation=0;
    const current=snapshot=>!options.isCurrent||options.isCurrent(snapshot);
    function arm() {
      if(timer!==null)cancelTimer(timer);
      timer=null;
      if(busy||!pending)return;
      const due=pending.clean?now():Math.min(pending.last+idle,pending.first+maximum);
      timer=later(flush,Math.max(0,due-now()));
    }
    function flush() {
      timer=null;
      if(busy||!pending)return;
      const operation=pending, epoch=generation;
      pending=null;
      if(!current(operation.snapshot))return;
      busy=true;
      Promise.resolve().then(()=>operation.clean
        ?options.discard(operation.snapshot):options.persist(operation.snapshot))
        .catch(error=>{
          if(epoch===generation&&current(operation.snapshot))options.onError?.(error,operation.clean);
        }).finally(()=>{busy=false;arm();});
    }
    return {
      schedule(snapshot) {
        const time=now(), previous=pending?.snapshot;
        const same=previous&&previous.editor===snapshot.editor&&previous.context===snapshot.context
          &&previous.savedSource===snapshot.savedSource;
        pending={snapshot,first:same?pending.first:time,last:time,clean:snapshot.value===snapshot.savedSource};
        arm();
      },
      cancel() {
        generation+=1;
        if(timer!==null)cancelTimer(timer);
        timer=null;pending=null;
      },
    };
  }
  const api={create};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  else root.AmoristWorkingCopy=api;
})(typeof window!=="undefined"?window:globalThis);
