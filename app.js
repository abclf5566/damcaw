/*
 * app_clean.js — 2025-04-26
 * 深度買賣計算器（CoinEx / Pionex）
 * 單檔完成：
 *   • 深色切換 (localStorage 記憶、零白屏)
 *   • 多計算器複製 / 刪除（上限 10）
 *   • 狀態持久化
 *   • API 深度計算 (CoinEx / Pionex 一致化)
 * ≡ 依賴：純原生 JS，無第三方套件 ≡
 * ------------------------------------------------------------
 */

(() => {
  'use strict';

  /* ────────────────────── 常數 ────────────────────── */
  const STORAGE_KEY     = 'calc_state_v1';
  const MAX_CALCULATORS = 10;
  const PROXY           = 'https://cors.neon-game.com/';

  const TOKENS = {
    coinex : ['KASPER','KASPY','KDAO','GHOAD','BURT','KEIRO','KANGO','NACHO','KREX','KEKE','BTC','ETH','SOL','KAS'],
    pionex : ['GHOAD','KANGO','NACHO','KAS','BTC','ETH','SOL']
  };

  /* ────────────────────── 工具函式 ────────────────────── */
  const $  = (sel , root=document) => root.querySelector(sel);
  const $$ = (sel , root=document) => [...root.querySelectorAll(sel)];

  /* 安全 localStorage（無痕／隱私模式 fallback 記憶體） */
  const SafeStore = (() => {
    let mem = null;
    return {
      get: () => {
        try { return localStorage.getItem(STORAGE_KEY); } catch { return mem; }
      },
      set: v => {
        try { localStorage.setItem(STORAGE_KEY, v); } catch { mem = v; }
      }
    };
  })();

  /* ────────────────────── 顏色主題 ────────────────────── */
  (() => {
    const saved   = localStorage.getItem('prefersDark');
    const isDark  = saved === 'true' ? true : saved === 'false' ? false : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    if (isDark) document.documentElement.style.background = '#121212';
  })();

  /* ────────────────────── 深度 API ────────────────────── */
  async function fetchDepth (exchange, symbol){
    symbol = symbol.toUpperCase();
    const urls = {
      coinex : `${PROXY}https://api.coinex.com/v2/spot/depth?market=${symbol}USDT&limit=50&interval=0`,
      pionex : `${PROXY}https://api.pionex.com/api/v1/market/depth?symbol=${symbol}_USDT&limit=500`
    };
    const res  = await fetch(urls[exchange]);
    const json = await res.json();

    if (exchange === 'coinex'){
      const d = json?.data?.depth;
      if (!d?.asks?.length || !d?.bids?.length) throw new Error('CoinEx 回傳格式錯誤');
      return d;
    }
    const d = json?.data;
    if (!d?.asks?.length || !d?.bids?.length) throw new Error('Pionex 無效深度資料');
    return d;
  }

  /* 滑點 / 淨額計算器  (兩所共用) */
  function compute ({depth, action, amount, feeRate, cet}){
    const book = action === 'buy' ? depth.asks : depth.bids;
    if (!book?.length) return [0,0,0];

    let remain = amount, sum=0, wSum=0, vol=0;
    for (const [pStr,vStr] of book){
      const price = +pStr, volu = +vStr, cost = price*volu;

      if (action==='buy'){
        if (remain >= cost){
          sum   += volu;
          remain-= cost;
          wSum  += price*volu;
          vol   += volu;
        } else {
          const part = remain/price;
          sum += part; wSum+=price*part; vol+=part; break;
        }
      } else {
        if (remain >= volu){
          sum += price*volu; remain-=volu; wSum+=price*volu; vol+=volu;
        } else {
          sum += price*remain; wSum+=price*remain; vol+=remain; break;
        }
      }
    }
    if (!vol) return [0,0,0];

    const avg = wSum/vol, best = +book[0][0];
    const slip = (action==='buy' ? (avg-best)/best : (best-avg)/best)*100;
    const fee  = sum*(cet?feeRate*0.8:feeRate);
    return [sum-fee, slip, fee];
  }

  /* ────────────────────── Calculator 類別 ────────────────────── */
  class Calculator{
    constructor(root){
      this.root = root;
      this.loop = 0;

      // 元件綁定
      this.el = {
        ex   : $('[id^="exchange"]',root),
        sym  : $('[id^="symbol"]'  ,root),
        amt  : $('[id^="amount"]'  ,root),
        act  : $('[id^="action"]'  ,root),
        fee  : $('[id^="fee"]'     ,root),
        cet  : $('[id^="cet"]'     ,root),
        res  : $('[id^="result"]'  ,root),
        err  : $('[id^="error"]'   ,root),
        dl   : $('datalist'         ,root)
      };

      this.initTokens();
      this.bindEvents();
      if (this.el.sym.value.trim()) this.restart();
    }

    initTokens(){
      const ex = this.el.ex.value;
      this.el.fee.value = ex==='coinex'?'0.3':'0.1';
      this.el.dl.innerHTML = TOKENS[ex].map(t=>`<option value="${t}"></option>`).join('');
    }

    bindEvents(){
      this.el.ex.addEventListener('change', ()=>{this.initTokens();this.restart();});
      this.el.sym.addEventListener('input', ()=>this.restart());
    }

    restart(){
      const sym = this.el.sym.value.trim();
      clearInterval(this.loop);
      if (!sym){this.el.res.textContent='';this.el.err.textContent='';return;}
      this.run();
      this.loop = setInterval(()=>this.run(),1000);
    }

    async run(){
      try{
        const depth = await fetchDepth(this.el.ex.value,this.el.sym.value.trim());
        const [net,slip,fee] = compute({
          depth,
          action : this.el.act.value,
          amount : +this.el.amt.value,
          feeRate: +this.el.fee.value/100,
          cet    : this.el.cet.checked
        });
        const color = slip>10?'red':slip>5?'orange':'inherit';
        this.el.res.innerHTML =
          `💰 獲得數量(扣除手續費)：${net.toFixed(4)} ${this.el.act.value==='buy'?this.el.sym.value.toUpperCase():'USDT'}<br>`+
          `💸 萬惡的手續費：${fee.toFixed(4)} ${this.el.act.value==='buy'?this.el.sym.value.toUpperCase():'USDT'}<br>`+
          `📉 去你的滑點：<span style="color:${color};font-weight:bold">${slip.toFixed(2)}%</span>`;
        this.el.err.textContent='';
      }catch(e){this.el.err.textContent='❌ '+e.message;}
    }

    dump(){
      return {
        ex : this.el.ex.value,
        sym: this.el.sym.value,
        amt: this.el.amt.value,
        act: this.el.act.value,
        fee: this.el.fee.value,
        cet: this.el.cet.checked
      };
    }

    load(d){
      const S = (el,v)=>{if(el)el.value=v};
      S(this.el.ex ,d.ex ); this.initTokens();
      S(this.el.sym,d.sym); S(this.el.amt,d.amt);
      S(this.el.act,d.act); S(this.el.fee,d.fee);
      if(this.el.cet) this.el.cet.checked = d.cet;
      this.restart();
    }

    dispose(){clearInterval(this.loop);}
  }

  /* ────────────────────── 主流程 ────────────────────── */
  document.addEventListener('DOMContentLoaded',()=>{
    /* 深色勾勾同步 (只綁一次) */
    const darkToggle = $('#darkToggle');
    if (darkToggle){
      darkToggle.checked = document.documentElement.dataset.theme==='dark';
      darkToggle.addEventListener('change',()=>{
        const isDark = darkToggle.checked;
        document.documentElement.dataset.theme = isDark?'dark':'light';
        localStorage.setItem('prefersDark',isDark);
        document.documentElement.style.background = isDark?'#121212':'';
        saveState();
      });
    }

    /* 主卡片 */
    const calcList   = [];
    const baseCard   = $('.calculator');
    const addBtn     = $('#addCalculator');
    if (!baseCard || !addBtn) return;

    calcList.push(new Calculator(baseCard));

    /* 新增計算器 */
    addBtn.addEventListener('click',()=>{
      if (calcList.length>=MAX_CALCULATORS) return alert('最多 10 個計算器');
      const clone = baseCard.cloneNode(true);
      clone.removeAttribute('style');
      clone.querySelector('h2')?.remove();     // 不要重複標題
      clone.querySelector('#darkToggle')?.parentElement?.remove();

      // id 後綴避免衝突
      const suf = '_'+calcList.length;
      $$('[id]', clone).forEach(el => el.id += suf);
      // datalist 對應
      $('[id^="symbol"]',clone)?.setAttribute('list',$('datalist',clone).id);

      // 刪除鍵
      const del = document.createElement('button');
      del.textContent='🗑️ 刪除';
      del.className='delete-btn';
      clone.appendChild(del);

      document.body.insertBefore(clone,addBtn);
      const c = new Calculator(clone);
      calcList.push(c);

      del.onclick=()=>{c.dispose();clone.remove();calcList.splice(calcList.indexOf(c),1);saveState();};
      saveState();
    });

    /* 持久化 */
    const saveState = ()=>{
      SafeStore.set(JSON.stringify({cards:calcList.map(c=>c.dump()),dark:document.documentElement.dataset.theme==='dark'}));
    };

    const initState = ()=>{
      const raw = SafeStore.get(); if(!raw) return;
      try{
        const {cards,dark} = JSON.parse(raw);
        if(dark){document.documentElement.dataset.theme='dark';darkToggle&& (darkToggle.checked=true);} 
        if(Array.isArray(cards)){
          calcList[0].load(cards[0]||{});
          for(let i=1;i<cards.length;i++){addBtn.click();calcList[i].load(cards[i]);}
        }
      }catch(e){console.warn('restore fail',e)}
    };

    document.body.addEventListener('input',e=>{if(e.target.matches('input,select')) saveState();});
    document.body.addEventListener('change',e=>{if(e.target.matches('input,select')) saveState();});

    initState();
  });
})();
