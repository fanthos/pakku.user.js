// ==UserScript==
// @name        pakku.js modified by fts
// @namespace   me.fts.pakkujs
// @include     *://*.bilibili.com/*
// @version     1
// @grant       none
// ==/UserScript==

// Configuration
// I am too lazy to add configuration UI :)

THRESHOLD=parseInt(15);
DANMU_FUZZ = true;
TRIM_ENDING=true;
TAOLUS=fromholyjson('{"233...":"^23{2,}$","666...":"^6{3,}$","FFF...":"^[fF]+$","hhh...":"^[hH]+$"}');
REMOVE_SEEK=true;
FLASH_NOTIF=true;
DANMU_BADGE=true;
POPUP_BADGE='percent';
PROC_TYPE7=true;


MAX_DIST=1+DANMU_FUZZ * 4;


// Copied from edit_distance.js

var ed_counts = new Int16Array (0x10ffff);

var MIN_DANMU_SIZE=10;

function edit_distance (P, Q) {
    'use strict';

    // TODO: Make this less hacky
    if (P.length + Q.length < MIN_DANMU_SIZE)
        return (MAX_DIST + 1) * +(P != Q);

    for (var i = 0; i < P.length; i ++) ed_counts [P.charCodeAt (i)] ++;
    for (var i = 0; i < Q.length; i ++) ed_counts [Q.charCodeAt (i)] --;

    var ans = 0;

    for (var i = 0; i < P.length; i ++) {
        ans += Math.abs (ed_counts[P.charCodeAt (i)]);
        ed_counts[P.charCodeAt (i)] = 0;
    }

    for (var i = 0; i < Q.length; i ++) {
        ans += Math.abs (ed_counts[Q.charCodeAt (i)]);
        ed_counts[Q.charCodeAt (i)] = 0;
    }

    return ans;
}

function BKTree () {
    this.root = null;
    this.count = 0;
}

BKTree.prototype.insert = function (new_str, time) {
    'use strict';

    this.count ++;
    

    var new_node = { val: new_str, time: time, children: new Map () };

    if (this.root == null)
        this.root = new_node;
    else {
        var node = this.root;
        var dist = edit_distance (node.val, new_str);
        while (node.children.has (dist)) {
            node = node.children.get (dist);
            dist = edit_distance (node.val, new_str);
        }
        node.children.set (dist, new_node);
    }

    return new_node;
};

BKTree.prototype.find = function (str, time_lim) {
    'use strict';

    //var best_time, best_str = null;

    if (this.root != null) {
        var queue = [this.root];

        while (queue.length) {
            var u = queue.pop ();
            var dist = edit_distance (u.val, str);
            
            if (dist < MAX_DIST && u.time > time_lim)
                return u;

            u.children.forEach (function (value, key) {
                if (dist - MAX_DIST <= key && key <= dist + MAX_DIST)
                    queue.push (value);
            });
        }
    }

    return null;
};

// Copied from core.js

var trim_ending_re=/^(.+?)[\.。,，/\?？!！~～@\^、+=\-_♂♀ ]*$/;

function fromholyjson(txt) {
	var item=JSON.parse(txt);
	for(var key in item)
		item[key]=RegExp(item[key]);
	return item;
}
function toholyjson(obj) {
	var item={};
	for(var key in obj)
		item[key]=obj[key].source;
	return JSON.stringify(item);
}


function parse(old_dom, tabid) {
	console.time('parse');
	
	function detaolu(text) {
		for(var name in TAOLUS)
			if(TAOLUS[name].test(text))
				return name;
		return TRIM_ENDING ? text.replace(trim_ending_re,'$1') : text;
	}
	function ext_special_danmu(text) {
		try {
			return JSON.parse(text)[4];
		} catch(e) {
			return text;
		}
	}
	function build_text(elem,text,count) {
		var dumped=null;
		if(elem.mode=='7') // special danmu, need more parsing
			try {
				dumped=JSON.parse(elem.orig_str);
			} catch(e) {}
		
		if(dumped) {
			dumped[4]=(count==1 || !DANMU_BADGE) ?
				text :
				text+' [x'+count.toString()+']';
			return JSON.stringify(dumped);
		} else // normal case
			return (count==1 || !DANMU_BADGE) ?
				text :
				text+' [x'+count.toString()+']';
	}

	var parser=new DOMParser();
	var new_dom=parser.parseFromString('<i></i>','text/xml');
	var dom=parser.parseFromString(old_dom,'text/xml');
	var i_elem = new_dom.children[0];
	//var i_elem=new_dom.getRootNode().children[0];

	var danmus=[];
	[].slice.call(dom.children[0].children).forEach(function(elem) {
		if(elem.tagName=='d') {
			var attr=elem.attributes['p'].value.split(',');
			var str=elem.childNodes[0] ? elem.childNodes[0].data : '';

			if(!PROC_TYPE7 && attr[1]=='7')
				i_elem.appendChild(elem);
			else
				danmus.push({
					attr: attr, // thus we can build it into new_dom again
					str: attr[1]=='7' ? ext_special_danmu(str) :
						(REMOVE_SEEK && attr[1]=='8' && str.indexOf('Player.seek(')!=-1) ? 'filtered' :
						detaolu(str),
					time: parseFloat(attr[0]),
					orig_str: str,
					mode: attr[1]
				});
		} else
			i_elem.appendChild(elem);
	});
	danmus.sort(function(x,y) {return x.time-y.time;});

	var danmu_hist=new Map();
	var bk=new BKTree(), bk_buf=new BKTree(); // double buffer
	var last_time=0;

	danmus.forEach(function(dm) {
		var time=dm.time;
		var str=dm.str;

		if (time-last_time>THRESHOLD) { // swap buffer
			bk=bk_buf;
			bk_buf=new BKTree();
			last_time=time;
		}

		var res=bk.find(str,time-THRESHOLD);
		if (res==null) {
			var node=bk.insert(str,time);
			danmu_hist.set(node,[dm]);
			var node_buf=bk_buf.insert(str,time);
			danmu_hist.set(node_buf,[]);
		} else {
			danmu_hist.get(res).push(dm);

			var res_buf=bk_buf.find(str,time-THRESHOLD);

			if (res_buf==null) {
				var node=bk_buf.insert(str,time);
				danmu_hist.set(node,[]);
			}
		}
	});

	var counter=0;

	danmu_hist.forEach(function(value,key) {
		if (!value.length) return; // dummy node

		var len=1, last_time=value[0].time;
		for (var i=1; i<value.length; i++)
			if(value[i].time-last_time<THRESHOLD)
				len++;
			else {
				counter+=len-1;
				var d=new_dom.createElement('d');
				var tn=new_dom.createTextNode(build_text(value[i-1],key.val,len));

				d.appendChild(tn);
				d.setAttribute('p',value[i-1].attr.join(','));
				i_elem.appendChild(d);

				last_time=value[i].time;
				len=0;
			}

		counter+=len-1;
		var d=new_dom.createElement('d');
		var tn=new_dom.createTextNode(build_text(value[i-1],key.val,len));

		d.appendChild(tn);
		d.setAttribute('p',value[i-1].attr.join(','));
		i_elem.appendChild(d);
	});
	console.log( '已过滤 '+counter+'/'+danmus.length+' 弹幕', tabid);
	var serializer=new XMLSerializer();
	//console.timeEnd('parse');
	return [serializer.serializeToString(new_dom), new_dom];
}

// Hijacking XMLHttpRequest to make this script work

(function() {
	WINDOW = window;
	if(WINDOW._xhr)return;
	WINDOW._xhr = WINDOW.XMLHttpRequest;
	WINDOW.XMLHttpRequest = function() {
		//cannot use apply directly since we want a 'new' version
		var wrapped = new(Function.prototype.bind.apply(WINDOW._xhr, arguments));

		wrapped.addEventListener("readystatechange", function () {
			if(wrapped.readyState == 4) {
				//console.log(wrapped);
				if( wrapped.responseURL.match(/^(https:|http:|)?\/\/comment.bilibili.com\/.*\.xml/)) {
					console.log("processing danmoku", wrapped);
					try{
						var r = parse(wrapped.response, 0);
					} catch(e) {
						console.log(e);
					}
					Object.defineProperty(wrapped, 'responseText', {
						writable: true
					});
					Object.defineProperty(wrapped, 'responseXML', {
						writable: true
					});
					Object.defineProperty(wrapped, 'response', {
						writable: true
					});
					wrapped.responseXML = r[1];
					wrapped.responseText = r[0];
					wrapped.response = r[0];
				}
			}
		});
		//*/

		return wrapped;
	};
	console.log("r1 loaded");
})();	

