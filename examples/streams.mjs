import { Mintarex } from '@mintarex/node';

const mx = new Mintarex({
  apiKey: process.env.MINTAREX_API_KEY,
  apiSecret: process.env.MINTAREX_API_SECRET,
});

const stream = mx.streams.account();

stream.on('open', () => console.log('[account stream] connected'));
stream.on('reconnecting', ({ attempt, delayMs }) =>
  console.log(`[account stream] reconnecting attempt=${attempt} in=${delayMs}ms`),
);
stream.on('trade.executed', (msg) => console.log('trade.executed', msg.data));
stream.on('deposit.detected', (msg) => console.log('deposit.detected', msg.data));
stream.on('deposit.confirmed', (msg) => console.log('deposit.confirmed', msg.data));
stream.on('withdrawal.completed', (msg) => console.log('withdrawal.completed', msg.data));
stream.on('error', (err) => console.error('[account stream] error', err));
stream.on('close', () => console.log('[account stream] closed'));

// Shut down on SIGINT
process.on('SIGINT', () => {
  stream.close();
  process.exit(0);
});
