const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const { parse } = require('node-html-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// 初心者へのメモ：URLを書き換えるための魔法の関数だよ。
function rewriteUrls(html, proxyHost, targetOrigin) {
    const root = parse(html);
    const proxyPrefix = `https://${proxyHost}/proxy/`;

    // aタグのリンク、imgタグの画像、linkタグのCSS、scriptタグのJSを全部書き換える！
    const tags = {
        'a': 'href',
        'img': 'src',
        'link': 'href',
        'script': 'src',
        'form': 'action',
        'iframe': 'src'
    };

    for (const [tag, attr] of Object.entries(tags)) {
        root.querySelectorAll(tag).forEach(el => {
            const originalVal = el.getAttribute(attr);
            if (originalVal && !originalVal.startsWith('javascript:') && !originalVal.startsWith('#')) {
                try {
                    // 相対パスを絶対パスに直してから、プロキシのURLをくっつけるんだ。
                    const absoluteUrl = new URL(originalVal, targetOrigin).href;
                    el.setAttribute(attr, proxyPrefix + absoluteUrl);
                } catch (e) {
                    // URLが変な時は無視するよ
                }
            }
        });
    }

    return root.toString();
}

app.use('/proxy/:targetUrl(*)', async (req, res, next) => {
    const targetUrl = req.params.targetUrl;
    if (!targetUrl || !targetUrl.startsWith('http')) {
        return res.status(400).send('URLがおかしいよ。');
    }

    const targetOrigin = new URL(targetUrl).origin;

    const proxy = createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        secure: false,
        ws: true,
        followRedirects: false,
        selfHandleResponse: true, // これをtrueにすると、中身を自分でいじれるようになるんだ。
        onProxyRes: async function (proxyRes, req, res) {
            const bodyChunks = [];
            proxyRes.on('data', chunk => bodyChunks.push(chunk));
            proxyRes.on('end', () => {
                const body = Buffer.concat(bodyChunks);
                const contentType = proxyRes.headers['content-type'] || '';

                // リダイレクトの処理
                if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers['location']) {
                    const originalLocation = proxyRes.headers['location'];
                    const absoluteLocation = new URL(originalLocation, targetUrl).href;
                    res.redirect(`https://${req.get('host')}/proxy/${absoluteLocation}`);
                    return;
                }

                // HTMLの場合は中身を書き換える！
                if (contentType.includes('text/html')) {
                    const html = body.toString();
                    const rewrittenHtml = rewriteUrls(html, req.get('host'), targetOrigin);
                    
                    // 書き換えた中身をブラウザに返すよ。
                    res.set('Content-Type', 'text/html');
                    res.send(rewrittenHtml);
                } else {
                    // HTML以外（画像とか）はそのまま返す。
                    res.set(proxyRes.headers);
                    res.send(body);
                }
            });
        },
        onError: (err, req, res) => {
            res.status(500).send('エラーだよ: ' + err.message);
        }
    });

    proxy(req, res, next);
});

app.get('/', (req, res) => {
    res.send(`
        <body style="background:#000;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
            <h1>𝕏-Startpage Proxy</h1>
            <p>どんなサイトもプロキシの中に閉じ込めてあげるよ。</p>
            <input type="text" id="url" placeholder="https://example.com" style="width:400px;padding:10px;border-radius:20px;border:none;">
            <button onclick="location.href='/proxy/'+document.getElementById('url').value" style="margin-top:20px;padding:10px 30px;border-radius:20px;border:none;background:#1d9bf0;color:#fff;cursor:pointer;">Anonymous View</button>
        </body>
    `);
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
