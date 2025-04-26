
/*
 * app_stable.js  —  2025‑04‑26
 * 完整重構、穩定版（單檔搞定「深色切換 / 多計算器 / 持久化」）
 * 作者：ChatGPT ✨
 * ———————————————————————————————
 * 特色：
 *   1. 任何 DOM 皆先檢查存在，完全防呆
 *   2. CoinEx / Pionex 計算邏輯統一 computeDepth()
 *   3. 支援「➕ 新增計算器」無限複製（上限 10）
 *   4. 介面狀態完整持久化到 localStorage（自動 fallback in‑memory）
 *   5. 嚴格使用 let / const + 立即函式避免全域汙染
 */

(() => {
    "use strict";
  
    /* ----------------- 常數 & 共用 ----------------- */
    const STORAGE_KEY = "calc_state_v1";
    const MAX_CALCULATORS = 10;
    const PROXY = "https://cors.neon-game.com/";
    const tokenList = {
      coinex: [
        "KASPER","KASPY","KDAO","GHOAD","BURT","KEIRO","KANGO","NACHO",
        "KREX","KEKE","BTC","ETH","SOL","KAS"
      ],
      pionex: ["GHOAD","KANGO","NACHO","KAS","BTC","ETH","SOL"]
    };
  
    /* ---------- 小工具 ---------- */
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  
    /* ---------- 輕量封裝的 localStorage ---------- */
    const StorageSafe = (() => {
      let inMemory = null;
      return {
        get() {
          try { return localStorage.getItem(STORAGE_KEY); }
          catch { return inMemory; }
        },
        set(v) {
          try { localStorage.setItem(STORAGE_KEY, v); }
          catch { inMemory = v; }
        },
        remove() {
          try { localStorage.removeItem(STORAGE_KEY); }
          catch { inMemory = null; }
        }
      };
    })();
  
    /* ----------------- 深度 API ----------------- */
    async function fetchDepth(exchange, symbol) {
      symbol = symbol.toUpperCase();
      const urls = {
        coinex: `${PROXY}https://api.coinex.com/v2/spot/depth?market=${symbol}USDT&limit=50&interval=0`,
        pionex: `${PROXY}https://api.pionex.com/api/v1/market/depth?symbol=${symbol}_USDT&limit=500`
      };
      try {
        const res = await fetch(urls[exchange]);
        const json = await res.json();
        if (exchange === "coinex") {
          const depth = json?.data?.depth;
          if (!depth?.asks || !depth?.bids) throw new Error("CoinEx 回傳格式錯誤");
          return depth;
        } else {
          const data = json?.data;
          if (!data?.asks?.length || !data?.bids?.length) throw new Error("Pionex 無效深度資料");
          return data;
        }
      } catch (err) {
        throw new Error("取得深度資料失敗：" + err.message);
      }
    }
  
    /* ----------------- 計算核心 ----------------- */
    function computeDepth({ depth, action, amount, feeRate, cetDiscount }) {
      const asks = depth.asks, bids = depth.bids;
      if (!asks || !bids) return [0,0,0];
      const book = action === "buy" ? asks : bids;
  
      let remaining = amount,
          total     = 0,
          wSum      = 0,
          volSum    = 0;
  
      for (const [priceStr, volStr] of book) {
        const price  = parseFloat(priceStr);
        const volume = parseFloat(volStr);
        const cost   = price * volume;
  
        if (action === "buy") {
          if (remaining >= cost) {
            total += volume;                 // 取得的 token
            remaining -= cost;
            wSum += price * volume;
            volSum += volume;
          } else {
            const part = remaining / price;
            total += part;
            wSum += price * part;
            volSum += part;
            break;
          }
        } else { // sell
          if (remaining >= volume) {
            total += price * volume;         // 收回的 USDT
            remaining -= volume;
            wSum += price * volume;
            volSum += volume;
          } else {
            total += price * remaining;
            wSum += price * remaining;
            volSum += remaining;
            break;
          }
        }
      }
      if (volSum === 0) return [0,0,0];
  
      const avgPrice  = wSum / volSum;
      const bestPrice = parseFloat(book[0][0]);
      const slipPct   = action === "buy"
        ? (avgPrice - bestPrice) / bestPrice * 100
        : (bestPrice - avgPrice) / bestPrice * 100;
  
      const fee = total * (cetDiscount ? feeRate * 0.8 : feeRate);
      return [total - fee, slipPct, fee];
    }
  
    /* ----------------- Calculator 類 ----------------- */
    class Calculator {
      constructor(root) {
        this.root = root;                          // <div class="calculator">
        this.loop = null;                          // setInterval handler
  
        // ------- 綁定元素 -------
        this.el = {
          exchange : $("[id^='exchange']", root),
          symbol   : $("[id^='symbol']", root),
          amount   : $("[id^='amount']", root),
          action   : $("[id^='action']", root),
          fee      : $("[id^='fee']", root),
          cet      : $("[id^='cet']", root),
          result   : $("[id^='result']", root),
          error    : $("[id^='error']", root),
          symbolDL : $("datalist", root)
        };
  
        /* 初始化 tokenList + 預設手續費 */
        this.updateTokens();
  
        /* 事件 */
        this.el.exchange?.addEventListener("change", () => {
          this.updateTokens();
          this.restartLoop();
        });
        this.el.symbol?.addEventListener("input", () => this.restartLoop());
  
        // 若 symbol 內已有值（復原狀態時）就立刻跑
        if (this.el.symbol?.value.trim()) this.restartLoop();
      }
  
      /* ---- 更新 symbol 選單 + 手續費 ---- */
      updateTokens() {
        const ex = this.el.exchange?.value;
        const feeInput = this.el.fee;
        if (!ex) return;
  
        feeInput.value = ex === "coinex" ? "0.3" : "0.1";
        if (this.el.symbolDL) {
          this.el.symbolDL.innerHTML = "";
          (tokenList[ex] || []).forEach(t => {
            const opt = document.createElement("option");
            opt.value = t;
            this.el.symbolDL.appendChild(opt);
          });
        }
      }
  
      /* ---- 重新開始 setInterval 執行 run() ---- */
      restartLoop() {
        const symbol = this.el.symbol?.value.trim();
        if (!symbol) {
          clearInterval(this.loop);
          this.el.result.textContent = "";
          this.el.error.textContent  = "";
          return;
        }
        clearInterval(this.loop);
        this.run();                           // 先跑一次
        this.loop = setInterval(() => this.run(), 1000);
      }
  
      /* ---- 單次計算 ---- */
      async run() {
        try {
          const exchange = this.el.exchange.value;
          const symbol   = this.el.symbol.value.trim();
          const amount   = parseFloat(this.el.amount.value);
          const action   = this.el.action.value;
          const feeRate  = parseFloat(this.el.fee.value) / 100;
          const cet      = this.el.cet.checked;
  
          const depth = await fetchDepth(exchange, symbol);
          const [net, slip, fee] = computeDepth({
            depth, action, amount, feeRate, cetDiscount: cet
          });
  
          const slipColor = slip > 10 ? "red" : slip > 5 ? "orange" : "inherit";
          this.el.result.innerHTML =
            `💰 淨獲得數量：${net.toFixed(4)} ${action === "buy" ? symbol.toUpperCase() : "USDT"}
  ` +
            `💸 手續費：${fee.toFixed(4)} ${action === "buy" ? symbol.toUpperCase() : "USDT"}
  ` +
            `📉 滑點：<span style="color:${slipColor};font-weight:bold">${slip.toFixed(2)}%</span>`;
  
          this.el.error.textContent = "";
        } catch (err) {
          this.el.error.textContent = "❌ 錯誤：「" + err.message + "」";
        }
      }
  
      /* ---- 收集狀態（for saveState） ---- */
      dump() {
        return {
          exchange: this.el.exchange.value,
          symbol  : this.el.symbol.value,
          amount  : this.el.amount.value,
          action  : this.el.action.value,
          fee     : this.el.fee.value,
          cet     : this.el.cet.checked
        };
      }
  
      /* ---- 還原狀態（for restoreState） ---- */
      load(data) {
        const s = (el, v) => { if (el) el.value = v; };
        s(this.el.exchange, data.exchange);
        this.updateTokens();                       // 要先更新 datalist
        s(this.el.symbol , data.symbol );
        s(this.el.amount , data.amount );
        s(this.el.action , data.action );
        s(this.el.fee    , data.fee    );
        if (this.el.cet) this.el.cet.checked = data.cet;
        this.restartLoop();
      }
  
      /* ---- 清除計算 loop（刪除卡片前呼叫） ---- */
      dispose() { clearInterval(this.loop); }
    }
  
    /* ----------------- 主程式 (DOMContentLoaded) ----------------- */
    document.addEventListener("DOMContentLoaded", () => {
      /* 深色模式 */
      const darkToggle = $("#darkToggle");
      if (darkToggle) {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (prefersDark) {
          document.documentElement.dataset.theme = "dark";
          darkToggle.checked = true;
        }
        darkToggle.addEventListener("change", () => {
          document.documentElement.dataset.theme = darkToggle.checked ? "dark" : "light";
        });
      }
  
      /* 建立主 Calculator */
      const calculators = [];
      const baseCard = $(".calculator");
      if (!baseCard) return console.error("找不到 .calculator 容器！");
  
      calculators.push(new Calculator(baseCard));
  
      /* ➕ 新增計算器 */
      const addBtn = $("#addCalculator");
      addBtn?.addEventListener("click", () => {
        if (calculators.length >= MAX_CALCULATORS) {
          return alert("最多只能新增 10 個計算器");
        }
        const clone = baseCard.cloneNode(true);
        clone.querySelector("h2")?.remove();                 // 刪副標題
        clone.querySelector("#darkToggle")?.parentElement?.remove();
  
        // 把 clone 里的所有 id ➕ suffix，避免重複
        const suffix = "_" + calculators.length;
        $$("[id]", clone).forEach(el => {
          const newId = el.id + suffix;
          el.id = newId;
          if (el.tagName === "LABEL") el.setAttribute("for", newId);
        });
  
        // datalist 對應
        const symbolInput = $("[id^='symbol']", clone);
        const dl = $("datalist", clone);
        if (symbolInput && dl) symbolInput.setAttribute("list", dl.id);
  
        /* 刪除按鈕 */
        const delBtn = document.createElement("button");
        delBtn.textContent = "🗑️ 刪除";
        delBtn.className = "delete-btn";
        clone.appendChild(delBtn);
  
        document.body.insertBefore(clone, addBtn);
        const calc = new Calculator(clone);
        calculators.push(calc);
  
        delBtn.onclick = () => {
          calc.dispose();
          clone.remove();
          calculators.splice(calculators.indexOf(calc), 1);
          saveState();
        };
  
        saveState();
      });
  
      /* ----------- 持久化 ----------- */
      function saveState() {
        const cards = calculators.map(c => c.dump());
        const dark = document.documentElement.dataset.theme === "dark";
        StorageSafe.set(JSON.stringify({ cards, dark }));
      }
      function restoreState() {
        const raw = StorageSafe.get();
        if (!raw) return;
        try {
          const { cards, dark } = JSON.parse(raw);
          if (dark && darkToggle) {
            document.documentElement.dataset.theme = "dark";
            darkToggle.checked = true;
          }
          if (Array.isArray(cards)) {
            // 更新主卡
            calculators[0].load(cards[0] || {});
            // 其餘自動新增
            for (let i = 1; i < cards.length; i++) {
              addBtn.click();
              calculators[i].load(cards[i]);
            }
          }
        } catch (e) { console.warn("restore fail", e); }
      }
  
      /* 監聽任何輸入變化就 saveState */
      document.body.addEventListener("input", e => {
        if (e.target.matches("input,select")) saveState();
      });
      document.body.addEventListener("change", e => {
        if (e.target.matches("input,select")) saveState();
      });
  
      restoreState();
    });
  })();