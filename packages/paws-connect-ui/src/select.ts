let sequence = 0;

/** Themeable select-only combobox. Keep the native value/change contract for hosts. */
export function enhanceSelect(select: HTMLSelectElement, displayLabel?: string) {
    const doc=select.ownerDocument, win=doc.defaultView!;
    const trigger=doc.createElement('button'), popup=doc.createElement('div');
    const nativePopover=typeof popup.showPopover==='function';
    let open=false, disposed=false, search='', searchAt=0;
    trigger.type='button'; trigger.className='paws-select-trigger'; trigger.disabled=select.disabled;
    trigger.setAttribute('role','combobox'); trigger.setAttribute('aria-haspopup','listbox');
    trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-label',select.getAttribute('aria-label')??'选择');
    if(select.hasAttribute('aria-invalid'))trigger.setAttribute('aria-invalid','true');
    for(const key of ['focus','rowId','control'])if(select.dataset[key]){trigger.dataset[key]=select.dataset[key];delete select.dataset[key];}
    popup.id=`paws-select-${++sequence}`; popup.className='paws-select-menu'; popup.setAttribute('role','listbox');
    popup.setAttribute('aria-label',select.getAttribute('aria-label')??'选项'); popup.hidden=true;
    if(nativePopover)popup.setAttribute('popover','auto');
    trigger.setAttribute('aria-controls',popup.id);
    const label=doc.createElement('span'), chevron=doc.createElement('span');
    chevron.className='paws-select-chevron'; chevron.textContent='⌄'; chevron.setAttribute('aria-hidden','true');
    trigger.append(label,chevron); select.hidden=true; select.after(trigger,popup);
    const items=[...select.options].map(option=>{
        const item=doc.createElement('button');item.type='button';item.tabIndex=-1;item.disabled=option.disabled;
        item.setAttribute('role','option');item.dataset.value=option.value;
        const text=doc.createElement('span'),check=doc.createElement('span');text.textContent=option.textContent;
        check.className='paws-select-check';check.textContent='✓';check.setAttribute('aria-hidden','true');item.append(text,check);
        item.onclick=()=>{
            if(disposed||select.disabled||item.disabled||!select.isConnected)return;
            const changed=select.value!==option.value;select.value=option.value;sync();close(true);
            if(changed)select.dispatchEvent(new win.Event('change',{bubbles:true}));
        };
        popup.append(item);return item;
    });
    function sync(){
        label.textContent=displayLabel??select.selectedOptions[0]?.textContent??'';
        trigger.title=select.title||label.textContent;
        for(const item of items)item.setAttribute('aria-selected',String(item.dataset.value===select.value));
    }
    const enabled=()=>items.filter(item=>!item.disabled);
    function position(){
        if(!open)return;
        const viewport=win.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0;
        const width=viewport?.width??win.innerWidth,height=viewport?.height??win.innerHeight,r=trigger.getBoundingClientRect();
        const above=Math.max(0,r.top-top-12),below=Math.max(0,top+height-r.bottom-12);
        const up=below<Math.min(popup.scrollHeight||320,320)&&above>below;
        popup.style.width=Math.min(Math.max(r.width,240),width-24)+'px';
        popup.style.maxHeight=Math.max(44,Math.min(360,up?above:below))+'px';
        popup.style.left=Math.max(left+12,Math.min(r.left,left+width-popup.getBoundingClientRect().width-12))+'px';
        popup.style.top=(up?Math.max(top+12,r.top-popup.getBoundingClientRect().height-6):r.bottom+6)+'px';
    }
    function close(focus=false){
        if(!open)return;open=false;trigger.setAttribute('aria-expanded','false');
        if(nativePopover&&popup.matches(':popover-open'))popup.hidePopover();popup.hidden=true;
        if(focus&&trigger.isConnected)trigger.focus();
    }
    function show(last=false){
        if(disposed||select.disabled||!select.isConnected)return;
        open=true;popup.hidden=false;trigger.setAttribute('aria-expanded','true');
        if(nativePopover)popup.showPopover();position();
        const choices=enabled(),selected=choices.find(item=>item.dataset.value===select.value);
        (selected??(last?choices.at(-1):choices[0]))?.focus();
    }
    const onClick=()=>open?close(true):show();
    const onKey=(event:KeyboardEvent)=>{
        if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);return;}
        if(event.key==='Tab'&&open){close(true);return;}
        const navigation=['ArrowDown','ArrowUp','Home','End'];
        if(navigation.includes(event.key)){
            event.preventDefault();if(!open){show(event.key==='ArrowUp'||event.key==='End');if(event.key==='Home')enabled()[0]?.focus();else if(event.key==='End')enabled().at(-1)?.focus();return;}
            const choices=enabled(),index=choices.indexOf(doc.activeElement as HTMLButtonElement);
            const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;
            choices[next]?.focus();return;
        }
        if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key!==' '){
            event.preventDefault();const now=Date.now();search=now-searchAt>600?event.key:search+event.key;searchAt=now;
            if(!open)show();enabled().find(item=>item.textContent?.toLocaleLowerCase().startsWith(search.toLocaleLowerCase()))?.focus();
        }
    };
    const outside=(event:Event)=>{if(!trigger.contains(event.target as Node)&&!popup.contains(event.target as Node))close();};
    const toggle=()=>{if(nativePopover&&!popup.matches(':popover-open'))close();};
    const scroll=(event:Event)=>{if(!popup.contains(event.target as Node))position();};
    trigger.addEventListener('click',onClick);trigger.addEventListener('keydown',onKey);popup.addEventListener('keydown',onKey);popup.addEventListener('toggle',toggle);
    doc.addEventListener('pointerdown',outside);win.addEventListener('resize',position);doc.addEventListener('scroll',scroll,true);
    win.visualViewport?.addEventListener('resize',position);win.visualViewport?.addEventListener('scroll',position);
    sync();
    return {trigger,popup,close,destroy(){
        if(disposed)return;disposed=true;close();doc.removeEventListener('pointerdown',outside);win.removeEventListener('resize',position);doc.removeEventListener('scroll',scroll,true);
        win.visualViewport?.removeEventListener('resize',position);win.visualViewport?.removeEventListener('scroll',position);
        trigger.remove();popup.remove();select.hidden=false;
    }};
}
