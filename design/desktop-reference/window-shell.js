'use strict';
(() => {
  const bridge=window.windowBridge; if(!bridge) return;
  const names={quota:'额度监控',usage:'用量',sources:'来源管理',settings:'设置'}, bar=document.getElementById('appTitlebar');
  bar.hidden=false;document.body.classList.add('integrated-titlebar');
  const back=document.getElementById('windowBack'), forward=document.getElementById('windowForward'), sidebar=document.getElementById('windowSidebar');
  const history=[document.getElementById('main').dataset.currentView], positions=new Map();let index=0,traveling=false;
  function update(){back.disabled=index===0;forward.disabled=index===history.length-1;document.getElementById('windowPage').textContent=names[history[index]];}
  function navigate(name){document.querySelector('.topbar [data-view="'+name+'"]').click();}
  function travel(delta){const next=index+delta;if(next<0||next>=history.length)return;positions.set(history[index],window.scrollY);index=next;traveling=true;navigate(history[index]);traveling=false;window.uiDetail.scrollTo(positions.get(history[index])||0);update();}
  back.onclick=()=>travel(-1);forward.onclick=()=>travel(1);
  window.addEventListener('keydown',event=>{if(event.altKey&&!event.ctrlKey&&!event.metaKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();travel(event.key==='ArrowLeft'?-1:1);}});
  window.addEventListener('ui-view-leave',()=>{if(!traveling)positions.set(history[index],window.scrollY);});
  window.addEventListener('ui-view-change',event=>{if(!traveling){history.splice(index+1);history.push(event.detail);index++;}window.uiSelect?.close();update();});
  let collapsed=false;try{collapsed=localStorage.getItem('agentusage.sidebar.v1')==='collapsed';}catch{/* Session only. */}
  function applySidebar(){document.body.classList.toggle('sidebar-collapsed',collapsed);document.querySelector('.topbar').inert=collapsed;sidebar.setAttribute('aria-expanded',String(!collapsed));sidebar.title=collapsed?'展开侧栏 (Ctrl+B)':'收起侧栏 (Ctrl+B)';window.uiMotion.cleanup();window.uiDetail.cancelScroll();window.uiSelect?.close();requestAnimationFrame(()=>window.uiMotion.indicators());}
  function toggleSidebar(){collapsed=!collapsed;applySidebar();try{localStorage.setItem('agentusage.sidebar.v1',collapsed?'collapsed':'expanded');}catch{/* Session only. */}}
  sidebar.onclick=toggleSidebar;applySidebar();
  for(const button of bar.querySelectorAll('[data-window-menu]')) button.onclick=()=>{void bridge.menu(button.dataset.windowMenu).catch(()=>{});};
  const command=action=>{
    if(action==='back')travel(-1);if(action==='forward')travel(1);if(action==='sidebar')toggleSidebar();
    if(action==='theme')document.getElementById('theme').click();if(action==='settings')navigate('settings');
    if(action.startsWith('motion-'))window.uiMotion.setPreference(action.slice(7));
    if(action==='export'){if(document.getElementById('main').dataset.currentView!=='usage')navigate('usage');document.querySelector('#usage [data-export]').click();}
    if(action==='refresh'){const view=document.getElementById('main').dataset.currentView;const id=view==='quota'?'quotaRefreshAll':view==='sources'?'sourceRefresh':'refresh';if(view==='settings')navigate('usage');document.getElementById(id).click();}
  };
  const stopCommand=bridge.onCommand(command), stopState=bridge.onState(state=>document.body.classList.toggle('window-inactive',!state.focused));
  void bridge.state().then(state=>document.body.classList.toggle('window-inactive',!state.focused));
  let dark;
  const themeObserver=new MutationObserver(()=>{const current=document.body.classList.contains('dark');if(current!==dark){dark=current;void bridge.theme(current?'dark':'light').catch(()=>{});}});
  themeObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  dark=document.body.classList.contains('dark');void bridge.theme(dark?'dark':'light');update();
  window.addEventListener('unload',()=>{stopCommand();stopState();themeObserver.disconnect();});
})();
