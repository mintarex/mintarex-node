import { Mintarex } from '@mintarex-official/node';

const mx = new Mintarex({
  apiKey: process.env.MINTAREX_API_KEY,
  apiSecret: process.env.MINTAREX_API_SECRET,
});

const addr = await mx.crypto.depositAddress({ coin: 'BTC' });
console.log('Deposit here:', addr.address);

const deposits = await mx.crypto.deposits({ status: 'completed', limit: 10 });
console.log('Recent deposits:', deposits.data.length);

// Add a withdrawal address (prod: needs email confirmation + 24h cooling)
await mx.crypto.addresses.add({
  currency: 'BTC',
  network: 'btc',
  address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  label: 'Treasury cold storage',
});

// Submit a withdrawal. idempotency_key is auto-generated.
const withdrawal = await mx.crypto.withdraw({
  coin: 'BTC',
  network: 'btc',
  amount: '0.001',
  address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
});
console.log('Withdrawal submitted:', withdrawal.withdrawal_id, withdrawal.status);
