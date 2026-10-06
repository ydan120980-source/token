'use strict';
// Only window presentation and existing UI commands. No filesystem/account capabilities.
function installWindowShell(window, { ipcMain, Menu, dialog }, valid) {
  const send = command => { if (!window.isDestroyed()) window.webContents.send('window:command', command); };
  const state = () => ({ focused:window.isFocused(), maximized:window.isMaximized() });
  const menus = [
    { label:'统计', id:'statistics', submenu:[
      {label:'刷新当前页面', accelerator:'CmdOrCtrl+R', click:()=>send('refresh')},
      {label:'导出统计…', accelerator:'CmdOrCtrl+E', click:()=>send('export')}] },
    { label:'外观', id:'appearance', submenu:[
      {label:'显示 / 隐藏侧栏',accelerator:'CmdOrCtrl+B',click:()=>send('sidebar')},
      {label:'切换深浅外观',click:()=>send('theme')}, {type:'separator'},
      {label:'界面动效',submenu:[{label:'跟随系统',click:()=>send('motion-system')},{label:'减少动态',click:()=>send('motion-reduced')},{label:'关闭动效',click:()=>send('motion-off')}]},
      {label:'设置',accelerator:'CmdOrCtrl+,',click:()=>send('settings')}] },
    { label:'关于', id:'about', submenu:[{label:'关于 Agent Usage',click:()=>{
      void dialog.showMessageBox(window,{type:'info',title:'Agent Usage',message:'Agent Usage '+require('../../package.json').version,detail:'本机用量与 Codex 额度\nCtrl+R 刷新当前页面 · Ctrl+E 导出统计\nAlt+← / → 页面历史 · Ctrl+B 切换侧栏\nAPI 等价估算不代表订阅账单。',buttons:['关闭']});
    }}] }
  ];
  const menu = Menu.buildFromTemplate(menus); Menu.setApplicationMenu(menu);
  ipcMain.handle('window:menu',(event,name)=>{
    if (!valid(event) || !['statistics','appearance','about'].includes(name)) throw new Error('WINDOW_ACTION_REJECTED');
    if(name==='about') menu.getMenuItemById(name).submenu.items[0].click();
    else menu.getMenuItemById(name).submenu.popup({window}); return true;
  });
  ipcMain.handle('window:theme',(event,value)=>{
    if (!valid(event) || !['light','dark'].includes(value)) throw new Error('WINDOW_ACTION_REJECTED');
    window.setTitleBarOverlay({color:value==='dark'?'#202123':'#f6f6f6',symbolColor:value==='dark'?'#f1f1f2':'#242426',height:44}); return true;
  });
  ipcMain.handle('window:state',event=>{if(!valid(event)) throw new Error('WINDOW_ACTION_REJECTED'); return state();});
  for (const event of ['focus','blur','maximize','unmaximize']) window.on(event,()=>{if(!window.isDestroyed()) window.webContents.send('window:state',state());});
}
module.exports = { installWindowShell };
