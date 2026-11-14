'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), {EventEmitter}=require('node:events');
const {installWindowShell}=require('../../src/quota/window-shell');
const { version } = require('../../package.json');
function fixture(){
 const handlers=new Map(), messages=[], overlays=[], notices=[], built=[];
 const window=new EventEmitter();Object.assign(window,{isDestroyed:()=>false,isFocused:()=>true,isMaximized:()=>false,setTitleBarOverlay:value=>overlays.push(value),webContents:{send:(...args)=>messages.push(args)}});
 const sender={};const event={sender};
 // The application menu is built first; the title bar's one popup (window:menu 'app') second.
 const Menu={buildFromTemplate:items=>{const menu={items,popups:0,popup(){menu.popups++;},getMenuItemById:id=>({submenu:{items:items.find(i=>i.id===id).submenu,popup:()=>{}}})};built.push(menu);return menu;},setApplicationMenu:()=>{}};
 installWindowShell(window,{app:{getVersion:()=>version},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},Menu,dialog:{showMessageBox:async(_w,value)=>notices.push(value)}},e=>e.sender===sender);
 return {handlers,messages,overlays,notices,event,menu:built[0],app:built[1],window};
}
test('window IPC admits only fixed menu/theme values and the product sender',()=>{
 const f=fixture();
 for(const name of ['file','../../auth.json',null,{},'login'])assert.throws(()=>f.handlers.get('window:menu')(f.event,name),/WINDOW_ACTION_REJECTED/);
 assert.throws(()=>f.handlers.get('window:theme')(f.event,'#fff'),/WINDOW_ACTION_REJECTED/);
 for(const [key,argument] of [['window:menu','statistics'],['window:theme','dark'],['window:state',undefined]])assert.throws(()=>f.handlers.get(key)({},argument),/WINDOW_ACTION_REJECTED/);
 assert.equal(f.handlers.size,3);assert.deepEqual(f.messages,[]);
});
test('product menus route existing actions; theme/state are presentation-only',()=>{
 const f=fixture();assert.deepEqual(f.menu.items.map(i=>i.label),['统计','外观','关于']);
 f.menu.items[0].submenu[0].click();assert.deepEqual(f.messages.pop(),['window:command','refresh']);
 f.handlers.get('window:theme')(f.event,'dark');assert.deepEqual(f.overlays[0],{color:'#111112',symbolColor:'#f5f5f5',height:44});
 f.window.emit('focus');assert.deepEqual(f.messages.pop(),['window:state',{focused:true,maximized:false}]);
 f.handlers.get('window:menu')(f.event,'about');assert.equal(f.notices[0].message,'QuotaDock '+version);
});
test('the title bar popup holds the same three groups, separated, with the same actions',()=>{
 const f=fixture();
 assert.deepEqual(f.app.items.map(i=>i.type==='separator'?'|':i.label),['刷新当前页面','导出统计…','|','显示 / 隐藏侧栏','显示 / 隐藏概要','切换深浅外观','色彩外观','|','界面动效','设置','|','关于 QuotaDock']);
 f.app.items[0].click();assert.deepEqual(f.messages.pop(),['window:command','refresh']);
 f.handlers.get('window:menu')(f.event,'app');assert.equal(f.app.popups,1);
 assert.throws(()=>f.handlers.get('window:menu')({},'app'),/WINDOW_ACTION_REJECTED/);
});
