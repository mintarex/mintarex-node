import http from 'node:http';
import { verifyWebhook, WebhookSignatureError } from '@mintarex-official/node';

const SECRET = process.env.MINTAREX_WEBHOOK_SECRET;

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.statusCode = 404;
    return res.end();
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    try {
      const event = verifyWebhook({ body, headers: req.headers, secret: SECRET });
      console.log('verified', event.event_type, event.event_id);
      // TODO: handle event.data
      res.statusCode = 200;
      res.end('ok');
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        res.statusCode = 400;
        return res.end('bad signature');
      }
      res.statusCode = 500;
      res.end();
    }
  });
});

server.listen(3000, () => console.log('listening on :3000'));
