const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const { parse } = require('node-html-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// 初心者へのメモ：URLを暗号化（Base64）したり戻したりする魔法だよ。
const encode = (str) => Buffer.from(str).toString('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
const decode = (str) => {
    let s = str.replace(/_/g, '/').replace(/-/g, '+');
    while (s.length % 4) s += '=';
    return Buffer.from(s, 'base64').toString();
};

const INJECT_SCRIPT = (proxyHost, encodedOrigin) => `
<script>
(function() {
    const PROXY_BASE = 'https://${proxyHost}/p/${encodedOrigin}/';
    const originalFetch = window.fetch;
    window.fetch = function() {
        if (arguments[0] && typeof arguments[0] === 'string' && !arguments[0].startsWith('http') && !arguments[0].startsWith('https://${proxyHost}')) {
            arguments[0] = PROXY_BASE + (arguments[0].startsWith('/') ? arguments[0].slice(1) : arguments[0]);
        }
        return originalFetch.apply(this, arguments);
    };
    console.log('Research Tool: Data integration active.');
})();
</script>
`;

function rewriteUrls(html, proxyHost, targetOrigin) {
    const root = parse(html);
    const encodedOrigin = encode(targetOrigin);
    const proxyPrefix = `https://${proxyHost}/p/${encodedOrigin}/`;

    const head = root.querySelector('head');
    if (head) head.insertAdjacentHTML('afterbegin', INJECT_SCRIPT(proxyHost, encodedOrigin));

    const tags = {'a': 'href', 'img': 'src', 'link': 'href', 'script': 'src', 'form': 'action', 'iframe': 'src'};
    for (const [tag, attr] of Object.entries(tags)) {
        root.querySelectorAll(tag).forEach(el => {
            const val = el.getAttribute(attr);
            if (val && !val.startsWith('javascript:') && !val.startsWith('#')) {
                try {
                    const abs = new URL(val, targetOrigin).href;
                    // URLを隠すために、パスの構造を変えるよ
                    if (abs.startsWith(targetOrigin)) {
                        el.setAttribute(attr, proxyPrefix + abs.replace(targetOrigin + '/', ''));
                    } else {
                        // 外部ドメインの場合は、また新しくエンコードして飛ばす
                        el.setAttribute(attr, `https://${proxyHost}/p/${encode(new URL(abs).origin)}/${new URL(abs).pathname}${new URL(abs).search}`);
                    }
                } catch (e) {}
            }
        });
    }
    return root.toString();
}

// /p/<encoded_origin>/<path> という形式にするよ
app.use('/p/:origin/:path(*)', async (req, res, next) => {
    try {
        const targetOrigin = decode(req.params.origin);
        const targetPath = req.params.path || '';
        const targetUrl = `${targetOrigin}/${targetPath}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;

        const proxy = createProxyMiddleware({
            target: targetOrigin,
            changeOrigin: true,
            secure: false,
            ws: true,
            followRedirects: false,
            selfHandleResponse: true,
            onProxyRes: async function (proxyRes, req, res) {
                const bodyChunks = [];
                proxyRes.on('data', chunk => bodyChunks.push(chunk));
                proxyRes.on('end', () => {
                    const body = Buffer.concat(bodyChunks);
                    const contentType = proxyRes.headers['content-type'] || '';

                    if ([301, 302].includes(proxyRes.statusCode) && proxyRes.headers['location']) {
                        const abs = new URL(proxyRes.headers['location'], targetOrigin).href;
                        const newOrigin = new URL(abs).origin;
                        res.redirect(`/p/${encode(newOrigin)}/${abs.replace(newOrigin + '/', '')}`);
                        return;
                    }

                    if (contentType.includes('text/html')) {
                        res.set('Content-Type', 'text/html');
                        res.send(rewriteUrls(body.toString(), req.get('host'), targetOrigin));
                    } else {
                        res.set(proxyRes.headers);
                        res.send(body);
                    }
                });
            }
        });
        proxy(req, res, next);
    } catch (e) {
        res.status(500).send('Analysis Error: ' + e.message);
    }
});

app.get('/', (req, res) => {
    res.send(`
        <body style="background:#f4f7f6;color:#333;font-family:serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="background:#fff;padding:40px;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,0.05);text-align:center;width:500px;">
                <h1 style="font-size:24px;color:#2c3e50;border-bottom:2px solid #3498db;padding-bottom:10px;">Global Document Research Tool</h1>
                <p style="color:#7f8c8d;font-style:italic;">Access academic resources and global archives securely.</p>
                <div style="margin-top:30px;display:flex;gap:10px;">
                    <input type="text" id="url" placeholder="Enter resource URL (e.g. https://archive.org)" style="flex:1;padding:12px;border:1px solid #ddd;border-radius:5px;outline:none;">
                    <button onclick="go()" style="padding:12px 25px;background:#3498db;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:bold;">Load Resource</button>
                </div>
                <p style="margin-top:20px;font-size:12px;color:#bdc3c7;">Note: Some resources may be restricted by regional firewalls.</p>
            </div>
            <script>
                function encode(str) { return btoa(str).replace(/\\//g, '_').replace(/\\+/g, '-').replace(/=/g, ''); }
                function go() {
                    const val = document.getElementById('url').value;
                    if(!val) return;
                    const url = new URL(val.startsWith('http') ? val : 'https://' + val);
                    location.href = '/p/' + encode(url.origin) + '/' + url.pathname.slice(1) + url.search;
                }
            </script>
        </body>
    `);
});

app.listen(PORT, () => console.log('System active.'));
