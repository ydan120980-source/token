'use strict';
// Deliberately bounded data grammars. Unsupported syntax stays unchecked;
// neither grammar evaluates expressions, tags, templates or references.
const object=()=>Object.create(null);
const fail=(code='SYNTAX_UNSUPPORTED')=>{throw new Error(code);};
class Scanner{
  constructor(text,toml=false){this.text=text;this.at=0;this.toml=toml;this.nodes=0;this.sealed=new WeakSet();this.tables=new WeakSet();this.dotted=new WeakSet();}
  space(){while(this.at<this.text.length){if(/[ \t\r\n]/.test(this.text[this.at]))this.at++;else if(this.toml&&this.text[this.at]==='#'){while(this.at<this.text.length&&this.text[this.at]!=='\n')this.at++;}else break;}}
  string(){
    const quote=this.text[this.at],start=this.at++;if(this.text.slice(start,start+3)===quote.repeat(3))fail();
    while(this.at<this.text.length){const c=this.text[this.at++];if(c===quote){const raw=this.text.slice(start,this.at);return quote==="'"?raw.slice(1,-1):JSON.parse(raw);}
      if(c==='\n'||c==='\r'||c.charCodeAt(0)<32||this.toml&&c.charCodeAt(0)===127)fail();if(c==='\\'&&quote==='"'){if(this.at>=this.text.length||this.toml&&!['b','t','n','f','r','"','\\','u'].includes(this.text[this.at]))fail();this.at++;}}
    fail();
  }
  key(){this.space();if(this.text[this.at]==='"'||this.toml&&this.text[this.at]==="'")return this.string();if(!this.toml)fail();const match=/^[A-Za-z0-9_-]+/.exec(this.text.slice(this.at));if(!match)fail();this.at+=match[0].length;return match[0];}
  keys(){const start=this.at,keys=[this.key()];while(true){if(keys.length>24)fail('PARSE_LIMIT');if(this.text.slice(start,this.at).includes('\n'))fail();while(/[ \t]/.test(this.text[this.at]||'\0'))this.at++;if(this.text[this.at]!=='.')return keys;this.at++;keys.push(this.key());}}
  put(target,keys,value){for(const key of keys.slice(0,-1)){if(!Object.hasOwn(target,key))target[key]=object();target=target[key];if(!target||Array.isArray(target)||typeof target!=='object'||this.sealed.has(target))fail();this.dotted.add(target);}const key=keys.at(-1);if(Object.hasOwn(target,key))fail('DUPLICATE_KEY');target[key]=value;}
  value(depth=0){
    if(depth>24||++this.nodes>20000)fail('PARSE_LIMIT');this.space();const c=this.text[this.at];
    if(c==='"'||this.toml&&c==="'")return this.string();
    if(c==='['){this.at++;const out=[];this.space();if(this.text[this.at]===']'){this.at++;return out;}while(true){out.push(this.value(depth+1));this.space();const end=this.text[this.at++];if(end===']')return out;if(end!==',')fail();this.space();if(this.toml&&this.text[this.at]===']'){this.at++;return out;}}}
    if(c==='{'){
      this.at++;const start=this.at,out=object();this.space();if(this.text[this.at]==='}'){this.at++;this.sealed.add(out);return out;}
      while(true){const keys=this.toml?this.keys():[this.key()];this.space();if(this.text[this.at++]!==(this.toml?'=':':'))fail();this.put(out,keys,this.value(depth+1));this.space();const end=this.text[this.at++];if(this.toml&&this.text.slice(start,this.at).includes('\n'))fail();if(end==='}'){this.sealed.add(out);return out;}if(end!==',')fail();}
    }
    const tail=this.text.slice(this.at),literal=/^(true|false|null)(?=[\s,\]}#]|$)/.exec(tail);
    if(literal&&(!this.toml||literal[1]!=='null')){this.at+=literal[0].length;return JSON.parse(literal[1]);}
    const number=(this.toml?/^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?(?=[\s,\]}#]|$)/:/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?(?=[\s,\]}]|$)/).exec(tail);
    if(!number)fail();this.at+=number[0].length;const value=Number(number[0]);if(!Number.isFinite(value))fail();return value;
  }
}
function json(text){const scan=new Scanner(text),value=scan.value();scan.space();if(scan.at!==text.length)fail();return value;}
function toml(text){
  const scan=new Scanner(text,true),root=object(),declared=new WeakSet();let target=root;
  while(true){scan.space();if(scan.at===text.length)return root;
    if(text[scan.at]==='['){
      const start=scan.at;scan.at++;const array=text[scan.at]==='[';if(array)scan.at++;const keys=scan.keys();if(text.slice(start,scan.at).includes('\n'))fail();
      if(text[scan.at++]!==']'||array&&text[scan.at++]!==']')fail();target=root;
      for(const [index,key]of keys.entries()){
        const last=index===keys.length-1;
        if(array&&last){if(!Object.hasOwn(target,key)){target[key]=[];scan.tables.add(target[key]);}if(!scan.tables.has(target[key]))fail();const row=object();target[key].push(row);target=row;}
        else{if(!Object.hasOwn(target,key))target[key]=object();target=target[key];if(Array.isArray(target)){if(!scan.tables.has(target))fail();target=target.at(-1);}if(!target||typeof target!=='object'||scan.sealed.has(target))fail();}
      }
      if(!array&&(declared.has(target)||scan.dotted.has(target)))fail('DUPLICATE_KEY');declared.add(target);
    }else{const keys=scan.keys();while(/[ \t]/.test(text[scan.at]||'\0'))scan.at++;if(text[scan.at++]!=='=')fail();while(/[ \t]/.test(text[scan.at]||'\0'))scan.at++;if(/[\r\n#]/.test(text[scan.at]||'\0'))fail();scan.put(target,keys,scan.value());}
    while(/[ \t\r]/.test(text[scan.at]||'\0'))scan.at++;if(text[scan.at]==='#')while(scan.at<text.length&&text[scan.at]!=='\n')scan.at++;
    if(scan.at<text.length&&text[scan.at++]!=='\n')fail();
  }
}
function frontmatter(text){
  const lines=text.replaceAll('\r\n','\n').split('\n');if(lines.shift()!=='---'||lines.at(-1)!=='---')fail();lines.pop();const out=object();
  const scalar=raw=>{
    if(raw.startsWith('"'))return json(raw);
    if(raw.startsWith("'")){if(!/^'(?:[^']|'')*'$/.test(raw))fail();return raw.slice(1,-1).replaceAll("''", "'");}
    if(/[!&*{}[\]]/.test(raw)||/(?:^|\s)#|:(?:\s|$)/.test(raw))fail();
    if(/^(true|false|null)$/i.test(raw))return JSON.parse(raw.toLowerCase());
    if(raw==='~')return null;
    if(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw))return json(raw);
    // Other YAML numeric spellings are outside this bounded subset. Do not
    // silently reinterpret them as string names/descriptions and report OK.
    if(/^[+-]?(?:[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9_]+)?|\.[0-9_]+|0[xob][0-9A-Fa-f_]+|\.inf|\.nan)$/i.test(raw))fail();
    return raw;
  };
  for(let i=0;i<lines.length;i++){
    const line=lines[i];if(!line.trim()||line.trimStart().startsWith('#'))continue;
    const match=/^([a-z][a-z0-9_-]*):(?:[ \t]+(.*))?$/.exec(line);if(!match)fail();const [,key,raw='']=match;if(Object.hasOwn(out,key))fail('DUPLICATE_KEY');
    if(/^(?:[|>])[-+]?$/.test(raw)){let value='';while(i+1<lines.length&&(/^[ \t]+/.test(lines[i+1])||!lines[i+1].trim()))value+=lines[++i].trim()+' ';out[key]=value.trim();}
    else if(raw.startsWith('['))out[key]=json(raw); // JSON-style flow lists only.
    else if(!raw&&i+1<lines.length&&/^[ \t]+- /.test(lines[i+1])){
      const list=[];let indent=null;
      while(i+1<lines.length&&/^[ \t]+/.test(lines[i+1])){
        const entry=/^( +)- (.+)$/.exec(lines[++i]);if(!entry||indent!==null&&entry[1].length!==indent)fail();indent=entry[1].length;
        if(list.length>=64)fail('PARSE_LIMIT');list.push(scalar(entry[2]));
      }
      out[key]=list;
    }else out[key]=scalar(raw);
  }
  return out;
}
module.exports={json,toml,frontmatter};
