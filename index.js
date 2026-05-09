const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const { parse } = require('node-html-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Xのドメイン。死神の棲家だ。
const X_DOMAIN = 'https://x.com';
const X_API_DOMAIN = 'https://api.x.com';

// 初心者へのメモ：管理者を騙すための「偽装パス」だよ。
// /research-data/ 以下の通信は、全部XのAPIだと思えばいい。
const encodePath = (path) => Buffer.from(path).toString('base64').replace(/\//g, '_').replace(/=/g, '');

const INJECT_SCRIPT = (proxyHost) => `
<script>
(function() {
    const PROXY_URL = 'https://${proxyHost}';
    // Xのfetchを捕まえて、全部自分のサーバーのAPI中継地点に飛ばす。
    const originalFetch = window.fetch;
    window.fetch = function() {
        let url = arguments[0];
        if (typeof url === 'string' && (url.includes('x.com') || url.startsWith('/'))) {
            const absUrl = new URL(url, '${X_DOMAIN}').href;
            arguments[0] = PROXY_URL + '/api-relay/' + btoa(absUrl).replace(/\\//g, '_').replace(/=/g, '');
        }
        return originalFetch.apply(this, arguments);
    };
    console.log('Database Connection Established.');
})();
</script>
`;

// HTMLの中のリンクを「研究データ」風のパスに書き換える。
function rewriteX(html, proxyHost) {
    const root = parse(html);
    const head = root.querySelector('head');
    if (head) head.insertAdjacentHTML('afterbegin', INJECT_SCRIPT(proxyHost));

    root.querySelectorAll('a, img, link, script, video, source').forEach(el => {
        const attr = el.tagName === 'A' || el.tagName === 'LINK' ? 'href' : 'src';
        const val = el.getAttribute(attr);
        if (val && !val.startsWith('javascript:') && !val.startsWith('#')) {
            try {
                const abs = new URL(val, X_DOMAIN).href;
                // 全てのURLを /content-relay/<base64> に隠す。
                el.setAttribute(attr, `/content-relay/${encodePath(abs)}`);
            } catch (e) {}
        }
    });
    return root.toString();
}

// 1. API中継用
app.use('/api-relay/:path', (req, res, next) => {
    try {
        const target = Buffer.from(req.params.path.replace(/_/g, '/'), 'base64').toString();
        createProxyMiddleware({
            target: new URL(target).origin,
            changeOrigin: true,
            pathRewrite: () => new URL(target).pathname + new URL(target).search,
            onProxyRes: (pRes) => {
                pRes.headers['access-control-allow-origin'] = '*';
                delete pRes.headers['content-security-policy'];
            }
        })(req, res, next);
    } catch(e) { res.status(500).send('Data Error'); }
});

// 2. コンテンツ・メディア中継用
app.use('/content-relay/:path', (req, res, next) => {
    try {
        const target = Buffer.from(req.params.path.replace(/_/g, '/'), 'base64').toString();
        const proxy = createProxyMiddleware({
            target: new URL(target).origin,
            changeOrigin: true,
            pathRewrite: () => new URL(target).pathname + new URL(target).search,
            selfHandleResponse: target.includes('text/html') || target.endsWith('.html'),
            onProxyRes: (pRes, pReq, pResRaw) => {
                if (pRes.headers['content-type']?.includes('text/html')) {
                    let body = '';
                    pRes.on('data', chunk => body += chunk);
                    pRes.on('end', () => {
                        pResRaw.set('Content-Type', 'text/html');
                        pResRaw.send(rewriteX(body, req.get('host')));
                    });
                } else {
                    delete pRes.headers['x-frame-options'];
                    pResRaw.set(pRes.headers);
                    pRes.pipe(pResRaw);
                }
            }
        });
        proxy(req, res, next);
    } catch(e) { res.status(500).send('Resource Error'); }
});

// 3. メイン画面（偽装UI）
app.get('/', (req, res) => {
    res.send(`
        <body style="background:#f0f2f5;font-family:'Times New Roman',serif;padding:50px;text-align:center;">
            <div style="max-width:800px;margin:auto;background:#fff;padding:30px;border:1px solid #ccc;box-shadow:5px 5px 0 #ddd;">
                <h1 style="color:#1a3a5a;border-bottom:3px double #1a3a5a;">𝕏-Project: Global Social Dynamics Research</h1>
                <p style="text-align:justify;line-height:1.6;color:#444;">
                    Welcome to the 𝕏-Project research portal. This tool is designed for real-time analysis of global social dynamics and digital communication patterns. 
                    Please enter the research node identifier below to synchronize data.
                </p>
                <div style="margin:40px 0;">
                    <button onclick="location.href='/content-relay/${encodePath(X_DOMAIN)}'" style="padding:15px 40px;background:#1a3a5a;color:#fff;border:none;cursor:pointer;font-size:18px;font-weight:bold;">Initialize Data Sync (𝕏-Node)</button>
                </div>
                <p style="font-size:12px;color:#999;">Strictly for academic use. Authorized personnel only.</p>
            </div>
        </body>
    `);
});

app.listen(PORT, () => console.log('𝕏-Research Engine Active.'));
