export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { cf } = request;

    // --- [1] 测速后端接口 ---
    if (url.pathname === "/speedtest") {
      const size = parseInt(url.searchParams.get("size")) || 100;
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const data = new Uint8Array(1024 * 1024).fill(0);
      const gen = async () => {
        try { for (let i = 0; i < size; i++) await writer.write(data); } catch (e) {} finally { await writer.close(); }
      };
      ctx.waitUntil(gen());
      return new Response(readable, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
    }

    // --- [2] 服务端初始化逻辑 ---
    const cfIp = request.headers.get("cf-connecting-ip") || "未知";
    const ua = request.headers.get("user-agent") || "";
    
    // IP 属性深度解析 (V28.0 逻辑：判断机房/住宅)
    let ipAttr = { hosting: false, countryCode: "" };
    try {
      const apiRes = await fetch(`http://ip-api.com/json/${cfIp}?fields=countryCode,hosting`, { signal: AbortSignal.timeout(1500) });
      if (apiRes.ok) {
        ipAttr = await apiRes.json();
      }
    } catch (e) {}

    // 初始地理信息 (V0.1 风格预设)
    const initialGeo = {
      isp: cf.asOrganization || "运营商加载中...",
      country: "中国", 
      region: cf.region || "正在定位...",
      city: cf.city || "接入点",
      asn: "AS" + cf.asn
    };

    // 操作系统识别
    let osFull = "Windows 系统";
    if (/Android/i.test(ua)) osFull = "安卓 Android";
    else if (/iPhone|iPad|iPod/i.test(ua)) osFull = "苹果 iOS";
    else if (/Macintosh/i.test(ua)) osFull = "苹果 macOS";

    // 距离计算
    const getDist = (l1, n1, l2, n2) => {
      if (!l1 || !l2) return "未知";
      const R = 6371; const dLat = (l2-l1)*Math.PI/180; const dLon = (n2-n1)*Math.PI/180;
      const a = Math.sin(dLat/2)**2 + Math.cos(l1*Math.PI/180)*Math.cos(l2*Math.PI/180)*Math.sin(dLon/2)**2;
      return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1);
    };

    // --- [3] UI 渲染 ---
    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>网络诊断仪表盘 V0.1</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&family=JetBrains+Mono:wght@500&display=swap');
            body { background: #01080c; color: #cedde5; font-family: 'Noto Sans SC', sans-serif; }
            .mono { font-family: 'JetBrains Mono', monospace; }
            .glass-card { background: rgba(8, 26, 37, 0.6); border: 1px solid #133346; border-radius: 12px; backdrop-filter: blur(10px); }
            .line-item { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0.6rem; border-bottom: 1px solid rgba(19, 51, 70, 0.3); }
            .line-item:last-child { border-bottom: none; }
            .label { font-size: 0.75rem; font-weight: 700; color: #5c7a89; }
            .value { font-size: 0.82rem; font-weight: 500; color: #e2eef3; text-align: right; }
            .status-badge { padding: 4px 14px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; color: #fff; }
            .bg-green { background: #10b981; box-shadow: 0 0 15px rgba(16, 185, 129, 0.2); }
            .bg-pink { background: #f43f5e; box-shadow: 0 0 15px rgba(244, 63, 94, 0.2); }
            .bg-blue { background: #3b82f6; }
            .mtr-step { font-size: 0.75rem; padding: 6px 0; border-left: 2px solid #133346; padding-left: 15px; margin-left: 5px; color: #5c7a89; }
        </style>
    </head>
    <body class="p-4 md:p-10">
        <div class="max-w-6xl mx-auto">
            <header class="mb-8 flex justify-between items-end border-b border-slate-800 pb-4">
                <div>
                    <h1 class="text-2xl font-black italic tracking-tighter text-sky-400">网络<span class="text-white">诊断终端</span></h1>
                    <p class="text-[10px] text-slate-500 font-bold tracking-[0.3em] uppercase">V0.1 系统架构</p>
                </div>
                <div class="text-right"><div class="text-[10px] text-emerald-500 font-bold mono uppercase">节点: ${cf.colo}</div></div>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div class="glass-card p-6 flex justify-between items-center border-l-4 border-l-sky-500">
                    <div><span class="label block mb-1">当前连接 IP</span><div class="text-xl font-bold mono text-white">${cfIp}</div></div>
                    <span class="status-badge ${cf.country === ipAttr.countryCode ? 'bg-green' : 'bg-blue'}">
                        ${cf.country === ipAttr.countryCode ? '原生 IP' : '广播 IP'}
                    </span>
                </div>
                <div class="glass-card p-6 flex justify-between items-center border-l-4 border-l-emerald-500">
                    <div><span class="label block mb-1">网络基础设施</span><div id="infra-type" class="text-xl font-bold text-white italic">${ipAttr.hosting ? '数据中心' : '住宅/宽带网'}</div></div>
                    <span id="infra-badge" class="status-badge ${ipAttr.hosting ? 'bg-pink' : 'bg-green'}">
                        ${ipAttr.hosting ? '机房节点' : '住宅/移动'}
                    </span>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-6">
                <div class="glass-card p-4">
                    <h2 class="text-[10px] font-bold text-sky-400 uppercase px-2 mb-4 tracking-widest">物理接入位置</h2>
                    <div class="line-item"><span class="label">运营商 (ISP)</span><span id="loc-isp" class="value font-bold text-sky-400">${initialGeo.isp}</span></div>
                    <div class="line-item"><span class="label">归属国家</span><span id="loc-country" class="value">${initialGeo.country}</span></div>
                    <div class="line-item"><span class="label">本地省份/地区</span><span id="loc-region" class="value font-bold text-sky-200">${initialGeo.region}</span></div>
                    <div class="line-item"><span class="label">接入城市</span><span id="loc-city" class="value font-bold text-emerald-300">${initialGeo.city}</span></div>
                    <div class="line-item"><span class="label">地理时区</span><span id="loc-tz" class="value mono">Asia/Shanghai</span></div>
                    <div class="line-item"><span class="label">ASN 网络编号</span><span id="loc-asn" class="value text-slate-400 text-[10px]">${initialGeo.asn}</span></div>
                    <div class="line-item"><span class="label">TLS 协议</span><span class="value mono text-sky-400">${cf.tlsVersion}</span></div>
                </div>

                <div class="glass-card p-4">
                    <h2 class="text-[10px] font-bold text-emerald-400 uppercase px-2 mb-4 tracking-widest">设备安全检测</h2>
                    <div class="line-item"><span class="label">操作系统</span><span class="value font-bold text-emerald-400">${osFull}</span></div>
                    <div class="line-item"><span class="label">安全加密套件</span><span class="value text-[9px] text-slate-500 mono">${cf.tlsCipher}</span></div>
                    <div class="line-item"><span class="label">SSL 状态</span><span class="value text-emerald-500 text-[10px] font-bold">安全连接</span></div>
                    <div class="line-item"><span class="label">WAF 风险评分</span><span class="value font-bold">${cf.threatScore || 0} / 100</span></div>
                    <div class="line-item"><span class="label">匿名代理探测</span><span id="loc-proxy" class="value">分析中...</span></div>
                    <div class="line-item"><span class="label">防护状态</span><span class="value text-emerald-500">生效中</span></div>
                    <div class="line-item"><span class="label">距中心点距离</span><span class="value font-bold">${getDist(cf.latitude, cf.longitude, 22.3, 114.1)} KM</span></div>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="lg:col-span-2 glass-card p-6">
                    <h2 class="text-[10px] font-bold text-slate-500 uppercase mb-4 tracking-widest">链路追踪模拟 (MTR)</h2>
                    <div class="mtr-step"><span class="text-sky-500 font-bold mono">01</span> 本地链路入口 -> 1.0ms</div>
                    <div class="mtr-step"><span class="text-sky-500 font-bold mono">02</span> <span id="mtr-loc">${initialGeo.city}</span> 核心网 -> 11.2ms</div>
                    <div class="mtr-step"><span class="text-sky-500 font-bold mono">03</span> Cloudflare 跨境传输 -> 18.5ms</div>
                    <div class="mtr-step text-emerald-400 font-bold"><span class="text-emerald-500 font-bold mono">04</span> 到达边缘节点 [${cf.colo}] -> 完成</div>
                </div>

                <div class="glass-card p-6 flex flex-col justify-between">
                    <div>
                        <h2 class="text-[10px] font-bold text-slate-500 uppercase mb-6 tracking-widest">实时性能指标</h2>
                        <div class="mb-4"><span class="label block">下行带宽</span><div id="speed-display" class="text-3xl font-black italic text-white mono">0.00 <span class="text-xs font-normal text-sky-500">Mbps</span></div></div>
                        <div><span class="label block">往返延迟 (RTT)</span><span id="ping-value" class="text-2xl font-bold text-emerald-400 italic mono">0.0 毫秒</span></div>
                    </div>
                    <button id="start-btn" class="mt-6 w-full bg-sky-600 hover:bg-sky-500 text-white py-3 rounded-lg font-black transition-all text-xs tracking-widest uppercase">运行全面测速</button>
                </div>
            </div>
        </div>

        <script>
            // 静默定位：实现卡片内容全中文转换
            async function silentLocate() {
                try {
                    const res = await fetch('https://ip-api.com/json/?lang=zh-CN&fields=status,country,regionName,city,isp,timezone,as,hosting,proxy');
                    const d = await res.json();
                    if(d.status === 'success') {
                        document.getElementById('loc-isp').innerText = d.isp;
                        document.getElementById('loc-country').innerText = d.country;
                        document.getElementById('loc-region').innerText = d.regionName;
                        document.getElementById('loc-city').innerText = d.city;
                        document.getElementById('mtr-loc').innerText = d.city;
                        document.getElementById('loc-tz').innerText = d.timezone;
                        document.getElementById('loc-asn').innerText = d.as;
                        document.getElementById('loc-proxy').innerText = d.proxy ? "检测到代理环境" : "直连访问 (安全)";
                        
                        // 基础设施二次校验
                        if(d.hosting) {
                            document.getElementById('infra-type').innerText = "数据中心机房";
                            document.getElementById('infra-badge').innerText = "机房节点";
                            document.getElementById('infra-badge').className = "status-badge bg-pink";
                        }
                    }
                } catch(e) {
                    document.getElementById('loc-proxy').innerText = "探测受限";
                }
            }
            // 确保在 DOM 加载完成后立即执行中文替换
            document.addEventListener('DOMContentLoaded', silentLocate);

            // RTT 逻辑
            async function updatePing() {
                const s = performance.now();
                try { await fetch('/favicon.ico?t=' + s, { cache: 'no-store' }); } catch(e){}
                document.getElementById('ping-value').innerText = (performance.now() - s).toFixed(1) + ' 毫秒';
            }
            setInterval(updatePing, 2000);

            let abort = null;
            document.getElementById('start-btn').addEventListener('click', async () => {
                const btn = document.getElementById('start-btn');
                const disp = document.getElementById('speed-display');
                if (abort) { abort.abort(); abort = null; return; }
                
                abort = new AbortController();
                btn.innerText = '停止'; btn.classList.replace('bg-sky-600', 'bg-red-600');
                
                let loaded = 0; const start = performance.now();
                try {
                    const res = await fetch('/speedtest?size=150', { signal: abort.signal });
                    const reader = res.body.getReader();
                    while(true) {
                        const {done, value} = await reader.read();
                        if(done) break;
                        loaded += value.length;
                        const mbps = ((loaded * 8) / ((performance.now() - start) / 1000) / 1048576).toFixed(2);
                        disp.innerHTML = \`\${mbps} <span class="text-xs text-sky-500">Mbps</span>\`;
                    }
                } catch(e){} finally { 
                    btn.innerText = '运行全面测速'; btn.classList.replace('bg-red-600', 'bg-sky-600'); 
                    abort = null; 
                }
            });
        </script>
    </body>
    </html>
    `;

    return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
  }
};
