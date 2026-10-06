'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), {EventEmitter}=require('node:events');
const {installWindowShell}=require('../../src/quota/window-shell');
function fixture(){
 const handlers=new Map(), messages=[], overlays=[], notices=[];let menu;
 const window=new EventEmitter();Object.assign(window,{isDestroyed:()=>false,isFocused:()=>true,isMaximized:()=>false,setTitleBarOverlay:value=>overlays.push(value),webContents:{send:(...args)=>messages.push(args)}});
 const sender={};const event={sender};
 const Menu={buildFromTemplate:items=>{menu={items,getMenuItemById:id=>({submenu:{items:items.find(i=>i.id===id).submenu,popup:()=>{}}})};return menu;},setApplicationMenu:()=>{}};
 installWindowShell(window,{app:{getVersion:()=> '0.1.0'},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},Menu,dialog:{showMessageBox:async(_w,value)=>notices.push(value)}},e=>e.sender===sender);
 return {handlers,messages,overlays,notices,event,menu,window};
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
 f.handlers.get('window:theme')(f.event,'dark');assert.deepEqual(f.overlays[0],{color:'#202123',symbolColor:'#f1f1f2',height:44});
 f.window.emit('focus');assert.deepEqual(f.messages.pop(),['window:state',{focused:true,maximized:false}]);
 f.handlers.get('window:menu')(f.event,'about');assert.equal(f.notices[0].message,'Agent Usage 0.1.0');
});
