(function(){
  try {
    const g = window;
    const ensureInvoke = () => {
      if (g.__TAURI__ && g.__TAURI__.core && typeof g.__TAURI__.core.invoke === 'function') return g.__TAURI__.core.invoke;
      if (g.__TAURI_INTERNALS__ && typeof g.__TAURI_INTERNALS__.invoke === 'function') return g.__TAURI_INTERNALS__.invoke;
      return null;
    };

    if (!g.BuckyApi) g.BuckyApi = {};
    if (typeof g.BuckyApi.getVersion !== 'function') {
      g.BuckyApi.getVersion = function() { return "1.0.0"; };
    }
    if (typeof g.BuckyApi.getPublicKey !== 'function') {
      g.BuckyApi.getPublicKey = async function() {
        const inv = ensureInvoke();
        if (!inv) throw new Error('Tauri invoke API 不可用');
        const val = await inv('active_did_public_key');
        if (val == null) return null;
        try { return JSON.stringify(val); } catch (_) { return String(val); }
      };
    }
    if (typeof g.BuckyApi.signWithActiveDid !== 'function') {
      // 支持两种调用：
      // 1) signWithActiveDid(text)  -> 弹出模态框输入密码
      // 2) signWithActiveDid(text, password) -> 直接使用给定密码
      g.BuckyApi.signWithActiveDid = async function(text, password) {
        const inv = ensureInvoke();
        if (!inv) throw new Error('Tauri invoke API 不可用');
        if (typeof text !== 'string') text = String(text ?? '');

        // 如果提供了密码，直接签名
        if (typeof password === 'string') {
          return await inv('sign_with_active_did', { password, payload: text });
        }

        // 否则在页面内弹出受控模态对话框，样式尽量对齐应用 InputDialog
        function ensureModal() {
          if (g.__bucky_modal__) return g.__bucky_modal__;
          const host = document.createElement('div');
          host.style.position = 'fixed';
          host.style.inset = '0';
          host.style.zIndex = '2147483647';
          host.style.display = 'none';
          host.style.pointerEvents = 'none';
          document.documentElement.appendChild(host);
          const root = host.attachShadow({ mode: 'closed' });
          const style = document.createElement('style');
          style.textContent = `
            :host{all:initial}
            *,*::before,*::after{box-sizing:border-box}
            .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35)}
            .wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px}
            .box{width:100%;max-width:420px;background:var(--app-bg, #ffffff);color:var(--app-text, #0f172a);border:1px solid var(--border, #e6e8f0);border-radius:16px;padding:18px;box-shadow:none;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Arial;overflow:hidden}
            .title{font-size:18px;font-weight:600;margin:0 0 12px 0}
            .message{font-size:14px;color:var(--muted-text, #5b6473);margin-bottom:8px}
            .row{margin:10px 0}
            input{display:block;width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--input-border, #e6e8f0);background:var(--card-bg, #f7f8fb);color:var(--app-text, #0f172a);outline:none;box-shadow:none}
            .actions{display:flex;gap:12px;justify-content:flex-end;margin-top:12px}
            button{cursor:pointer;border-radius:12px;padding:10px 14px;border:none}
            .cancel{background:#a9b1bb; color:#fff}
            .primary{min-width:110px;background:linear-gradient(90deg,#6366f1 0%, #6c5ce7 100%);color:#fff}
          `;
          const frag = document.createElement('div');
          frag.innerHTML = `
            <div class="backdrop"></div>
            <div class="wrap" role="dialog" aria-modal="true">
              <div class="box">
                <div class="title">请输入密码</div>
                <div class="message"></div>
                <div class="row"><input id="pwd" type="password" placeholder="请输入当前 DID 密码" /></div>
                <div class="actions">
                  <button id="cancel" class="cancel">取消</button>
                  <button id="ok" class="primary">确定</button>
                </div>
              </div>
            </div>`;
          root.appendChild(style);
          root.appendChild(frag);
          const get = (id)=>root.querySelector('#'+id);
          const api = {
            open(onOk,onCancel){
              host.style.display='block';
              host.style.pointerEvents='auto';
              const pwd = get('pwd');
              const ok = get('ok');
              const cancel = get('cancel');
              const keyHandler = (e)=>{ if(e.key==='Enter'){ ok.click(); } if(e.key==='Escape'){ cancel.click(); } };
              function cleanup(){
                host.style.display='none';
                host.style.pointerEvents='none';
                ok.removeEventListener('click', okHandler);
                cancel.removeEventListener('click', cancelHandler);
                root.removeEventListener('keydown', keyHandler, true);
              }
              function okHandler(){
                const val = String(pwd.value||'');
                cleanup(); onOk(val);
              }
              function cancelHandler(){
                cleanup(); onCancel();
              }
              ok.addEventListener('click', okHandler);
              cancel.addEventListener('click', cancelHandler);
              root.addEventListener('keydown', keyHandler, true);
              setTimeout(()=>pwd.focus(),0);
            }
          };
          g.__bucky_modal__ = api;
          return api;
        }

        return await new Promise((resolve, reject) => {
          const modal = ensureModal();
          modal.open(async (password)=>{
            try{
              const token = await inv('sign_with_active_did', { password, payload: text });
              resolve(token);
            }catch(err){ reject(err); }
          }, ()=>{
            reject(new Error('user_cancelled'));
          });
        });
      }
    }
    // 通知页面 API 已就绪
    g.dispatchEvent(new Event('buckyapi-ready'));
  } catch (_) {}
})();

