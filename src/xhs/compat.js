// Install only the missing platform pieces used by the offline bundle.
(function () {
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {
    configurable: true, writable: true,
    value: function (index) {
      index = Math.trunc(index) || 0;
      if (index < 0) index += this.length;
      return index >= 0 && index < this.length ? this[index] : undefined;
    }
  });
  if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true, writable: true,
    value: function (callback, receiver) {
      const mapped = [];
      this.forEach((value,index) => {
        const item=callback.call(receiver,value,index,this);
        if (Array.isArray(item)) item.forEach(value => mapped.push(value));
        else mapped.push(item);
      });
      return mapped;
    }
  });
  if (!Object.fromEntries) Object.defineProperty(Object, 'fromEntries', {
    configurable: true, writable: true,
    value: function (entries) {
      const object = {};
      for (const [key,value] of entries)
        Object.defineProperty(object,key,{value,enumerable:true,configurable:true,writable:true});
      return object;
    }
  });
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      constructor(resize) { this.resize=resize; }
      observe() { window.addEventListener('resize',this.resize); this.resize(); }
      disconnect() { window.removeEventListener('resize',this.resize); }
    };
  }
  const flex=document.createElement('div');
  flex.style.cssText='position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px';
  flex.appendChild(document.createElement('div'));
  flex.appendChild(document.createElement('div'));
  document.body.appendChild(flex);
  if(flex.scrollHeight!==1)document.documentElement.classList.add('no-flex-gap');
  flex.remove();
}());
